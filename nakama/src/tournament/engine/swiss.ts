// Swiss pairing, one round at a time. Players are ordered by points (then
// seed), split into score groups, and each group is laid out top half against
// bottom half (1st v 5th, 2nd v 6th, ... in a group of eight); an odd player
// floats down to the next group. A backtracking search then takes the first
// pairing in that order that has no rematch. With an odd number of active
// players, the lowest-ranked one who hasn't had a bye gets it (a win).
import type { EntrantId, MatchDef } from './types'

export function swissId(round: number, order: number): string {
	return `SW${round}-${order}`
}

// Rounds needed to leave a single unbeaten player.
export function defaultSwissRounds(entrants: number): number {
	let rounds = 0
	while (2 ** rounds < entrants) rounds++
	return Math.max(1, rounds)
}

export interface SwissPlayer {
	id: EntrantId
	seed: number
	points: number
	hadBye: boolean
	opponents: EntrantId[]
}

// Interleave each score group's halves so the greedy search tries the
// preferred (top v bottom half) opponent first.
function preferenceOrder(players: SwissPlayer[]): SwissPlayer[] {
	const sorted = players.slice().sort((a, b) => b.points - a.points || a.seed - b.seed)
	const out: SwissPlayer[] = []
	let i = 0
	let carried: SwissPlayer[] = []
	while (i < sorted.length) {
		const points = sorted[i].points
		const group = carried.slice()
		while (i < sorted.length && sorted[i].points === points) group.push(sorted[i++])
		carried = []
		if (group.length % 2 === 1 && i < sorted.length) carried.push(group.pop() as SwissPlayer)
		const half = Math.ceil(group.length / 2)
		for (let k = 0; k < half; k++) {
			out.push(group[k])
			if (k + half < group.length) out.push(group[k + half])
		}
	}
	return out.concat(carried)
}

const SEARCH_LIMIT = 200000

// Pairs `players` (even count) with no rematches if possible; null if the
// search finds none within its budget.
function pairWithoutRematches(players: SwissPlayer[]): [SwissPlayer, SwissPlayer][] | null {
	const used = new Array(players.length).fill(false)
	const pairs: [SwissPlayer, SwissPlayer][] = []
	let steps = 0
	const search = (): boolean => {
		if (++steps > SEARCH_LIMIT) return false
		const i = used.indexOf(false)
		if (i === -1) return true
		used[i] = true
		for (let j = i + 1; j < players.length; j++) {
			if (used[j]) continue
			if (players[i].opponents.indexOf(players[j].id) !== -1) continue
			used[j] = true
			pairs.push([players[i], players[j]])
			if (search()) return true
			pairs.pop()
			used[j] = false
		}
		used[i] = false
		return false
	}
	return search() ? pairs : null
}

// The next round's matches. Rematches are allowed only when no pairing
// avoids them (tiny fields late in a long Swiss).
export function pairSwissRound(players: SwissPlayer[], round: number, bestOf = 1): MatchDef[] {
	let pool = preferenceOrder(players)
	const matches: MatchDef[] = []
	let bye: SwissPlayer | null = null
	if (pool.length % 2 === 1) {
		for (let k = pool.length - 1; k >= 0; k--) {
			if (!pool[k].hadBye) {
				bye = pool[k]
				break
			}
		}
		if (!bye) bye = pool[pool.length - 1]
		pool = pool.filter((p) => p !== bye)
	}
	let pairs = pairWithoutRematches(pool)
	if (!pairs) {
		pairs = []
		for (let k = 0; k + 1 < pool.length; k += 2) pairs.push([pool[k], pool[k + 1]])
	}
	pairs.forEach(([a, b], index) => {
		const [left, right] = a.points > b.points || (a.points === b.points && a.seed < b.seed) ? [a, b] : [b, a]
		matches.push({
			id: swissId(round, index + 1),
			stage: 'SW',
			round,
			order: index + 1,
			slots: [
				{ kind: 'entrant', id: left.id },
				{ kind: 'entrant', id: right.id },
			],
			bestOf,
			games: [],
		})
	})
	if (bye) {
		matches.push({
			id: swissId(round, matches.length + 1),
			stage: 'SW',
			round,
			order: matches.length + 1,
			slots: [{ kind: 'entrant', id: bye.id }, { kind: 'bye' }],
			bestOf,
			games: [],
		})
	}
	return matches
}
