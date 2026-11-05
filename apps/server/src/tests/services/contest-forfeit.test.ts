import { describe, expect, it } from 'vitest'
import { forfeitPlacements } from '../../features/contests/forfeit.js'

const place = (list: { playerId: string; place: number }[] | null, id: string) =>
	list?.find((p) => p.playerId === id)?.place

describe('forfeitPlacements', () => {
	it('makes the opponent the winner in a match of 2, whoever was ahead', () => {
		const ahead = [
			{ playerId: 'a', place: 1 },
			{ playerId: 'b', place: 2 },
		]
		const result = forfeitPlacements(['a', 'b'], ahead, 'a')
		expect(place(result, 'b')).toBe(1)
		expect(place(result, 'a')).toBe(2)
	})

	it('needs no earlier result in a match of 2', () => {
		const result = forfeitPlacements(['a', 'b'], [], 'b')
		expect(place(result, 'a')).toBe(1)
		expect(place(result, 'b')).toBe(2)
	})

	it('keeps the others in their order and puts the contester last in a larger match', () => {
		const before = [
			{ playerId: 'c', place: 1 },
			{ playerId: 'a', place: 2 },
			{ playerId: 'b', place: 3 },
		]
		const result = forfeitPlacements(['a', 'b', 'c'], before, 'c')
		expect(place(result, 'a')).toBe(1)
		expect(place(result, 'b')).toBe(2)
		expect(place(result, 'c')).toBe(3)
	})

	it('keeps ties among the others', () => {
		const before = [
			{ playerId: 'a', place: 1 },
			{ playerId: 'b', place: 1 },
			{ playerId: 'c', place: 3 },
		]
		const result = forfeitPlacements(['a', 'b', 'c'], before, 'c')
		expect([place(result, 'a'), place(result, 'b'), place(result, 'c')]).toEqual([1, 1, 2])
	})

	it('puts the others level on first place when nobody reported before the Contest', () => {
		const result = forfeitPlacements(['a', 'b', 'c'], [], 'c')
		expect([place(result, 'a'), place(result, 'b'), place(result, 'c')]).toEqual([1, 1, 2])
	})

	it('refuses a contester who is not in the match', () => {
		expect(forfeitPlacements(['a', 'b'], [], 'z')).toBeNull()
	})
})
