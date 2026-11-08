// Round robin: everyone in a group plays everyone else in it once. Entrants
// are spread over the groups in snake order (1,2,3,3,2,1,...) so every group
// gets a fair mix of seeds; the rounds come from the circle method, with a
// rest round for each player when a group's size is odd.
import type { EntrantId, MatchDef } from './types'

export function roundRobinId(group: number, round: number, order: number): string {
	return `RR-g${group}-r${round}-${order}`
}

// Seeded entrants split into groups of at most groupSize, as even as possible.
export function splitGroups(seeded: EntrantId[], groupSize: number): EntrantId[][] {
	const count = Math.max(1, Math.ceil(seeded.length / Math.max(2, groupSize)))
	const groups: EntrantId[][] = []
	for (let g = 0; g < count; g++) groups.push([])
	seeded.forEach((id, index) => {
		const row = Math.floor(index / count)
		const position = index % count
		groups[row % 2 === 0 ? position : count - 1 - position].push(id)
	})
	return groups
}

// The circle method's pairings for one group: rounds[r] lists that round's
// pairs. Seed order is kept so a group's top seed is always on the left.
export function circlePairings(players: EntrantId[]): [EntrantId, EntrantId][][] {
	const ring: (EntrantId | null)[] = players.slice()
	if (ring.length % 2 === 1) ring.push(null)
	const n = ring.length
	const rounds: [EntrantId, EntrantId][][] = []
	for (let r = 0; r < n - 1; r++) {
		const pairs: [EntrantId, EntrantId][] = []
		for (let i = 0; i < n / 2; i++) {
			const a = ring[i]
			const b = ring[n - 1 - i]
			if (a === null || b === null) continue
			const ia = players.indexOf(a)
			const ib = players.indexOf(b)
			pairs.push(ia < ib ? [a, b] : [b, a])
		}
		rounds.push(pairs)
		// Keep ring[0] fixed; rotate the rest one step clockwise.
		const last = ring.pop() as EntrantId | null
		ring.splice(1, 0, last)
	}
	return rounds
}

export function roundRobin(seeded: EntrantId[], options: { groupSize?: number; bestOf?: number } = {}): MatchDef[] {
	const bestOf = options.bestOf ?? 1
	const groups = splitGroups(seeded, options.groupSize ?? seeded.length)
	const matches: MatchDef[] = []
	groups.forEach((members, g) => {
		circlePairings(members).forEach((pairs, r) => {
			pairs.forEach(([a, b], i) => {
				matches.push({
					id: roundRobinId(g + 1, r + 1, i + 1),
					stage: 'RR',
					round: r + 1,
					order: i + 1,
					group: g + 1,
					slots: [
						{ kind: 'entrant', id: a },
						{ kind: 'entrant', id: b },
					],
					bestOf,
					games: [],
				})
			})
		})
	})
	return matches
}
