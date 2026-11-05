// Account changes made on the website and webadmin (the BMP API), applied to
// the player's Nakama profile so the game sees them at once: privileges,
// display name and joker preferences, a Discord unlink, a Notice acceptance
// and age answer, and account deletion.
// Server only. (Linking Discord is admin_discord_set, in discord.ts.)
import { FAILED_PRECONDITION, INVALID_ARGUMENT, NOT_FOUND, PERMISSION_DENIED, runtimeError } from '../errors'
import { currentLobby } from '../lobby/rpc'
import type { LobbySignal } from '../lobby/protocol'
import { parsePayload, requireServer } from '../rpc'
import { progressFor } from '../achievements/storage'
import { DEFAULT_AVATAR } from '../shared/avatars/ids'
import { isSelectable } from '../shared/avatars/unlocked'
import { anonymizeAccount } from './anonymize'
import { releaseDiscord, withoutDiscord } from './discord'
import { playerView, profileFor, updateProfile, type Profile } from './profile'
import { profileChanged } from './rpc'

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PRIVILEGE = /^[a-z0-9_-]{1,64}$/i

export interface ProfileEdit {
	privileges?: string[]
	useDiscordName?: boolean
	preferredJoker?: string
	// null unlinks.
	discord?: null
	// A Notice accepted on the website (auth.service.ts acceptTos).
	notice?: { version: number; acceptedAt: number }
	// The age answer given with it: chat on, or blocked (as rpcTosAccept).
	chatEligible?: boolean
}

function requireAccount(nk: nkruntime.Nakama, userId: unknown): string {
	if (typeof userId !== 'string' || !USER_ID.test(userId)) throw runtimeError(INVALID_ARGUMENT, 'userId is required')
	try {
		nk.accountGetId(userId)
	} catch (e) {
		throw runtimeError(NOT_FOUND, 'No such user')
	}
	return userId
}

// The edit in a request body; INVALID_ARGUMENT for a field of the wrong shape.
export function parseEdit(input: { [key: string]: unknown }): ProfileEdit {
	const edit: ProfileEdit = {}
	const { privileges, useDiscordName, preferredJoker, discord, notice, chatEligible } = input
	if (privileges !== undefined) {
		if (!Array.isArray(privileges) || !privileges.every((p) => typeof p === 'string' && PRIVILEGE.test(p)))
			throw runtimeError(INVALID_ARGUMENT, 'privileges must be an array of privilege names')
		edit.privileges = privileges as string[]
	}
	if (useDiscordName !== undefined) {
		if (typeof useDiscordName !== 'boolean') throw runtimeError(INVALID_ARGUMENT, 'useDiscordName must be a boolean')
		edit.useDiscordName = useDiscordName
	}
	if (preferredJoker !== undefined) {
		if (typeof preferredJoker !== 'string' || !preferredJoker)
			throw runtimeError(INVALID_ARGUMENT, 'preferredJoker must be a joker id')
		edit.preferredJoker = preferredJoker
	}
	if (discord !== undefined) {
		if (discord !== null) throw runtimeError(INVALID_ARGUMENT, 'discord can only be null (unlink)')
		edit.discord = null
	}
	if (notice !== undefined) {
		const n = notice as { [key: string]: unknown } | null
		if (!n || typeof n !== 'object' || !Number.isInteger(n.version) || (n.version as number) < 1 || typeof n.acceptedAt !== 'number')
			throw runtimeError(INVALID_ARGUMENT, 'notice must be {version, acceptedAt}')
		edit.notice = { version: n.version as number, acceptedAt: n.acceptedAt }
	}
	if (chatEligible !== undefined) {
		if (typeof chatEligible !== 'boolean') throw runtimeError(INVALID_ARGUMENT, 'chatEligible must be a boolean')
		edit.chatEligible = chatEligible
	}
	return edit
}

// Pure: profile with edit applied, checked as the player's own RPCs check it
// (a Discord name needs a linked Discord, a joker must be one the player may
// pick: a default, one their privileges grant, or one they earned, unlocked).
// Losing the privilege behind the current joker resets it to the default.
export function applyEdit(profile: Profile, edit: ProfileEdit, unlocked: readonly string[] = []): Profile {
	let next = { ...profile }
	if (edit.privileges !== undefined) {
		next.privileges = edit.privileges
		if (!isSelectable(next.preferredJoker, { privileges: next.privileges, unlocked })) next.preferredJoker = DEFAULT_AVATAR
	}
	if (edit.discord === null) next = withoutDiscord(next)
	if (edit.useDiscordName !== undefined) {
		if (edit.useDiscordName && !next.discordIdHash) throw runtimeError(FAILED_PRECONDITION, 'Discord account not linked')
		next.useDiscordName = edit.useDiscordName
	}
	if (edit.preferredJoker !== undefined) {
		if (!isSelectable(edit.preferredJoker, { privileges: next.privileges, unlocked }))
			throw runtimeError(INVALID_ARGUMENT, 'Invalid joker')
		next.preferredJoker = edit.preferredJoker
	}
	if (edit.notice) {
		next.tosAcceptedVersion = edit.notice.version
		next.noticeAcceptedAt = edit.notice.acceptedAt
	}
	if (edit.chatEligible !== undefined) {
		next.ageAnswered = true
		next.chatEnabled = edit.chatEligible
		next.chatBlocked = !edit.chatEligible
	}
	return next
}

// {userId, privileges?, useDiscordName?, preferredJoker?, discord?: null,
// notice?: {version, acceptedAt}, chatEligible?} -> {player}
export function rpcAdminProfileSet(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const input = parsePayload(payload)
	const userId = requireAccount(nk, input.userId)
	const edit = parseEdit(input)
	let previousDiscord: string | null = null
	const unlocked = progressFor(nk, userId).unlocked
	const profile = updateProfile(nk, userId, (current) => {
		previousDiscord = current.discordIdHash
		return applyEdit(current, edit, unlocked)
	})
	if (edit.discord === null) releaseDiscord(nk, userId, previousDiscord)
	profileChanged(nk, userId, profile)
	logger.info('Profile of %s updated by the API: %v', userId, JSON.stringify(Object.keys(edit)))
	return JSON.stringify({ player: playerView(nk, userId, profile) })
}

// {userId, anonymousId, keptRunIds, keepSteamIdHash} -> {deleted: true}: the
// account deleted from the website. The player leaves their lobby, their
// system-owned data is deleted or renamed (player/anonymize.ts: own data
// goes, shared runs take the standard deleted-player id, moderation data
// takes anonymousId; keptRunIds and keepSteamIdHash say what is moderation
// data, by the API's rules), and the
// account and everything it owns is deleted. Its refresh tokens are revoked first ('' tokens: all of them); an
// already-issued session token can't be revoked in Nakama and lives out its
// expiry (session.token_expiry_sec), but its account is gone so it owns no
// storage. Bans outlive the account: they are indexed by login id
// (moderation/enforce.ts) and kept in Postgres, which a new account for the
// same Steam id syncs from.
export function rpcAdminAccountDelete(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const input = parsePayload(payload)
	const userId = requireAccount(nk, input.userId)
	if (typeof input.anonymousId !== 'string' || !USER_ID.test(input.anonymousId) || input.anonymousId === userId)
		throw runtimeError(INVALID_ARGUMENT, 'anonymousId is required')
	const keptRunIds = input.keptRunIds
	if (
		!Array.isArray(keptRunIds) ||
		!keptRunIds.every((id) => typeof id === 'string')
	)
		throw runtimeError(INVALID_ARGUMENT, 'keptRunIds must be a list of run ids')
	if (typeof input.keepSteamIdHash !== 'boolean')
		throw runtimeError(INVALID_ARGUMENT, 'keepSteamIdHash is required')
	const lobby = currentLobby(nk, userId)
	if (lobby) {
		const signal: LobbySignal = { type: 'admin_remove', userId, reason: 'account_deleted', onlyIfStarted: false }
		nk.matchSignal(lobby.matchId, JSON.stringify(signal))
	}
	releaseDiscord(nk, userId, profileFor(nk, userId).discordIdHash)
	nk.sessionLogout(userId, '', '')
	anonymizeAccount(nk, userId, input.anonymousId, {
		keptRunIds,
		keepSteamIdHash: input.keepSteamIdHash,
	})
	nk.accountDeleteId(userId, false)
	logger.info('Deleted account %s', userId)
	return JSON.stringify({ deleted: true })
}

// Before-hook for Nakama's own client account delete (DELETE /v2/account):
// refused. It would skip the anonymization above and leave the Postgres rows
// under the old id; deletion goes through the website, which runs both with
// one anonymous id.
export function refuseClientAccountDelete(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
): void {
	throw runtimeError(PERMISSION_DENIED, 'Delete your account on the website (your profile page)')
}
