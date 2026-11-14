// What every PvP fact reducer shares (docs/pvp-match.md section 3): the match
// keys a reducer reports, the refusal and result shapes, the common gate, and the
// writer of a player's round entry. facts.ts and timer_facts.ts hold the reducers.
import { isRecord } from './payload'
import type { PvpRoundPlayer, RefereeState } from './state'

export const PVP_ROUND_KEY = 'pvp.round'
export const PVP_VOTES_KEY = 'pvp.votes'
export const PVP_SKIPS_KEY = 'pvp.skips'

export type Refusal = { ok: false; reason: string }
export type FactResult =
	| { ok: true; state: RefereeState; changed: string[] }
	| Refusal

export type FactReducer = (
	state: RefereeState,
	id: string,
	args: unknown,
) => FactResult

export const refuse = (reason: string): Refusal => ({ ok: false, reason })
export const unchanged = (state: RefereeState): FactResult => ({
	ok: true,
	state,
	changed: [],
})

// Out of the run: eliminated, forfeited or left (the tick's flags), or a
// forfeit fact the tick has not read yet.
export function isOut(state: RefereeState, id: string): boolean {
	const life = state.lives.players[id]
	if (life && (life.eliminated || life.forfeited || life.left)) return true
	return state.facts.log.some((f) => f.type === 'forfeit' && f.playerId === id)
}

// The common refusals after the payload parsed: a stale runId or a decided
// game (a decided game is frozen) is `round_over`; a player who is out is `eliminated`.
export function gate(
	state: RefereeState,
	id: string,
	runId: string,
	allowOut = false,
): Refusal | null {
	if (runId !== state.runId) return refuse('round_over')
	if (state.result.runId === state.runId && state.result.kind !== null)
		return refuse('round_over')
	if (!allowOut && isOut(state, id)) return refuse('eliminated')
	return null
}

export function runIdOf(args: unknown): string | null {
	return isRecord(args) && typeof args.runId === 'string' ? args.runId : null
}

// The hands a player has left: what it counted (`reportedHands`) less the
// run-outs the server accepted since (`timerLosses`, less the `applied` ones the
// player had already subtracted when it counted). The ONLY place handsLeft is
// derived: blind_start, hand and a PvP run-out all write through it.
export function handsAfter(
	reportedHands: number,
	applied: number,
	timerLosses: number,
): number {
	return Math.max(0, reportedHands - (timerLosses - applied))
}

// A player's round entry, or the refusal that follows from having none: entries
// exist from the seat (modes/common.ts seatPlayers) and no fact creates one.
export function entryOf(
	state: RefereeState,
	id: string,
): PvpRoundPlayer | Refusal {
	const entry = state.round.players[id]
	return entry === undefined ? refuse('no_entry') : entry
}

// Writes the player's round entry; `roundId` also stamps which round the entry's
// hand belongs to (`facts.handRound`, only a real pvp.hand passes one), or leaves
// the stamp alone when null.
export function withPlayer(
	state: RefereeState,
	id: string,
	entry: PvpRoundPlayer,
	roundId: number | null = null,
): RefereeState {
	return {
		...state,
		round: {
			...state.round,
			runId: state.runId,
			players: { ...state.round.players, [id]: entry },
		},
		facts: {
			...state.facts,
			handRound:
				roundId === null
					? state.facts.handRound
					: { ...state.facts.handRound, [id]: roundId },
		},
	}
}
