// Lobby RPCs. Joining itself is a socket match_join on the id lobby_find (or
// lobby_create) returns; these only find, create and leave matches.
import { standingFor } from '../standing/current'
import {
	ALREADY_EXISTS,
	FAILED_PRECONDITION,
	INVALID_ARGUMENT,
	NOT_FOUND,
	PERMISSION_DENIED,
	RESOURCE_EXHAUSTED,
	UNAUTHENTICATED,
	UNAVAILABLE,
	runtimeError,
} from '../errors'
import { readConfig } from '../config'
import { lobbyCreateRefusal } from '../moderation/access'
import { profileFor } from '../player/profile'
import { parsePayload, requireUser } from '../rpc'
import { bindCode, lookupCode, releaseCode, reserveCode } from './codes'
import {
	CURRENT_LOBBY_COLLECTION,
	CURRENT_LOBBY_KEY,
	LOBBY_MATCH,
	type LobbySignal,
} from './protocol'
import { resumeLobby } from './checkpoint'
import { spendLobbyCreate } from './create_limit'
import { noteReturn } from './forfeits'
import { DIFFERENT_MOD, MAX_PLAYERS, MIN_PLAYERS } from './state'
import { spectatableLobbies } from './spectate'
import { settingsOf } from '../server_kind'

// Same alphabet as the API's generateLobbyCode (no I or O), and the same
// lengths: 6 for manual lobbies, 5 for matchmade ones.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ123456789'
const CODE_LENGTH = 6
export const MATCHMADE_CODE_LENGTH = 5
const CODE_PATTERN = /^[A-HJ-NP-Z1-9]{5,6}$/
export const CODE_ATTEMPTS = 10
const MOD_ID_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/
const DEFAULT_MAX_PLAYERS = 16
const RANKED_MODE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/

export function generateCode(length: number = CODE_LENGTH): string {
	let code = ''
	for (let i = 0; i < length; i++) {
		code += CODE_CHARS.charAt(Math.floor(Math.random() * CODE_CHARS.length))
	}
	return code
}

export interface Seat {
	matchId: string
	code: string
	modId: string
}

// The lobby the user is still seated in, per their current-lobby record:
// 'resuming' while another caller brings it back after a server restart, else
// null (clearing a record that no longer holds). A record whose match is gone
// is resumed from its restart checkpoint, if one is there.
export function seatOf(
	nk: nkruntime.Nakama,
	logger: nkruntime.Logger | null,
	userId: string,
): Seat | 'resuming' | null {
	const key = {
		collection: CURRENT_LOBBY_COLLECTION,
		key: CURRENT_LOBBY_KEY,
		userId,
	}
	const objects = nk.storageRead([key])
	if (objects.length === 0) return null
	let matchId = objects[0].value.matchId
	const code = objects[0].value.code
	let modId = String(objects[0].value.modId || '')
	if (typeof matchId === 'string' && typeof code === 'string' && !nk.matchGet(matchId)) {
		const resumed = resumeLobby(nk, logger, code, Date.now())
		if (resumed.kind === 'resuming') return 'resuming'
		if (resumed.kind === 'resumed') {
			matchId = resumed.matchId
			modId = resumed.modId
		}
	}
	if (
		typeof matchId === 'string' &&
		typeof code === 'string' &&
		nk.matchGet(matchId)
	) {
		const signal: LobbySignal = { type: 'has_player', userId }
		if (nk.matchSignal(matchId, JSON.stringify(signal)) === 'yes')
			return { matchId, code, modId }
	}
	nk.storageDelete([key])
	return null
}

// The lobby the user is still seated in, or null.
export function currentLobby(nk: nkruntime.Nakama, userId: string): Seat | null {
	const seat = seatOf(nk, null, userId)
	return seat === 'resuming' ? null : seat
}

export function rpcLobbyCreate(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	const userId = requireUser(ctx)
	const input = parsePayload(payload)
	const refused = lobbyCreateRefusal(readConfig(nk), profileFor(nk, userId, ctx.username).privileges)
	if (refused) throw runtimeError(PERMISSION_DENIED, refused)

	const modId = input.modId
	if (typeof modId !== 'string' || !MOD_ID_PATTERN.test(modId)) {
		throw runtimeError(INVALID_ARGUMENT, 'modId is required')
	}
	const maxPlayers =
		input.maxPlayers === undefined || input.maxPlayers === null
			? DEFAULT_MAX_PLAYERS
			: input.maxPlayers
	if (
		typeof maxPlayers !== 'number' ||
		maxPlayers % 1 !== 0 ||
		maxPlayers < MIN_PLAYERS ||
		maxPlayers > MAX_PLAYERS
	) {
		throw runtimeError(
			INVALID_ARGUMENT,
			`maxPlayers must be a whole number from ${MIN_PLAYERS} to ${MAX_PLAYERS}`,
		)
	}

	// Ranked lobbies count on a rating board. The matchmaker creates the real
	// ones; only a Dev server (ALLOW_RANKED_LOBBIES, on by default there) lets
	// a client ask for one directly.
	const rankedMode = input.rankedMode
	if (rankedMode !== undefined && rankedMode !== null) {
		if (typeof rankedMode !== 'string' || !RANKED_MODE_PATTERN.test(rankedMode))
			throw runtimeError(INVALID_ARGUMENT, 'rankedMode is not a valid mode')
		if (!settingsOf(ctx).rankedLobbies)
			throw runtimeError(PERMISSION_DENIED, 'Ranked lobbies are not enabled')
	}

	const current = currentLobby(nk, userId)
	if (current)
		throw runtimeError(ALREADY_EXISTS, `Already in lobby ${current.code}`)
	if (!spendLobbyCreate(nk, userId, Date.now()))
		throw runtimeError(RESOURCE_EXHAUSTED, 'Too many lobbies created; try again in a minute')

	for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt++) {
		const code = generateCode()
		if (!reserveCode(nk, code, modId)) continue
		let matchId: string
		try {
			matchId = nk.matchCreate(LOBBY_MATCH, {
				code,
				modId,
				maxPlayers,
				creatorId: userId,
				rankedMode: typeof rankedMode === 'string' ? rankedMode : '',
			})
		} catch (e) {
			releaseCode(nk, code, '')
			throw e
		}
		bindCode(nk, code, matchId, modId)
		return JSON.stringify({ matchId, code })
	}
	logger.error(
		'Could not find a free lobby code after %d attempts',
		CODE_ATTEMPTS,
	)
	throw runtimeError(UNAVAILABLE, 'Could not allocate a lobby code')
}

export function rpcLobbyFind(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireUser(ctx)
	const input = parsePayload(payload)
	const code = typeof input.code === 'string' ? input.code.toUpperCase() : ''
	if (!CODE_PATTERN.test(code))
		throw runtimeError(INVALID_ARGUMENT, 'Invalid lobby code')

	const askedModId = optionalModId(input.modId)
	const found = findByCode(nk, logger, code)
	if (askedModId !== null && askedModId !== found.modId)
		throw runtimeError(FAILED_PRECONDITION, DIFFERENT_MOD)
	return JSON.stringify({ matchId: found.matchId, code, modId: found.modId })
}

// lobby_find's {modId}: null when the caller doesn't say (clients before the
// mod check), else the mod the lobby must be for.
function optionalModId(modId: unknown): string | null {
	if (modId === undefined || modId === null || modId === '') return null
	if (typeof modId !== 'string' || !MOD_ID_PATTERN.test(modId))
		throw runtimeError(INVALID_ARGUMENT, 'Invalid modId')
	return modId
}

function findByCode(
	nk: nkruntime.Nakama,
	logger: nkruntime.Logger,
	code: string,
): { matchId: string; modId: string } {
	const entry = lookupCode(nk, code)
	if (entry) return { matchId: entry.matchId, modId: entry.modId }
	// A lobby stopped by a server restart comes back under its code.
	const resumed = resumeLobby(nk, logger, code, Date.now())
	if (resumed.kind === 'resuming')
		throw runtimeError(UNAVAILABLE, 'The lobby is resuming, try again')
	if (resumed.kind === 'none') throw runtimeError(NOT_FOUND, 'Lobby not found')
	return { matchId: resumed.matchId, modId: resumed.modId }
}

const SPECTATE_LIST_LIMIT = 100

// {modId?} -> {lobbies: [{code, modId, playerCount, started, spectators}]}:
// the lobbies a player may watch (match_join with metadata role=spectator on
// the id lobby_find returns).
export function rpcSpectateList(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	requireUser(ctx)
	const modId = parsePayload(payload).modId
	let query = '+label.spectatable:T'
	if (modId !== undefined && modId !== null && modId !== '') {
		if (typeof modId !== 'string' || !MOD_ID_PATTERN.test(modId))
			throw runtimeError(INVALID_ARGUMENT, 'Invalid modId')
		query += ' +label.modId:' + modId.replace(/[^A-Za-z0-9_]/g, '\\$&')
	}
	const labels = nk
		.matchList(SPECTATE_LIST_LIMIT, true, null, null, null, query)
		.map((m) => m.label || '')
	return JSON.stringify({ lobbies: spectatableLobbies(labels) })
}

export function rpcLobbyCurrent(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	// {resuming: true}: the lobby is coming back from a restart; ask again.
	const userId = requireUser(ctx)
	noteReturn(nk, logger, userId, Date.now())
	const seat = seatOf(nk, logger, userId)
	if (seat === 'resuming') return JSON.stringify({ resuming: true })
	return JSON.stringify(seat || {})
}

// {} when the caller isn't in a running game, else {active: {runId, code,
// modId, events, requiredStanding, runSave, runSaveSkipped, logText},
// standing}: what the reconnect prompt needs to catch a restarted client up
// (the API's GET /runs/mine/active, on Nakama), and whether it may come back
// (standing/rejoin.ts).
export function rpcRunActive(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	const userId = requireUser(ctx)
	const current = currentLobby(nk, userId)
	if (!current) return JSON.stringify({})
	const signal: LobbySignal = { type: 'get_active', userId }
	const active = JSON.parse(nk.matchSignal(current.matchId, JSON.stringify(signal)))
	// With the caller's standing, so the client knows before it tries whether
	// it meets active.requiredStanding.
	return JSON.stringify(active ? { active, standing: standingFor(nk, settingsOf(ctx), userId, Date.now()) } : {})
}

// Leave the current lobby without joining its match first (the reconnect
// prompt's Leave button after a game restart).
export function rpcLobbyLeave(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	const userId = requireUser(ctx)
	const current = currentLobby(nk, userId)
	if (current) {
		const signal: LobbySignal = { type: 'leave', userId }
		nk.matchSignal(current.matchId, JSON.stringify(signal))
	}
	return JSON.stringify({})
}
