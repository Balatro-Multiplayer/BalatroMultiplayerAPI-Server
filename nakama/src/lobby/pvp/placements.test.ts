import { describe, expect, it } from 'vitest'
import { populatedPvpLobby, reportedPlayer } from '../../testing/pvp_fixtures'
import { placementsOf } from './pvp_tick'
import { type RefereeState, refereeOf } from './state'

function decided(
	players: RefereeState['round']['players'],
	places: { playerId: string; place: number }[],
): RefereeState {
	const base = refereeOf(populatedPvpLobby())
	if (base === null) throw new Error('fixture has no referee')
	return {
		...base,
		round: { ...base.round, players },
		result: { ...base.result, places },
	}
}

describe('placementsOf', () => {
	it('carries the best score of a player who reported one', () => {
		const state = decided(
			{ a: reportedPlayer({ highestScore: '250' }) },
			[{ playerId: 'a', place: 1 }],
		)
		expect(placementsOf(state, ['a'])).toEqual([
			{
				playerId: 'a',
				place: 1,
				performance: 1,
				metric: 250,
				metricText: '250',
			},
		])
	})

	it('a player who scored 0 has a metric of 0', () => {
		const state = decided(
			{ a: reportedPlayer({ highestScore: '0' }) },
			[{ playerId: 'a', place: 1 }],
		)
		expect(placementsOf(state, ['a'])[0]).toMatchObject({
			metric: 0,
			metricText: '0',
		})
	})

	it('a player who never reported a score has no metric: unknown is not 0', () => {
		const state = decided(
			{
				a: reportedPlayer({ highestScore: '0' }),
				b: reportedPlayer({ highestScore: null }),
			},
			[
				{ playerId: 'a', place: 1 },
				{ playerId: 'b', place: 2 },
			],
		)
		const [a, b] = placementsOf(state, ['a', 'b'])
		expect(a.metricText).toBe('0')
		expect(b).toEqual({ playerId: 'b', place: 2, performance: 0 })
	})

	it('a player with no round entry has no metric either', () => {
		const state = decided({}, [{ playerId: 'a', place: 1 }])
		expect(placementsOf(state, ['a'])).toEqual([
			{ playerId: 'a', place: 1, performance: 1 },
		])
	})
})
