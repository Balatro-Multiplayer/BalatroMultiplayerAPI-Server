import { describe, expect, it } from 'vitest'
import { newRatingRow } from '../../infrastructure/gateways/match-edit.gateway.js'

const change = {
	playerId: 'p1',
	oldDelta: null,
	newDelta: 20,
	rating: 20,
	wins: 1,
	losses: 0,
	gamesPlayed: 1,
}
const at = new Date('2026-01-01T00:00:00Z')

describe('newRatingRow', () => {
	it('starts a missing row from the initial rating with the change applied', () => {
		expect(newRatingRow(change, 'M', 'ranked', 3, at)).toMatchObject({
			playerId: 'p1',
			modId: 'M',
			gameMode: 'ranked',
			season: 3,
			rating: 620,
			wins: 1,
			losses: 0,
			gamesPlayed: 1,
			lastMatchAt: at,
		})
	})

	it('floors the rating and the counts like an update does', () => {
		const row = newRatingRow(
			{ ...change, rating: -900, wins: -1, losses: 1, gamesPlayed: 1 },
			'M',
			'ranked',
			3,
			at,
		)
		expect(row).toMatchObject({ rating: 100, wins: 0, losses: 1 })
	})
})
