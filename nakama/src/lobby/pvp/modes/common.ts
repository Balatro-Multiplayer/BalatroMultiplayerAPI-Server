// What the modes share (docs/pvp-match.md section 6): the seats and the round
// opening of every mode, the win check and forfeit rule of a last-one-standing
// game (duel, Royale, Nemesis), and the small questions every mode asks of the
// state. Every hook is pure: (state, ctx) -> state, and returns the same object
// when it changes nothing.
import type {
	ModeView,
	PvpLifePlayer,
	PvpResult,
	PvpRoundPlayer,
} from '../state'
import type { Hook, RoundReadyHook } from './types'

// A seat's entry before the client reports anything: every game fact is null
// (unknown), the server-owned counters are real zeros.
const freshRoundPlayer = (): PvpRoundPlayer => ({
	score: null,
	handsLeft: null,
	highestScore: null,
	ante: null,
	furthestBlind: null,
	reportedHands: null,
	reportedApplied: 0,
	timerLosses: 0,
	handsSpent: false,
	committedHands: null,
	creditedHands: null,
	pvpLeftMs: null,
})

// The one "no hands left" predicate: the server ended the player's hands, or the
// count reached 0. An unknown count (null) is not done.
export const handsDone = (p: PvpRoundPlayer): boolean =>
	p.handsSpent || p.handsLeft === 0

// Alive: in the run AND a life left. `inRunIgnoringLives` (state.ts) is the other
// rule: it ignores lives, so a seat at 0 with a pending death still counts.
// A mode decides who plays on with this; the shared code that waits on a seat
// uses `inRunIgnoringLives`.
export const inRunWithLives = (p: PvpLifePlayer): boolean =>
	p.lives > 0 && !p.eliminated && !p.forfeited && !p.left

// The seats of the match, in a stable order.
export function seatIds(state: ModeView): string[] {
	return [
		...new Set([
			...Object.keys(state.lives.players),
			...Object.keys(state.round.players),
		]),
	].sort()
}

// The started seats that have not left the lobby (an eliminated player counts).
export function seatedIds(state: ModeView): string[] {
	return Object.keys(state.lives.players)
		.filter((id) => !state.lives.players[id].left)
		.sort()
}

export function aliveIds(state: ModeView): string[] {
	return Object.keys(state.lives.players)
		.filter((id) => inRunWithLives(state.lives.players[id]))
		.sort()
}

// The highest ante any player has reported, null when none has.
export const highestAnte = (state: ModeView): number | null =>
	Object.values(state.round.players).reduce<number | null>(
		(best, p) =>
			p.ante === null ? best : best === null ? p.ante : Math.max(best, p.ante),
		null,
	)

// The score a player has reported this round, null when none (or no entry).
export const scoreOf = (state: ModeView, id: string): string | null => {
	const entry = state.round.players[id]
	return entry === undefined ? null : entry.score
}

// True when every one of `ids` is done with its hands. A player who has not
// started (no entry, or an unknown count) is not done.
export const allOutOfHands = (state: ModeView, ids: string[]): boolean =>
	ids.every((id) => {
		const entry = state.round.players[id]
		return entry !== undefined && handsDone(entry)
	})

// R1: every player starts with the starting lives and an empty round entry (every
// game fact unknown). A runId already settled is left alone (once per run).
export const seatPlayers: Hook = (state) => {
	const { rules } = state
	if (rules.runId === null || state.round.runId === rules.runId) return state
	const ids = seatIds(state)
	const round: { [id: string]: PvpRoundPlayer } = {}
	const lives: { [id: string]: PvpLifePlayer } = {}
	for (const id of ids) {
		round[id] = freshRoundPlayer()
		lives[id] = {
			lives: rules.startingLives,
			eliminated: false,
			forfeited: false,
			left: false,
			events: [],
		}
	}
	return {
		...state,
		rules,
		round: {
			runId: rules.runId,
			roundId: 0,
			phase: 'shop',
			players: round,
			lastResult: null,
		},
		lives: { runId: rules.runId, players: lives, teamLives: null, pending: [] },
		votes: { runId: rules.runId, draw: [], seed: [] },
	}
}

// R9 (a blind start): the round opens with nothing reported. Call only when a
// pvp.ready start opened a PvP blind; the caller (tick) gates it, and a
// 'resolved' round stays resolved until it is called. R19 (the first player) is
// a client marker from `pvp.ready`.
//
// Every round-scoped fact resets to unknown (never the previous round's value: a
// round that ended at 0 hands would reopen as a tie with both players out); the
// player's pvp.blind_start then reports the real hands and score. The run-scoped
// ones (highest score, ante, furthest blind) are kept.
export function openRound(state: ModeView): ModeView {
	if (
		state.rules.runId === null ||
		state.result.runId !== null ||
		state.round.phase === 'playing'
	)
		return state
	const players: { [id: string]: PvpRoundPlayer } = {}
	// The PvP hand allowance every player starts the round with; null on a ruleset
	// with no PvP clock.
	const pvpLeftMs = state.rules.clocks.pvp?.baseMs ?? null
	for (const [id, p] of Object.entries(state.round.players)) {
		players[id] = {
			...p,
			score: null,
			handsLeft: null,
			reportedHands: null,
			reportedApplied: 0,
			timerLosses: 0,
			handsSpent: false,
			committedHands: null,
			creditedHands: null,
			pvpLeftMs,
		}
	}
	return { ...state, round: { ...state.round, phase: 'playing', players } }
}

// The mode hook every mode uses: opens the round (see
// openRound).
export const roundReady: RoundReadyHook = (state) => openRound(state)

// R18, R20: the match ends when one player is left standing (the one with more
// lives wins), or none is left (a draw). A pending death holds the result.
export const lastPlayerStanding: Hook = (state) => {
	const { rules } = state
	if (rules.runId === null || state.lives.runId !== rules.runId) return state
	if (state.result.runId !== null || state.lives.pending.length > 0)
		return state
	const alive = aliveIds(state)
	if (alive.length > 1) return state
	const others = Object.keys(state.lives.players)
		.filter((id) => !alive.includes(id))
		.sort()
	// no-one alive -> draw (the old host named an arbitrary player)
	const result: PvpResult =
		alive.length === 1
			? {
					runId: rules.runId,
					kind: 'win',
					winnerId: alive[0],
					winnerTeam: null,
					places: [
						{ playerId: alive[0], place: 1 },
						...others.map((playerId) => ({ playerId, place: 2 })),
					],
				}
			: {
					runId: rules.runId,
					kind: 'draw',
					winnerId: null,
					winnerTeam: null,
					places: others.map((playerId) => ({ playerId, place: 1 })),
				}
	return { ...state, result }
}

// R20: a forfeit or a left seat puts that player out
// and the remaining player wins. A player whose pending death waits is not out
// yet: the leave is the tick's to settle (pending.ts decidePending).
export const retireForfeiters: Hook = (state, ctx) => {
	if (state.result.runId !== null) return state
	const waiting = new Set(state.lives.pending.map((p) => p.playerId))
	let changed = false
	const players: { [id: string]: PvpLifePlayer } = {}
	for (const [id, seat] of Object.entries(state.lives.players)) {
		const out = (seat.forfeited || seat.left) && !waiting.has(id)
		if (out && !seat.eliminated) {
			players[id] = { ...seat, eliminated: true }
			changed = true
		} else players[id] = seat
	}
	const next = changed
		? { ...state, lives: { ...state.lives, players } }
		: state
	return lastPlayerStanding(next, ctx)
}
