import { compareRoundScore } from '../score'
// The Nemesis rule set for a game that started with 3 or more players (two
// players play the duel, modes/index.ts). Rows R27-R30 of the referee:
// every ante the alive players are paired once, each pair plays its own round,
// and the match ends at one player alive.
//
// It shares the seats, round opening, winner check and forfeit (modes/common.ts); only the
// pairing, the per-pair resolution and the targets view are its own. The tick
// takes the lives of `lastResult.losers`, as for every mode.
import type { ModeView, PvpPairing } from '../state'
import {
	aliveIds,
	allOutOfHands,
	highestAnte,
	lastPlayerStanding,
	retireForfeiters,
	roundReady,
	scoreOf,
	seatPlayers,
} from './common'
import type { Hook, Mode, TargetsView } from './types'

const pairKey = (a: string, b: string): string =>
	a < b ? `${a}|${b}` : `${b}|${a}`

// The draw is the only source of order: Fisher-Yates.
export function shuffled(ids: string[], random: () => number): string[] {
	const out = [...ids]
	for (let i = out.length - 1; i >= 1; i--) {
		const j = Math.floor(random() * (i + 1))
		const keep = out[i]
		out[i] = out[j]
		out[j] = keep
	}
	return out
}

// The circle method (round-robin pairing): fix the first id, rotate
// the rest by `offset`, then pair (1,2), (3,4), ... `ids` has an even length.
// The rotations are distinct but not disjoint from n >= 6 (with 6 ids offsets 0
// and 2 both hold (e,f)), so the used pairs can reset before every pair has met;
// kept for parity with the host.
export function circleRound(ids: string[], offset: number): [string, string][] {
	const n = ids.length
	const rotated = [ids[0]]
	for (let i = 1; i < n; i++)
		rotated.push(ids[((i - 1 + offset) % (n - 1)) + 1])
	const pairs: [string, string][] = []
	for (let i = 0; i < n; i += 2) pairs.push([rotated[i], rotated[i + 1]])
	return pairs
}

// The first rotation whose pairs are all unused; none when every rotation
// repeats a pair.
function freshRound(
	ids: string[],
	used: Set<string>,
): [string, string][] | null {
	for (let offset = 0; offset <= ids.length - 2; offset++) {
		const pairs = circleRound(ids, offset)
		if (pairs.every(([a, b]) => !used.has(pairKey(a, b)))) return pairs
	}
	return null
}

// R27: the pairing of one ante
// from the players alive now. Shuffle; an odd count gives the first shuffled id
// that did not bye last ante the bye; take the first round-robin rotation with
// no pair played before, or start the used pairs over when every rotation
// repeats one. Pure: `random` is the only input besides the arguments.
export function pairNemesis(
	alive: string[],
	previous: PvpPairing | null,
	ante: number,
	random: () => number,
): PvpPairing {
	const used = previous?.usedPairs ?? []
	const lastBye = previous?.lastBye ?? null
	if (alive.length < 2) return { ante, partners: {}, usedPairs: used, lastBye }

	const ids = shuffled([...alive].sort(), random)
	let bye: string | null = null
	if (ids.length % 2 === 1) {
		const at = Math.max(
			0,
			ids.findIndex((id) => id !== lastBye),
		)
		bye = ids.splice(at, 1)[0]
	}

	const fresh = freshRound(ids, new Set(used))
	const chosen = fresh ?? circleRound(ids, 0)
	const partners: { [id: string]: string | null } = {}
	if (bye !== null) partners[bye] = null
	for (const [a, b] of chosen) {
		partners[a] = b
		partners[b] = a
	}
	return {
		ante,
		partners,
		usedPairs: [
			...(fresh ? used : []),
			...chosen.map(([a, b]) => pairKey(a, b)),
		],
		lastBye: bye,
	}
}

// R28: the alive players are paired once per ante, the first time the tick sees
// the ante rise (ante 1 on the first tick, before the first PvP round opens). A
// second call at the same ante changes nothing.
const onAnte: Hook = (state, ctx) => {
	const ante = highestAnte(state)
	// No ante reported yet: nothing to pair for.
	if (ante === null) return state
	if (state.pairing !== null && ante <= state.pairing.ante) return state
	return {
		...state,
		pairing: pairNemesis(aliveIds(state), state.pairing, ante, ctx.random),
	}
}

// R29: once every alive player is out of hands, each
// stored pair whose two players are both alive loses its lower score (an exact
// tie loses nobody). A player whose partner is dead, gone or the bye loses
// nothing. The mode only names the losers; the tick takes the lives.
const resolveRound: Hook = (state) => {
	if (state.result.runId !== null || state.round.phase !== 'playing')
		return state
	const alive = aliveIds(state)
	if (alive.length < 2) return state
	if (!allOutOfHands(state, alive)) return state
	const partners = state.pairing?.partners ?? {}
	const losers: string[] = []
	for (const id of alive) {
		const partner = partners[id] ?? null
		// each pair once, from its lower id
		if (partner === null || id > partner || !alive.includes(partner)) continue
		const order = compareRoundScore(scoreOf(state, id), scoreOf(state, partner))
		if (order === -1) losers.push(id)
		else if (order === 1) losers.push(partner)
	}
	return {
		...state,
		round: {
			...state.round,
			phase: 'resolved',
			lastResult: { roundId: state.round.roundId, losers: losers.sort() },
		},
	}
}

// The stored partner of each alive player (null for the bye or with no pairing).
function view(state: ModeView): TargetsView {
	const opponents: { [id: string]: string | null } = {}
	for (const id of aliveIds(state))
		opponents[id] = state.pairing?.partners[id] ?? null
	return { opponents, pairingAnte: state.pairing?.ante ?? null }
}

export const nemesisMode: Mode = {
	name: 'nemesis',
	// R32: a game of 3+ players, every death waits on all the others.
	deathPolicy: 'everyone',
	// R34: a lost blind puts the player out of hands, so the round does not wait on them.
	outOfHandsOnFail: true,
	init: seatPlayers,
	roundReady,
	resolveRound,
	checkWinner: lastPlayerStanding,
	onAnte,
	onForfeit: retireForfeiters,
	view,
}
