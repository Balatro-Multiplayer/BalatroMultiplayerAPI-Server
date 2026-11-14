// Admin RPCs: server to server only (the runtime http key, no player
// session), for the BMP API to drive Nakama. Called as
// POST /v2/rpc/<id>?http_key=...&unwrap with a JSON body.
import { standingInputsChanged } from './standing/allowed'
import { standingInputsUpdated } from './standing/changed'
import { INVALID_ARGUMENT, NOT_FOUND, runtimeError } from './errors'
import { lookupCode } from './lobby/codes'
import type { LobbySignal } from './lobby/protocol'
import { currentLobby } from './lobby/rpc'
import { isBanType, readBans } from './moderation/bans'
import { applyBan, liftBan, forgetBanIndex } from './moderation/enforce'
import { banNetworks } from './moderation/network'
import { playerView, profileFor } from './player/profile'
import { mergeConfig, pvpModesOf, readConfig, writeConfig } from './config'
import { callExpress } from './express'
import { isNotifyCode, notify } from './notify'
import { parsePayload, requireServer } from './rpc'
import { ackEntries, pullEntries } from './mirror/outbox'
import { moderationContextOf } from './review/rpc'
import { settingsOf } from './server_kind'

const USER_ID_PATTERN = /^[0-9a-f-]{36}$/

// {} -> {ok, express}: express is whether Nakama could reach the API's
// internal routes back, so one call checks both directions.
export function rpcAdminPing(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const reply = callExpress(nk, logger, ctx.env, '/ping', {})
	return JSON.stringify({ ok: true, express: reply !== null && reply.status === 200 })
}

// Whether the player has a socket open (Nakama's notification stream).
function isOnline(nk: nkruntime.Nakama, userId: string): boolean {
	try {
		return nk.streamUserList({ mode: 0, subject: userId }).length > 0
	} catch (e) {
		return true
	}
}

// {userId, code, subject?, content?, persistent?} -> {online}: online is
// whether a transient notification could have reached anyone.
export function rpcAdminNotify(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const input = parsePayload(payload)
	if (typeof input.userId !== 'string' || !USER_ID_PATTERN.test(input.userId))
		throw runtimeError(INVALID_ARGUMENT, 'userId is required')
	if (!isNotifyCode(input.code)) throw runtimeError(INVALID_ARGUMENT, 'Unknown notification code')
	const content =
		typeof input.content === 'object' && input.content !== null && !Array.isArray(input.content)
			? (input.content as { [key: string]: unknown })
			: {}
	notify(
		nk,
		input.userId,
		input.code,
		typeof input.subject === 'string' ? input.subject : '',
		content,
		input.persistent === true,
	)
	return JSON.stringify({ online: isOnline(nk, input.userId) })
}

// {<any ServerConfig fields>} -> the whole config after the update.
export function rpcAdminConfigSet(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const update = parsePayload(payload)
	// The kill switch must not fail quietly: a malformed list is refused by name, and the
	// current list stays.
	if ('disabledPvpModes' in update && pvpModesOf(update.disabledPvpModes) === null) {
		logger.warn('admin_config_set refused: disabledPvpModes must be a list of known PvP modes, each once')
		throw runtimeError(INVALID_ARGUMENT, 'disabledPvpModes must be a list of known PvP modes, each at most once')
	}
	const before = readConfig(nk, logger)
	const config = mergeConfig(before, update)
	writeConfig(nk, config)
	logger.info('Server config updated: %v', JSON.stringify(config))
	if (standingInputsChanged(before, config)) standingInputsUpdated(nk, settingsOf(ctx), logger, Date.now())
	return JSON.stringify(config)
}

// ---------------------------------------------------------------------------
// Bans (moderation/enforce.ts)
// ---------------------------------------------------------------------------

// input.userId, which must name an account.
export function requireUserId(nk: nkruntime.Nakama, input: { [key: string]: unknown }): string {
	if (typeof input.userId !== 'string' || !USER_ID_PATTERN.test(input.userId))
		throw runtimeError(INVALID_ARGUMENT, 'userId is required')
	try {
		nk.accountGetId(input.userId)
	} catch (e) {
		throw runtimeError(NOT_FOUND, 'No such user')
	}
	return input.userId
}

// expiresAt as epoch ms, an ISO date string, or null for permanent.
export function parseExpiresAt(value: unknown): number | null | undefined {
	if (value === null || value === undefined) return null
	if (typeof value === 'number' && Number.isFinite(value)) return value
	if (typeof value === 'string') {
		const ms = Date.parse(value)
		if (Number.isFinite(ms)) return ms
	}
	return undefined
}

// {userId, type, banId, expiresAt?, reason?} -> {bans}.
export function rpcAdminBanApply(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const input = parsePayload(payload)
	const userId = requireUserId(nk, input)
	if (!isBanType(input.type)) throw runtimeError(INVALID_ARGUMENT, "type must be 'chat', 'queue', 'account' or 'username'")
	if (typeof input.banId !== 'string' || !input.banId) throw runtimeError(INVALID_ARGUMENT, 'banId is required')
	const expiresAt = parseExpiresAt(input.expiresAt)
	if (expiresAt === undefined) throw runtimeError(INVALID_ARGUMENT, 'expiresAt must be a time or null')
	const reason = typeof input.reason === 'string' ? input.reason : ''
	const bans = applyBan(nk, logger, userId, input.type, { banId: input.banId, expiresAt, reason })
	if (bans.account && banNetworks(nk, settingsOf(ctx), userId, bans.account, Date.now()))
		logger.info('Network ban %s from %s', bans.account.banId, userId)
	return JSON.stringify({ bans })
}

// {userId, banId} -> {bans}.
export function rpcAdminBanLift(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const input = parsePayload(payload)
	const userId = requireUserId(nk, input)
	if (typeof input.banId !== 'string' || !input.banId) throw runtimeError(INVALID_ARGUMENT, 'banId is required')
	return JSON.stringify({ bans: liftBan(nk, logger, userId, input.banId) })
}

// {steamIdHashes} -> {deleted}: forgets the ban index entries of deleted
// accounts whose Steam id hash Postgres has just cleared (the API's hourly
// job; moderation/enforce.ts forgetBanIndex).
export function rpcAdminBanIndexForget(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const hashes = parsePayload(payload).steamIdHashes
	if (!Array.isArray(hashes) || !hashes.every((h) => typeof h === 'string'))
		throw runtimeError(INVALID_ARGUMENT, 'steamIdHashes must be a list of hashes')
	const result = forgetBanIndex(nk, hashes, Date.now())
	if (result.deleted > 0) logger.info('Forgot %d ban index entries of deleted accounts', result.deleted)
	return JSON.stringify(result)
}

// ---------------------------------------------------------------------------
// Lobbies and players, for webadmin
// ---------------------------------------------------------------------------

const MOD_ID_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/
const LOBBY_LIST_LIMIT = 100

// {modId?} -> {lobbies: [{matchId, size, ...label}]}: the first 100.
export function rpcAdminLobbyList(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const modId = parsePayload(payload).modId
	let query: string | null = null
	if (modId !== undefined) {
		if (typeof modId !== 'string' || !MOD_ID_PATTERN.test(modId))
			throw runtimeError(INVALID_ARGUMENT, 'modId is not valid')
		query = '+label.modId:' + modId.replace(/[^A-Za-z0-9_]/g, '\\$&')
	}
	const lobbies = nk.matchList(LOBBY_LIST_LIMIT, true, null, null, null, query || '*').map((m) => {
		let label: { [key: string]: unknown } = {}
		try {
			label = JSON.parse(m.label || '{}')
		} catch (e) {
			// An unlabelled match: listed bare.
		}
		return { ...label, matchId: m.matchId, connected: m.size }
	})
	return JSON.stringify({ lobbies })
}

function lobbyByCode(nk: nkruntime.Nakama, code: unknown) {
	if (typeof code !== 'string' || !code) throw runtimeError(INVALID_ARGUMENT, 'code is required')
	const entry = lookupCode(nk, code.toUpperCase())
	if (!entry) throw runtimeError(NOT_FOUND, 'No such lobby')
	return entry
}

// {code} -> {lobby: {code, modId, hostId, players: [{id, displayName,
// connected}], ...}}.
export function rpcAdminLobbyGet(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const lobby = lobbyByCode(nk, parsePayload(payload).code)
	const signal: LobbySignal = { type: 'admin_view' }
	const view = nk.matchSignal(lobby.matchId, JSON.stringify(signal))
	if (!view) throw runtimeError(NOT_FOUND, 'No such lobby')
	return JSON.stringify({ lobby: { ...JSON.parse(view), matchId: lobby.matchId } })
}

// {code, userId, reason?} -> {ok}. The player can't come back.
export function rpcAdminLobbyKick(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const input = parsePayload(payload)
	const lobby = lobbyByCode(nk, input.code)
	if (typeof input.userId !== 'string' || !input.userId) throw runtimeError(INVALID_ARGUMENT, 'userId is required')
	const signal: LobbySignal = {
		type: 'admin_remove',
		userId: input.userId,
		reason: typeof input.reason === 'string' ? input.reason : 'admin',
	}
	if (nk.matchSignal(lobby.matchId, JSON.stringify(signal)) === 'not_member')
		throw runtimeError(NOT_FOUND, 'Player is not in this lobby')
	return JSON.stringify({ ok: true })
}

// {code} -> {ok}.
export function rpcAdminLobbyClose(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const lobby = lobbyByCode(nk, parsePayload(payload).code)
	const signal: LobbySignal = { type: 'admin_close' }
	nk.matchSignal(lobby.matchId, JSON.stringify(signal))
	return JSON.stringify({ ok: true })
}

// {userId} -> {player, bans, lobby, online, mods, standing, integrity,
// ranked: {queued, inGame}}: what webadmin and the service queue show of a
// Nakama account.
export function rpcAdminPlayerGet(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const input = parsePayload(payload)
	const userId = requireUserId(nk, input)
	const profile = profileFor(nk, userId)
	const online = nk.streamUserList({ mode: 0, subject: userId }, true, true).length
	return JSON.stringify({
		player: playerView(nk, userId, profile),
		bans: readBans(nk, userId),
		lobby: currentLobby(nk, logger, userId),
		online,
		...moderationContextOf(nk, logger, settingsOf(ctx), userId, Date.now()),
	})
}

// ---------------------------------------------------------------------------
// The Postgres mirror (mirror/outbox.ts)
// ---------------------------------------------------------------------------

const MIRROR_PULL_DEFAULT = 10
const MIRROR_PULL_MAX = 50
const MIRROR_ACK_MAX = 500

// {limit?} -> {entries, players}: the oldest outbox entries, expanded. Entries
// that can no longer be expanded are deleted here.
export function rpcAdminMirrorPull(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const limit = parsePayload(payload).limit
	const count =
		typeof limit === 'number' && Number.isInteger(limit) && limit > 0
			? Math.min(limit, MIRROR_PULL_MAX)
			: MIRROR_PULL_DEFAULT
	const pulled = pullEntries(nk, count)
	if (pulled.dropped.length > 0) {
		logger.warn('Mirror: dropping %d entries that no longer resolve', pulled.dropped.length)
		ackEntries(nk, pulled.dropped)
	}
	return JSON.stringify({ entries: pulled.entries, players: pulled.players })
}

// {keys} -> {acked}: the entries the API has stored.
export function rpcAdminMirrorAck(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireServer(ctx)
	const keys = parsePayload(payload).keys
	if (!Array.isArray(keys) || keys.length > MIRROR_ACK_MAX || !keys.every((k) => typeof k === 'string' && k !== ''))
		throw runtimeError(INVALID_ARGUMENT, 'keys must be a list of entry keys')
	ackEntries(nk, keys as string[])
	return JSON.stringify({ acked: keys.length })
}
