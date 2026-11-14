// The duel rule set: exactly two players (docs/pvp-match.md section 6), the rules
// R1, R9, R16-R21 of the appendix. Seats, round opening, the win check and
// forfeits are the shared ones (modes/common.ts); this file adds the round
// resolution of two players and the opponent view. Every hook is pure:
// (state, ctx) -> state, and returns the same object when it changes nothing.
//
// What the hooks do not do, by design:
// - Blind results (beaten / failed) are not part of the ModeView (the tick reads
//   `facts.blinds`, deaths.ts), so the pending death (R11, R21) is settled by
//   the tick with `decidePending` (pending.ts); while a pending death waits,
//   checkWinner and onForfeit leave the result alone.
// - Every life change is the tick's (guards R2/R4, the ante timer R3, the PvP
//   loss R18): resolveRound only names the losers in `round.lastResult`.
// - The roster is the seats of `lives.players` and `round.players`, which the
//   tick fills with the started ids before `init` runs.
import { compareRoundScore } from '../score'
import type { ModeView } from '../state'
import {
	aliveIds,
	handsDone,
	lastPlayerStanding,
	retireForfeiters,
	roundReady,
	seatIds,
	seatPlayers,
} from './common'
import type { Hook, Mode } from './types'

// R16-R18:
// the round ends when the trailing player has no hands left, or both have none.
// The higher score wins; an exact tie names no loser. The mode only decides:
// it sets the phase to 'resolved' (the roundId stays, the next open sets it) and
// writes `lastResult` for the round that just ended; the tick takes the loser's life (one writer, lives.ts).
const resolveRound: Hook = (state) => {
	if (state.result.runId !== null || state.round.phase !== 'playing')
		return state
	const alive = aliveIds(state)
	if (alive.length !== 2) return state
	const [a, b] = alive
	const pa = state.round.players[a]
	const pb = state.round.players[b]
	if (pa === undefined || pb === undefined) return state
	// No round to rank until both players have reported their blind_start, unless
	// the server ended a player's hands (a Ready left the blind without one).
	if (
		(pa.handsLeft === null && !pa.handsSpent) ||
		(pb.handsLeft === null && !pb.handsSpent)
	)
		return state
	const order = compareRoundScore(pa.score, pb.score)
	const aBelow = order === -1
	const bBelow = order === 1
	const aDone = handsDone(pa)
	const bDone = handsDone(pb)
	const trigger = (aDone && aBelow) || (bDone && bBelow) || (aDone && bDone)
	if (!trigger) return state

	const roundId = state.round.roundId
	const losers: string[] = order === 0 ? [] : [aBelow ? a : b]
	return {
		...state,
		round: {
			...state.round,
			phase: 'resolved',
			lastResult: { roundId, losers },
		},
	}
}

// The duel opponent of each of `ids` (the seats by default; null with none): what
// pvp.targets projects.
export function duelOpponents(
	state: ModeView,
	ids: string[] = seatIds(state),
): {
	[id: string]: string | null
} {
	const out: { [id: string]: string | null } = {}
	for (const id of ids) out[id] = ids.find((other) => other !== id) ?? null
	return out
}

export const duelMode: Mode = {
	name: 'duel',
	// R11, R21: the last life lost on a normal blind waits on the opponent.
	deathPolicy: 'opponent',
	// A lost blind does not put a duelist out of hands: the round ends on the
	// hands and scores of both.
	outOfHandsOnFail: false,
	init: seatPlayers,
	roundReady,
	resolveRound,
	checkWinner: lastPlayerStanding,
	onForfeit: retireForfeiters,
	view: (state) => ({ opponents: duelOpponents(state) }),
}
