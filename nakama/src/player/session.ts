// session_init: the game client's login. The client calls it right after
// authenticating and gets back the player, the Notice gate and the server
// config.
// At a Steam account's first call the player's Postgres data is synced over
// through the API (player-sync), found by the Steam id hash the account is
// named by; if that fails the login still succeeds and the sync is tried
// again next time.
import { recordMilestone } from '../achievements/record'
import { progressFor } from '../achievements/storage'
import { noteReturn } from '../lobby/forfeits'
import { NOTICE_VERSION } from '../../../packages/types/src/notice'
import { clientConfig, readConfig, type ServerConfig } from '../config'
import { callExpress } from '../express'
import { enqueue } from '../mirror/outbox'
import { UNVERIFIED, writeIntegrity } from '../integrity'
import { clearModReport } from '../standing/storage'
import { PERMISSION_DENIED, runtimeError } from '../errors'
import { ACCOUNT_BANNED, banMessage } from '../moderation/access'
import { activeBan, bansFromList, readBans, withBan, writeBans, BAN_TYPES } from '../moderation/bans'
import { enforceAccountBan } from '../moderation/enforce'
import { banNetworks } from '../moderation/network'
import { settingsOf, type ServerSettings } from '../server_kind'
import { parsePayload, requireUser } from '../rpc'
import {
	cleanName,
	shownNameOf,
	playerView,
	readProfile,
	updateProfile,
	withSync,
	type PlayerSync,
	type Profile,
} from './profile'
import { steamIdHashOf } from './steam_id'

function isPlayerSync(value: { [key: string]: unknown }): boolean {
	return typeof value.playerId === 'string' && Array.isArray(value.bans)
}

// The player's Postgres data, or null when the API can't be reached.
function fetchSync(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	userId: string,
	steamIdHash: string,
	steamName: string,
): PlayerSync | null {
	const reply = callExpress(nk, logger, ctx.env, '/player-sync', { steamIdHash, nakamaUserId: userId, steamName })
	if (!reply || reply.status !== 200 || !isPlayerSync(reply.body)) {
		logger.warn('Player sync for %s failed (HTTP %v); retrying next login', userId, reply && reply.status)
		return null
	}
	return reply.body as unknown as PlayerSync
}

// Legacy mutes of players who have logged in to Nakama since.
function resolveMutes(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	profile: Profile,
): { [playerId: string]: string } {
	const reply = callExpress(nk, logger, ctx.env, '/resolve-players', { playerIds: profile.unresolvedMutedPlayerIds })
	const resolved = reply && reply.status === 200 ? reply.body.resolved : null
	return resolved && typeof resolved === 'object' ? (resolved as { [playerId: string]: string }) : {}
}

export function withResolvedMutes(profile: Profile, resolved: { [playerId: string]: string }): Profile {
	const found = profile.unresolvedMutedPlayerIds.filter((id) => typeof resolved[id] === 'string')
	if (found.length === 0) return profile
	const muted = profile.mutedUserIds.slice()
	for (const id of found) if (muted.indexOf(resolved[id]) === -1) muted.push(resolved[id])
	return {
		...profile,
		mutedUserIds: muted,
		unresolvedMutedPlayerIds: profile.unresolvedMutedPlayerIds.filter((id) => found.indexOf(id) === -1),
	}
}

// The login response: the API's gameLoginPayload, minus its tokens (the
// client already holds a Nakama session). Only a server kind with
// noticeRequired asks for the Notice; every kind asks the age once.
export function loginResponse(nk: nkruntime.Nakama, userId: string, profile: Profile, config: ServerConfig, settings: ServerSettings) {
	const tosRequired = settings.noticeRequired && profile.tosAcceptedVersion < NOTICE_VERSION
	return {
		tosRequired,
		// An update to a Notice the player accepted before (only with tosRequired).
		tosUpdate: tosRequired && profile.tosAcceptedVersion > 0,
		// The age question is still open (with tosRequired, inside the Notice).
		ageRequired: !profile.ageAnswered,
		player: playerView(nk, userId, profile),
		serverConfig: clientConfig(config),
	}
}

// Keeps the Nakama account's display name (shown by Nakama itself, e.g. in
// presences and the matchmaker) in step with the profile.
export function syncDisplayName(nk: nkruntime.Nakama, userId: string, profile: Profile) {
	const name = shownNameOf(nk, userId, profile)
	if (nk.accountGetId(userId).user.displayName !== name)
		nk.accountUpdateId(userId, null, name, null, null, null, null, null)
}

// {steamName} -> loginResponse.
export function rpcSessionInit(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	const userId = requireUser(ctx)
	noteReturn(nk, logger, userId, Date.now())
	const steamName = cleanName(parsePayload(payload).steamName) || ctx.username
	const stored = readProfile(nk, userId, steamName)
	const steamIdHash = steamIdHashOf(nk, userId)

	let sync: PlayerSync | null = null
	let resolved: { [playerId: string]: string } = {}
	if (!stored || !stored.profile.synced) {
		if (steamIdHash) sync = fetchSync(ctx, logger, nk, userId, steamIdHash, steamName)
	} else if (stored.profile.unresolvedMutedPlayerIds.length > 0) {
		resolved = resolveMutes(ctx, logger, nk, stored.profile)
	}

	const unlocked = sync ? progressFor(nk, userId).unlocked : []
	const profile = updateProfile(
		nk,
		userId,
		(current) => {
			let next: Profile = { ...current, steamName, nakamaLogin: true }
			if (sync) next = withSync(next, sync, unlocked)
			else if (!steamIdHash) next.synced = true // device login: nothing to sync
			return withResolvedMutes(next, resolved)
		},
		steamName,
	)
	if (sync) {
		let bans = readBans(nk, userId)
		const synced = bansFromList(sync.bans)
		for (const type of BAN_TYPES) {
			const ban = synced[type]
			if (ban) bans = withBan(bans, type, ban)
		}
		writeBans(nk, userId, bans)
		logger.info('Synced player %s from Postgres player %s', userId, sync.playerId)
	}
	// An account ban the sync brought over (or one Nakama's own ban somehow
	// missed) ends the login here.
	const accountBan = activeBan(readBans(nk, userId), 'account', Date.now())
	if (accountBan) {
		enforceAccountBan(nk, userId, accountBan)
		banNetworks(nk, settingsOf(ctx), userId, accountBan, Date.now())
		throw runtimeError(PERMISSION_DENIED, banMessage(ACCOUNT_BANNED, accountBan))
	}
	syncDisplayName(nk, userId, profile)
	// Accounts linked before achievements existed earn Scholar here.
	if (profile.discordIdHash) recordMilestone(nk, logger, userId, 'discordLinked', profile.privileges)
	// A new login is unverified until launcher_session_start's challenge passes,
	// and unreported until this session's profile_set_mods.
	writeIntegrity(nk, userId, UNVERIFIED)
	clearModReport(nk, userId)
	return JSON.stringify(loginResponse(nk, userId, profile, readConfig(nk), settingsOf(ctx)))
}

// {chatEligible?} -> loginResponse. On a server kind with noticeRequired,
// accepts the current Notice version (and stores when). With chatEligible
// (worked out client-side from the birthdate, never sent raw) it also takes
// the age answer: chat on, or blocked, as the API's acceptTos does. On other
// kinds only the age answer is taken.
export function rpcTosAccept(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	const userId = requireUser(ctx)
	const eligible = parsePayload(payload).chatEligible
	const config = readConfig(nk)
	const settings = settingsOf(ctx)
	const acceptedAt = Date.now()
	const profile = updateProfile(
		nk,
		userId,
		(current) => {
			const next: Profile = settings.noticeRequired
				? { ...current, tosAcceptedVersion: NOTICE_VERSION, noticeAcceptedAt: acceptedAt }
				: { ...current }
			if (typeof eligible === 'boolean') {
				next.ageAnswered = true
				next.chatEnabled = eligible
				next.chatBlocked = !eligible
			}
			return next
		},
		ctx.username,
	)
	// Postgres (webadmin) keeps who accepted which version, and when.
	if (settings.noticeRequired)
		enqueue(nk, { kind: 'notice', at: acceptedAt, userId, version: NOTICE_VERSION })
	return JSON.stringify(loginResponse(nk, userId, profile, config, settings))
}
