// The player's own account settings, as the API's /auth/preferences/* and
// /mutes routes did: display name (Steam or Discord), preferred joker,
// installed mods and mutes. Each answers with what the API answered; a change
// others can see also reaches the player's lobby, and the player's other
// sessions hear of it through ACCOUNT_UPDATED.
import { standingFor } from '../standing/current'
import { pvpVersionOf } from '../standing/pvp_version'
import { writeModReport } from '../standing/storage'
import { FAILED_PRECONDITION, INVALID_ARGUMENT, runtimeError } from '../errors'
import { currentLobby } from '../lobby/rpc'
import type { LobbySignal, PlayerInfo } from '../lobby/protocol'
import { notify, NotifyCode } from '../notify'
import { parsePayload, requireUser } from '../rpc'
import { progressFor } from '../achievements/storage'
import { isSelectable } from '../shared/avatars/unlocked'
import { playerView, shownNameOf, updateProfile, type Profile } from './profile'
import { syncDisplayName } from './session'
import { settingsOf } from '../server_kind'

const MAX_MODS = 300
const MAX_MOD_LENGTH = 128
const MAX_MUTES = 1000
const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Tells the player's lobby (if any) about their new info.
export function pushToLobby(nk: nkruntime.Nakama, userId: string, info: Partial<PlayerInfo>) {
	const current = currentLobby(nk, userId)
	if (!current) return
	const signal: LobbySignal = { type: 'player_info', userId, info }
	nk.matchSignal(current.matchId, JSON.stringify(signal))
}

export function accountUpdated(nk: nkruntime.Nakama, userId: string, profile: Profile) {
	notify(nk, userId, NotifyCode.ACCOUNT_UPDATED, 'account_updated', { player: playerView(nk, userId, profile) })
}

// After a change to anything others see: the account's name, the lobby and
// the player's own sessions all catch up.
export function profileChanged(nk: nkruntime.Nakama, userId: string, profile: Profile) {
	syncDisplayName(nk, userId, profile)
	pushToLobby(nk, userId, { displayName: shownNameOf(nk, userId, profile), preferredJoker: profile.preferredJoker })
	accountUpdated(nk, userId, profile)
}

// {useDiscordName} -> {player}. Using the Discord name needs a linked Discord.
export function rpcProfileSetDisplay(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	const userId = requireUser(ctx)
	const value = parsePayload(payload).useDiscordName
	if (typeof value !== 'boolean') throw runtimeError(INVALID_ARGUMENT, 'Missing or invalid useDiscordName (boolean)')
	const profile = updateProfile(
		nk,
		userId,
		(current) => {
			if (value && !current.discordIdHash) throw runtimeError(FAILED_PRECONDITION, 'Discord account not linked')
			return { ...current, useDiscordName: value }
		},
		ctx.username,
	)
	syncDisplayName(nk, userId, profile)
	pushToLobby(nk, userId, { displayName: shownNameOf(nk, userId, profile), preferredJoker: profile.preferredJoker })
	accountUpdated(nk, userId, profile)
	return JSON.stringify({ player: playerView(nk, userId, profile) })
}

// {preferredJoker} -> {player}. Only a default joker, one the player's
// privileges grant, or one they have earned.
export function rpcProfileSetJoker(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	const userId = requireUser(ctx)
	const joker = parsePayload(payload).preferredJoker
	if (typeof joker !== 'string' || !joker) throw runtimeError(INVALID_ARGUMENT, 'Missing or invalid preferredJoker (string)')
	const unlocked = progressFor(nk, userId).unlocked
	const profile = updateProfile(
		nk,
		userId,
		(current) => {
			if (!isSelectable(joker, { privileges: current.privileges, unlocked }))
				throw runtimeError(INVALID_ARGUMENT, 'Invalid joker')
			return { ...current, preferredJoker: joker }
		},
		ctx.username,
	)
	pushToLobby(nk, userId, { displayName: shownNameOf(nk, userId, profile), preferredJoker: profile.preferredJoker })
	accountUpdated(nk, userId, profile)
	return JSON.stringify({ player: playerView(nk, userId, profile) })
}

// {mods: string[]} -> {mods}. What the client has installed, for the lobby
// info overlay's Mods tab.
export function rpcProfileSetMods(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	const userId = requireUser(ctx)
	const mods = parsePayload(payload).mods
	if (!Array.isArray(mods) || mods.some((m) => typeof m !== 'string'))
		throw runtimeError(INVALID_ARGUMENT, 'Missing or invalid mods (array of strings)')
	const list = (mods as string[]).slice(0, MAX_MODS).map((m) => m.slice(0, MAX_MOD_LENGTH))
	updateProfile(nk, userId, (current) => ({ ...current, mods: list }), ctx.username)
	const now = Date.now()
	writeModReport(nk, userId, { mods: list, reportedAt: now })
	const standing = standingFor(nk, settingsOf(ctx), userId, now)
	pushToLobby(nk, userId, { mods: list, standing: standing.standing, pvpVersion: pvpVersionOf(list) })
	return JSON.stringify({ mods: list, standing })
}

// {userId, muted} -> {mutedPlayerIds}.
export function rpcMuteSet(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	const userId = requireUser(ctx)
	const body = parsePayload(payload)
	const target = body.userId
	if (typeof target !== 'string' || !USER_ID.test(target)) throw runtimeError(INVALID_ARGUMENT, 'Invalid userId')
	if (target === userId) throw runtimeError(INVALID_ARGUMENT, 'Cannot mute yourself')
	if (typeof body.muted !== 'boolean') throw runtimeError(INVALID_ARGUMENT, 'Missing or invalid muted (boolean)')
	const muted = body.muted
	const profile = updateProfile(
		nk,
		userId,
		(current) => {
			const rest = current.mutedUserIds.filter((id) => id !== target)
			if (muted && rest.length >= MAX_MUTES) throw runtimeError(FAILED_PRECONDITION, 'Too many muted players')
			return { ...current, mutedUserIds: muted ? rest.concat([target]) : rest }
		},
		ctx.username,
	)
	return JSON.stringify({ mutedPlayerIds: profile.mutedUserIds })
}
