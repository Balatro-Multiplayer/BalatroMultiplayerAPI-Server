import { describe, expect, it } from 'vitest'
import {
	type Standing,
	nextCounters,
	standingsOf,
} from '../../features/ratings/standing.js'

// The same table is in nakama/src/rating/apply.test.ts.
describe('ratings/standing', () => {
	it.each<[string, number[], Standing[]]>([
		['two players share first: a draw', [1, 1], ['draw', 'draw']],
		['two players, one wins', [1, 2], ['win', 'loss']],
		['[1,1,2]: both first places win', [1, 1, 2], ['win', 'win', 'loss']],
		['a single placement keeps the win', [1], ['win']],
		['three share first: a draw', [1, 1, 1], ['draw', 'draw', 'draw']],
	])('%s', (_name, places, expected) => {
		const placements = places.map((place, i) => ({ playerId: `p${i}`, place }))
		const got = standingsOf(placements)
		expect(placements.map((p) => got.get(p.playerId))).toEqual(expected)
	})
})

describe('ratings/standing nextCounters', () => {
	it.each<[Standing, { wins: number; losses: number }]>([
		['win', { wins: 6, losses: 3 }],
		['loss', { wins: 5, losses: 4 }],
		['draw', { wins: 5, losses: 3 }],
	])('a %s moves the counters to %o', (standing, expected) => {
		expect(nextCounters({ wins: 5, losses: 3 }, standing)).toEqual(expected)
	})
})
