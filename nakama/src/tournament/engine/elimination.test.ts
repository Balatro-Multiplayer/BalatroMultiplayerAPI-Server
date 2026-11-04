import { describe, expect, it } from 'vitest'
import { createBracket, isFinished, finalPlacements } from './bracket'
import { bracketSize, seedOrder } from './elimination'
import { resolveBracket } from './resolve'
import { favourite, playOut, players, randomWinner, seededRng } from './test_helpers'
import type { Bracket, EntrantId } from './types'

function build(format: 'single_elim' | 'double_elim', n: number, options = {}): Bracket {
	const r = createBracket(format, players(n), options)
	if (!r.ok) throw new Error(r.error.message)
	return r.value
}

// Losses per player and the order they played in, from a finished bracket.
function history(bracket: Bracket) {
	const losses: { [id: string]: number } = {}
	const lastPlayed: { [id: string]: number } = {}
	const knockedOutAt: { [id: string]: number } = {}
	const lives = bracket.format === 'double_elim' ? 2 : 1
	resolveBracket(bracket).matches.forEach((m, i) => {
		for (const p of m.players) {
			if (typeof p === 'string' && m.outcome && m.outcome.reason !== 'bye') {
				lastPlayed[p] = i
			}
		}
		const loser = m.outcome?.loser
		if (loser && m.outcome?.reason !== 'bye') {
			losses[loser] = (losses[loser] ?? 0) + 1
			if (losses[loser] >= lives) knockedOutAt[loser] = i
		}
	})
	return { losses, lastPlayed, knockedOutAt }
}

describe('seedOrder', () => {
	it('places seeds the standard way', () => {
		expect(seedOrder(2)).toEqual([1, 2])
		expect(seedOrder(4)).toEqual([1, 4, 2, 3])
		expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6])
	})

	it('sizes to the next power of two', () => {
		expect([2, 3, 4, 5, 8, 9, 100, 128].map(bracketSize)).toEqual([2, 4, 4, 8, 8, 16, 128, 128])
	})
})

describe('single elimination', () => {
	it('gives byes to the top seeds and never pairs two byes', () => {
		const b = build('single_elim', 5)
		const first = resolveBracket(b).matches.filter((m) => m.def.round === 1)
		expect(first.map((m) => m.players)).toEqual([
			['p1', null],
			['p4', 'p5'],
			['p2', null],
			['p3', null],
		])
		expect(first.filter((m) => m.status === 'done').map((m) => m.outcome?.winner)).toEqual(['p1', 'p2', 'p3'])
	})

	for (let n = 2; n <= 128; n++) {
		it(`plays out with ${n} entrants`, () => {
			const b = playOut(build('single_elim', n), favourite)
			expect(isFinished(b)).toBe(true)
			expect(b.matches.length).toBe(bracketSize(n) - 1)
			const places = finalPlacements(b)
			expect(places.length).toBe(n)
			expect(places[0]).toEqual({ id: 'p1', place: 1 })
			if (n >= 2) expect(places[1]).toEqual({ id: 'p2', place: 2 })
			const { losses } = history(b)
			for (const id of players(n)) expect(losses[id] ?? 0).toBe(id === 'p1' ? 0 : 1)
		})
	}

	it('shares places between same-round eliminations', () => {
		const places = finalPlacements(playOut(build('single_elim', 8), favourite))
		expect(places.map((p) => p.place)).toEqual([1, 2, 3, 3, 5, 5, 5, 5])
	})
})

describe('double elimination', () => {
	for (let n = 2; n <= 128; n++) {
		it(`plays out with ${n} entrants (random winners)`, () => {
			const b = playOut(build('double_elim', n), randomWinner(seededRng(n)))
			expect(isFinished(b)).toBe(true)
			const places = finalPlacements(b)
			expect(places.length).toBe(n)
			expect(new Set(places.map((p) => p.id)).size).toBe(n)
			const champion = places[0].id
			const { losses, lastPlayed, knockedOutAt } = history(b)
			// Nobody plays again after their second loss.
			for (const id of Object.keys(knockedOutAt)) expect(lastPlayed[id]).toBe(knockedOutAt[id])
			for (const id of players(n)) {
				if (id === champion) expect(losses[id] ?? 0).toBeLessThanOrEqual(1)
				else expect(losses[id]).toBe(2)
			}
		})
	}

	it('skips the reset when the winners-bracket player wins the grand final', () => {
		const b = playOut(build('double_elim', 4), favourite)
		const gf2 = resolveBracket(b).byId.GF2
		expect(gf2.status).toBe('void')
		expect(finalPlacements(b).slice(0, 2)).toEqual([
			{ id: 'p1', place: 1 },
			{ id: 'p2', place: 2 },
		])
	})

	it('plays the reset when the losers-bracket player wins the first grand final', () => {
		// p4 loses in the winners bracket, then wins everything else.
		const b = playOut(build('double_elim', 4), (m, bracket) => {
			const [a, c] = m.players as [EntrantId, EntrantId]
			if (a !== 'p4' && c !== 'p4') return favourite(m, bracket)
			const p4Side = a === 'p4' ? 0 : 1
			const winsHere = m.def.stage !== 'W'
			return winsHere ? p4Side : p4Side === 0 ? 1 : 0
		})
		const r = resolveBracket(b)
		expect(r.byId.GF1.outcome?.winner).toBe('p4')
		expect(r.byId.GF2.status).toBe('done')
		expect(r.byId.GF2.outcome?.winner).toBe('p4')
		expect(finalPlacements(b)[0]).toEqual({ id: 'p4', place: 1 })
	})

	it('ends after the first grand final when the reset is off', () => {
		const b = build('double_elim', 4, { grandFinalReset: false })
		expect(b.matches.some((m) => m.id === 'GF2')).toBe(false)
	})

	it('drops winners-round losers into alternating losers-bracket positions', () => {
		const b = build('double_elim', 16)
		const l2 = b.matches.filter((m) => m.stage === 'L' && m.round === 2).map((m) => m.slots[1])
		expect(l2).toEqual([
			{ kind: 'loser', matchId: 'W2-4' },
			{ kind: 'loser', matchId: 'W2-3' },
			{ kind: 'loser', matchId: 'W2-2' },
			{ kind: 'loser', matchId: 'W2-1' },
		])
		const l4 = b.matches.filter((m) => m.stage === 'L' && m.round === 4).map((m) => m.slots[1])
		expect(l4).toEqual([
			{ kind: 'loser', matchId: 'W3-1' },
			{ kind: 'loser', matchId: 'W3-2' },
		])
	})
})
