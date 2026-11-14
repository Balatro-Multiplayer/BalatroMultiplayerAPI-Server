import { compareRoundScore } from '../score'
// The Royale rule set: a game that started with 3+ players (docs/pvp-match.md
// section 6), the rules R22-R26 of the appendix. Start,
// round opening, the win check and forfeits are the shared ones (modes/common.ts); this file adds the
// rank-and-cut round resolution and the live target + safe marker. Every hook is
// pure, and the tick takes the lives (a mode only names the losers).
import type { ModeView } from '../state'
import {
	aliveIds,
	allOutOfHands,
	lastPlayerStanding,
	retireForfeiters,
	roundReady,
	scoreOf,
	seatPlayers,
} from './common'
import type { Hook, Mode, ViewHook } from './types'

// `score` is null for a player who has reported none; it ranks below every score.
interface RoyaleEntry {
	id: string
	score: string | null
}

const greater = (a: string | null, b: string | null): boolean =>
	compareRoundScore(a, b) === 1

// Ascending by score, ties by id so the answer never depends on input order.
function byScore(players: RoyaleEntry[]): RoyaleEntry[] {
	return [...players].sort(
		(a, b) => compareRoundScore(a.score, b.score) || (a.id < b.id ? -1 : 1),
	)
}

// R23: the cut sits at the player floor(N/2)
// (min 1) from the bottom, and everyone who does not beat that score is cut, so
// a tie at the cut never splits. When the cut score is the top score, the cut
// moves to just under the top: everyone strictly below the top is cut.
// `cut` is the set BEFORE the everyone-tied exemption, which the live view uses.
function cut(ranked: RoyaleEntry[]): Set<string> {
	if (ranked.length === 0) return new Set()
	const top = ranked[ranked.length - 1].score
	let cutoff = ranked[Math.max(1, Math.floor(ranked.length / 2)) - 1].score
	if (!greater(top, cutoff)) {
		const below = ranked.filter((p) => greater(top, p.score)).pop()
		if (below) cutoff = below.score
	}
	return new Set(
		ranked.filter((p) => !greater(p.score, cutoff)).map((p) => p.id),
	)
}

// The ranking of the alive players and who loses a life. When every player is
// cut (all tied) nobody loses (R23).
export function rankRoyale(players: RoyaleEntry[]): {
	ranked: string[]
	losers: string[]
} {
	const ranked = byScore(players)
	const cutIds = cut(ranked)
	const all = cutIds.size === ranked.length
	return {
		ranked: ranked.map((p) => p.id),
		losers: all ? [] : ranked.map((p) => p.id).filter((id) => cutIds.has(id)),
	}
}

function aliveEntries(state: ModeView): RoyaleEntry[] {
	return aliveIds(state).map((id) => ({ id, score: scoreOf(state, id) }))
}

// R22, R24: the round resolves once, when EVERY alive player has no hands left.
// Players who are dead, forfeited or left are never ranked and never waited for.
// At two alive the cut leaves the lower score losing, and a tie costs nobody.
const resolveRound: Hook = (state) => {
	if (state.result.runId !== null || state.round.phase !== 'playing')
		return state
	const alive = aliveIds(state)
	if (alive.length < 2) return state
	if (!allOutOfHands(state, alive)) return state
	return {
		...state,
		round: {
			...state.round,
			phase: 'resolved',
			lastResult: {
				roundId: state.round.roundId,
				losers: rankRoyale(aliveEntries(state)).losers,
			},
		},
	}
}

// R26 (the live target): a player who would lose a life right
// now targets the next-higher ranked player (what to beat), a safe one the
// next-lower (the margin); null at the end of the list. When all alive players
// tie, every one counts as losing (the cut, before the tie exemption).
const view: ViewHook = (state) => {
	const ranked = byScore(aliveEntries(state))
	if (ranked.length < 2) return { opponents: {}, safe: {} }
	const cutIds = cut(ranked)
	const opponents: { [id: string]: string | null } = {}
	const safe: { [id: string]: boolean } = {}
	ranked.forEach((p, i) => {
		const losing = cutIds.has(p.id)
		opponents[p.id] = ranked[losing ? i + 1 : i - 1]?.id ?? null
		safe[p.id] = !losing
	})
	return { opponents, safe }
}

export const royaleMode: Mode = {
	name: 'royale',
	// R32: a game of 3+ players, every death waits on all the others.
	deathPolicy: 'everyone',
	// R34: a lost blind puts the player out of hands, so the round does not wait on them.
	outOfHandsOnFail: true,
	init: seatPlayers,
	roundReady,
	resolveRound,
	checkWinner: lastPlayerStanding,
	onForfeit: retireForfeiters,
	view,
}
