// Standings for round robin and Swiss. A match win is 1 point, a draw 1/2, a
// loss (or a double forfeit) 0; a Swiss bye is a win against nobody. Ties
// are broken by the tiebreakers in order, each one only between the players
// still level after the previous ones -- so head-to-head is the mini-table
// of exactly the players who are tied at that point.
import type { EntrantId, ResolvedMatch, Tiebreaker } from './types'

export interface StandingRow {
	id: EntrantId
	rank: number
	seed: number
	points: number
	played: number
	matchWins: number
	draws: number
	losses: number
	byes: number
	gameWins: number
	gameLosses: number
	// Sum of the points of every opponent faced (byes excluded).
	buchholz: number
	dropped: boolean
}

export const DEFAULT_TIEBREAKERS: { round_robin: Tiebreaker[]; swiss: Tiebreaker[] } = {
	round_robin: ['game_wins', 'head_to_head', 'seed'],
	swiss: ['buchholz', 'head_to_head', 'seed'],
}

interface Tally extends StandingRow {
	opponents: EntrantId[]
}

function pointsFor(match: ResolvedMatch, side: 0 | 1): number {
	const o = match.outcome
	if (!o) return 0
	if (o.draw) return 0.5
	return o.winnerSide === side ? 1 : 0
}

// Head-to-head points of `id` against the other members of `group`.
function headToHead(id: EntrantId, group: Set<EntrantId>, matches: ResolvedMatch[]): number {
	let points = 0
	for (const m of matches) {
		if (m.status !== 'done' || !m.outcome) continue
		const [a, b] = m.players
		if (a === id && typeof b === 'string' && group.has(b)) points += pointsFor(m, 0)
		if (b === id && typeof a === 'string' && group.has(a)) points += pointsFor(m, 1)
	}
	return points
}

function keyOf(row: Tally, tiebreaker: Tiebreaker, group: Set<EntrantId>, matches: ResolvedMatch[]): number {
	switch (tiebreaker) {
		case 'buchholz':
			return row.buchholz
		case 'game_wins':
			return row.gameWins
		case 'game_diff':
			return row.gameWins - row.gameLosses
		case 'head_to_head':
			return headToHead(row.id, group, matches)
		case 'seed':
			// Lower seed number ranks higher.
			return -row.seed
	}
}

// `seeded` is every entrant in seed order (also those with no match yet);
// `matches` the resolved matches of the stage (one round robin group, or all
// of Swiss).
export function computeStandings(
	seeded: EntrantId[],
	matches: ResolvedMatch[],
	tiebreakers: Tiebreaker[],
	dropped: EntrantId[] = [],
): StandingRow[] {
	const droppedSet = new Set(dropped)
	const rows: { [id: string]: Tally } = {}
	seeded.forEach((id, index) => {
		rows[id] = {
			id,
			rank: 0,
			seed: index + 1,
			points: 0,
			played: 0,
			matchWins: 0,
			draws: 0,
			losses: 0,
			byes: 0,
			gameWins: 0,
			gameLosses: 0,
			buchholz: 0,
			dropped: droppedSet.has(id),
			opponents: [],
		}
	})

	for (const m of matches) {
		if (m.status !== 'done' || !m.outcome) continue
		const [a, b] = m.players
		for (const side of [0, 1] as const) {
			const me = side === 0 ? a : b
			const them = side === 0 ? b : a
			if (typeof me !== 'string' || !rows[me]) continue
			const row = rows[me]
			if (them === null) {
				// A bye counts as a win against nobody.
				if (m.outcome.reason === 'bye') {
					row.byes++
					row.matchWins++
					row.points += 1
				}
				continue
			}
			row.played++
			row.gameWins += m.wins[side]
			row.gameLosses += m.wins[side === 0 ? 1 : 0]
			if (typeof them === 'string') row.opponents.push(them)
			const p = pointsFor(m, side)
			row.points += p
			if (p === 1) row.matchWins++
			else if (p === 0.5) row.draws++
			else row.losses++
		}
	}
	for (const id of Object.keys(rows)) {
		const row = rows[id]
		row.buchholz = row.opponents.reduce((sum, o) => sum + (rows[o] ? rows[o].points : 0), 0)
	}

	// Refine groups of tied players one tiebreaker at a time.
	let groups: Tally[][] = [seeded.map((id) => rows[id])]
	const order: ((group: Set<EntrantId>) => (row: Tally) => number)[] = [() => (row) => row.points]
	for (const t of tiebreakers) order.push((group) => (row) => keyOf(row, t, group, matches))
	if (tiebreakers.indexOf('seed') === -1) order.push(() => (row) => -row.seed)
	for (const makeKey of order) {
		const next: Tally[][] = []
		for (const group of groups) {
			if (group.length === 1) {
				next.push(group)
				continue
			}
			const key = makeKey(new Set(group.map((r) => r.id)))
			const keyed = group.map((row) => ({ row, k: key(row) }))
			keyed.sort((x, y) => y.k - x.k)
			let current: Tally[] = []
			let last: number | null = null
			for (const { row, k } of keyed) {
				if (last !== null && k !== last) {
					next.push(current)
					current = []
				}
				current.push(row)
				last = k
			}
			next.push(current)
		}
		groups = next
	}

	const result: StandingRow[] = []
	for (const group of groups) {
		for (const row of group) {
			const { opponents, ...rest } = row
			result.push({ ...rest, rank: result.length + 1 })
		}
	}
	return result
}
