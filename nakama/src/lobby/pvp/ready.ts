// Server-owned Ready for the PvP rounds (docs/pvp-match.md section 4,
// `pvp.ready`). Pure, like state.ts: plain data in, plain data out, no Nakama
// calls. state.ts and checkpoint.ts call the trigger helpers (a disconnect, a
// removed seat, a resume); the request reducers are listed in register.ts.
//
// The state lives in lobby.game.pvp, so every path that resets lobby.game
// (emptyGame) resets it too. It is made on first use for the started game, and
// one left over from another game (another runId) is never read.
import type { GameState, PvpState } from '../protocol'
import type { Reducer, Reduction } from '../request_types'
import type { Lobby } from '../state'
import { isCount, isRecord } from './payload'
import { isBlindKey, isBossBlind } from './settings'
import type { StoredPvp } from './state'

export const PVP_READY_KEY = 'pvp.ready'

function freshPvp(runId: string): PvpState {
	return {
		runId,
		round: 0,
		ready: {},
		firstReady: null,
		blindKeys: {},
		order: [],
		readied: [],
		lastStart: null,
	}
}

// The running game's Ready state; null when no game is started.
export function pvpOf(lobby: Lobby): PvpState | null {
	const started = lobby.game.started
	if (!started) return null
	const pvp = lobby.game.pvp
	return pvp && pvp.runId === started.runId ? pvp : freshPvp(started.runId)
}

function withPvp(lobby: Lobby, pvp: PvpState): Lobby {
	return { ...lobby, game: { ...lobby.game, pvp } }
}

// R31: the referee holds this player out of the run (eliminated, forfeited or
// left, even while still seated). Read from the referee state beside the Ready
// state (state.ts is not imported: it imports this file).
export function outOfRun(lobby: Lobby, userId: string): boolean {
	const started = lobby.game.started
	const game: StoredPvp | undefined = lobby.game.pvp
	const referee = game?.referee
	if (
		!started ||
		!referee ||
		game?.runId !== started.runId ||
		referee.lives.runId !== started.runId
	)
		return false
	const seat = referee.lives.players[userId]
	return !!seat && (seat.eliminated || seat.forfeited || seat.left)
}

// Started participants still seated, minus the ones the referee holds out of
// the run.
export function requiredIds(lobby: Lobby): string[] {
	const started = lobby.game.started
	if (!started) return []
	const seated = new Set(lobby.players.map((p) => p.id))
	return started.players
		.map((p) => p.id)
		.filter((id) => seated.has(id) && !outOfRun(lobby, id))
}

// The players whose Ready is up, for the timers (deadline.ts).
export function readyIdsOf(pvp: PvpState): string[] {
	return Object.keys(pvp.ready).filter((id) => pvp.ready[id] === true)
}

// The tick's re-check: a player the referee just put out (`left`) may have been
// the one the others waited on. Their Ready goes first, so a start never
// carries them, then the next round starts when that is so.
export function startIfReady(lobby: Lobby, left: string[] = []): Lobby {
	const pvp = pvpOf(lobby)
	if (!pvp) return lobby
	const kept = left.reduce(dropReady, pvp)
	const next = tryStart(kept, requiredIds(lobby))
	return next === pvp ? lobby : withPvp(lobby, next)
}

// Drops one player's Ready. When they were firstReady, the earliest remaining
// ready player takes it (or nobody).
export function dropReady(pvp: PvpState, userId: string): PvpState {
	if (pvp.ready[userId] !== true) return pvp
	const ready = { ...pvp.ready }
	delete ready[userId]
	const blindKeys = { ...pvp.blindKeys }
	delete blindKeys[userId]
	const order = pvp.order.filter((id) => id !== userId)
	return {
		...pvp,
		ready,
		blindKeys,
		order,
		firstReady: pvp.firstReady === userId ? (order[0] ?? null) : pvp.firstReady,
	}
}

// Starts the next round when at least two required players remain and every
// one of them is ready. With fewer, nothing starts: the referee's forfeit flow
// owns that. The start clears `readied`, and nothing else does.
export function tryStart(pvp: PvpState, required: string[]): PvpState {
	if (required.length < 2) return pvp
	if (!required.every((id) => pvp.ready[id] === true)) return pvp
	const round = pvp.round + 1
	return {
		...pvp,
		round,
		ready: {},
		firstReady: null,
		blindKeys: {},
		order: [],
		readied: [],
		lastStart: {
			roundId: round,
			firstPlayer: pvp.firstReady,
			players: [...pvp.order],
			blindKeys: { ...pvp.blindKeys },
		},
	}
}

// The value of the `pvp.ready` key: exactly the shape of docs/pvp-match.md section 4.
export function projectReady(lobby: Lobby): unknown {
	const pvp = pvpOf(lobby)
	// Never null: a client cannot delete a key with a null in a non-full STATE.
	if (!pvp)
		return {
			runId: null,
			round: 0,
			ready: {},
			firstReady: null,
			lastStart: null,
		}
	return {
		runId: pvp.runId,
		round: pvp.round,
		ready: { ...pvp.ready },
		firstReady: pvp.firstReady,
		lastStart: pvp.lastStart
			? {
					roundId: pvp.lastStart.roundId,
					firstPlayer: pvp.lastStart.firstPlayer,
					players: [...pvp.lastStart.players],
				}
			: null,
	}
}

export interface Triggered {
	lobby: Lobby
	// The `pvp.ready` key changed, so the caller announces it.
	changed: boolean
}

// A player's socket dropped (their seat enters grace): their Ready goes, so a
// blind never starts against a player who is not there (#620).
export function readyDroppedOnDisconnect(
	lobby: Lobby,
	userId: string,
): Triggered {
	const pvp = pvpOf(lobby)
	if (!pvp || pvp.ready[userId] !== true) return { lobby, changed: false }
	return { lobby: withPvp(lobby, dropReady(pvp, userId)), changed: true }
}

// A seat is gone (grace expiry, catch-up limit, leave, kick): `lobby` no
// longer seats them. Their Ready goes, and the round starts if they were the
// one the others waited on.
export function readyAfterSeatRemoved(lobby: Lobby, userId: string): Triggered {
	const pvp = pvpOf(lobby)
	if (!pvp) return { lobby, changed: false }
	const wasReady = pvp.ready[userId] === true
	const kept = dropReady(pvp, userId)
	const next = tryStart(kept, requiredIds(lobby))
	if (!wasReady && next === kept) return { lobby, changed: false }
	return { lobby: withPvp(lobby, next), changed: true }
}

// After a server restart nobody is attached: every Ready is void. The game,
// the round count and the last start stay.
export function gameAfterResume(game: GameState): GameState {
	const pvp = game.pvp
	if (!pvp) return game
	return {
		...game,
		pvp: {
			...pvp,
			ready: {},
			firstReady: null,
			blindKeys: {},
			order: [],
		},
	}
}


// The round that start `startId` opened has not resolved: the tick has not
// opened it yet, or it is still playing. Read from the referee state beside the
// Ready state, like outOfRun.
function roundIsOpen(lobby: Lobby, startId: number): boolean {
	const game: StoredPvp | undefined = lobby.game.pvp
	const round = game?.referee?.round
	if (!round) return true
	return round.roundId < startId || round.phase !== 'resolved'
}

type Seat =
	| { ok: true; pvp: PvpState }
	| { ok: false; reason: 'no_game' | 'no_seat' }

// The request's common gate: a game is running and the sender plays in it.
function playingSeat(lobby: Lobby, senderId: string): Seat {
	const started = lobby.game.started
	const pvp = pvpOf(lobby)
	if (!started || !pvp) return { ok: false, reason: 'no_game' }
	const seated = lobby.players.some((p) => p.id === senderId)
	if (!seated || !started.players.some((p) => p.id === senderId))
		return { ok: false, reason: 'no_seat' }
	return { ok: true, pvp }
}

type Round =
	| { ok: true; blindKey: string | null }
	| { ok: false; reason: 'bad_payload' | 'round_over' | 'bad_round' }

// {runId, roundId, blindKey?}: which round the player means. A Ready (wantsKey)
// also carries the blind it is made on, required; an Unready has none (null).
function roundOf(pvp: PvpState, payload: unknown, wantsKey: boolean): Round {
	const blindKey = isRecord(payload) ? payload.blindKey : undefined
	if (
		!isRecord(payload) ||
		typeof payload.runId !== 'string' ||
		!isCount(payload.roundId) ||
		(wantsKey && !isBlindKey(blindKey))
	)
		return { ok: false, reason: 'bad_payload' }
	if (payload.runId !== pvp.runId || payload.roundId <= pvp.round)
		return { ok: false, reason: 'round_over' }
	if (payload.roundId > pvp.round + 1) return { ok: false, reason: 'bad_round' }
	return {
		ok: true,
		blindKey: isBlindKey(blindKey) ? blindKey : null,
	}
}

const unchanged = (lobby: Lobby): Reduction => ({
	ok: true,
	lobby,
	changed: [],
})

const changed = (lobby: Lobby): Reduction => ({
	ok: true,
	lobby,
	changed: [PVP_READY_KEY],
})

function reduceReady(
	lobby: Lobby,
	senderId: string,
	payload: unknown,
): Reduction {
	const seat = playingSeat(lobby, senderId)
	if (!seat.ok) return seat
	const round = roundOf(seat.pvp, payload, true)
	if (!round.ok) return round
	const blindKey = round.blindKey
	if (blindKey === null) return { ok: false, reason: 'bad_payload' }
	if (!isBossBlind(blindKey)) return { ok: false, reason: 'not_pvp_blind' }
	const pvp = seat.pvp
	// R31: a player the referee holds out of the run cannot Ready.
	if (outOfRun(lobby, senderId)) return { ok: false, reason: 'eliminated' }
	// The blind this player's round just started on is spent while that round is
	// open: a Ready pressed in the start countdown would open the next round at
	// once. Once the round resolved, the same key is a new blind (a Manhunt
	// voucher lowers the ante, so the next Boss can repeat the key).
	if (
		pvp.lastStart?.blindKeys[senderId] === blindKey &&
		roundIsOpen(lobby, pvp.lastStart.roundId)
	)
		return { ok: false, reason: 'round_over' }
	// A repeat Ready changes nothing.
	if (pvp.ready[senderId] === true) return unchanged(lobby)
	const next: PvpState = {
		...pvp,
		ready: { ...pvp.ready, [senderId]: true },
		blindKeys: { ...pvp.blindKeys, [senderId]: blindKey },
		order: pvp.order.concat([senderId]),
		readied: pvp.readied.includes(senderId)
			? pvp.readied
			: [...pvp.readied, senderId],
		firstReady: pvp.firstReady ?? senderId,
	}
	return changed(withPvp(lobby, tryStart(next, requiredIds(lobby))))
}

function reduceUnready(
	lobby: Lobby,
	senderId: string,
	payload: unknown,
): Reduction {
	const seat = playingSeat(lobby, senderId)
	if (!seat.ok) return seat
	const round = roundOf(seat.pvp, payload, false)
	if (!round.ok) return round
	if (seat.pvp.ready[senderId] !== true) return unchanged(lobby)
	return changed(withPvp(lobby, dropReady(seat.pvp, senderId)))
}

export const readyReducer: Reducer = {
	keys: { [PVP_READY_KEY]: projectReady },
	reduce: (lobby, senderId, payload) => reduceReady(lobby, senderId, payload),
}

export const unreadyReducer: Reducer = {
	keys: { [PVP_READY_KEY]: projectReady },
	reduce: (lobby, senderId, payload) => reduceUnready(lobby, senderId, payload),
}
