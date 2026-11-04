import { describe, expect, it } from 'vitest'
import { seedEntrants, seededRng } from './seeding'

describe('seedEntrants', () => {
	const entrants = [
		{ id: 'a', rating: 1200 },
		{ id: 'b', rating: null },
		{ id: 'c', rating: 1500 },
		{ id: 'd' },
		{ id: 'e', rating: 1200 },
	]

	it('orders by rating, unrated last, ties in sign-up order', () => {
		const r = seedEntrants(entrants, 'rating')
		expect(r).toEqual({ ok: true, value: ['c', 'a', 'e', 'b', 'd'] })
	})

	it('shuffles repeatably with a seeded rng', () => {
		const one = seedEntrants(entrants, 'random', { rng: seededRng(7) })
		const two = seedEntrants(entrants, 'random', { rng: seededRng(7) })
		expect(one).toEqual(two)
		if (!one.ok) throw new Error('refused')
		expect(one.value.slice().sort()).toEqual(['a', 'b', 'c', 'd', 'e'])
	})

	it('takes a manual order that lists everyone once', () => {
		expect(seedEntrants(entrants, 'manual', { order: ['e', 'd', 'c', 'b', 'a'] })).toEqual({ ok: true, value: ['e', 'd', 'c', 'b', 'a'] })
		expect(seedEntrants(entrants, 'manual', { order: ['e', 'd', 'c', 'b'] }).ok).toBe(false)
		expect(seedEntrants(entrants, 'manual', { order: ['e', 'e', 'c', 'b', 'a'] }).ok).toBe(false)
		expect(seedEntrants(entrants, 'manual', { order: ['e', 'x', 'c', 'b', 'a'] }).ok).toBe(false)
	})

	it('refuses duplicate entrants', () => {
		expect(seedEntrants([{ id: 'a' }, { id: 'a' }], 'rating').ok).toBe(false)
	})
})
