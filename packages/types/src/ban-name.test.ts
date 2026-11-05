import { describe, expect, it } from 'vitest'
import { BAN_NAME_DECKS, BAN_NAME_JOKERS, banNameOf } from './ban-name'

// Copied by hand into BalatroMultiplayerAPI tests/ban_name_test.lua.
const VECTORS: [string, string][] = [
	['00000000-0000-0000-0000-000000000000', 'Nebula Four Fingers'],
	['11111111-2222-3333-4444-555555555555', 'Nebula Campfire'],
	['a3f1c2d4-5b6e-4f70-8a91-b2c3d4e5f607', 'Magic Devious'],
	['ffffffff-ffff-ffff-ffff-ffffffffffff', 'Nebula Bootstraps'],
	['0b9d4a52-77c1-4e0f-9a3d-1c2e3f405162', 'Ghost Burnt'],
]

describe('banNameOf', () => {
	it.each(VECTORS)('gives %s the Ban name %s', (id, name) => {
		expect(banNameOf(id)).toBe(name)
	})

	it('gives the same name for the same id, whatever its case', () => {
		expect(banNameOf('A3F1C2D4-5B6E-4F70-8A91-B2C3D4E5F607')).toBe('Magic Devious')
	})

	it('can give two players one name', () => {
		const names = new Set<string>()
		for (let i = 0; i < 3000; i++) names.add(banNameOf(`00000000-0000-0000-0000-${String(i).padStart(12, '0')}`))
		expect(names.size).toBeLessThan(3000)
		expect(names.size).toBeGreaterThan(500)
	})

	it('reaches every deck and every joker', () => {
		const decks = new Set<string>()
		const jokers = new Set<string>()
		for (let i = 0; i < 20000; i++) {
			const id = `${(i * 2654435761 >>> 0).toString(16).padStart(8, '0')}-0000-4000-8000-${String(i).padStart(12, '0')}`
			const name = banNameOf(id)
			const deck = BAN_NAME_DECKS.find((d) => name.startsWith(`${d} `))
			expect(deck).toBeDefined()
			decks.add(deck as string)
			jokers.add(name.slice((deck as string).length + 1))
		}
		expect(decks.size).toBe(10)
		expect(jokers.size).toBe(149)
	})
})

describe('ban name lists', () => {
	it('has the 10 decks after the first 5, and 149 distinct jokers', () => {
		expect(BAN_NAME_DECKS).toHaveLength(10)
		expect(BAN_NAME_DECKS[0]).toBe('Magic')
		expect(BAN_NAME_DECKS[9]).toBe('Erratic')
		expect(new Set(BAN_NAME_JOKERS).size).toBe(149)
	})

	it('leaves out the plain Joker card and the words Joker and Deck', () => {
		for (const name of [...BAN_NAME_DECKS, ...BAN_NAME_JOKERS]) {
			expect(name).not.toBe('')
			expect(name).not.toContain('Joker')
			expect(name).not.toContain('Deck')
		}
		expect(BAN_NAME_JOKERS).toContain('Stencil')
		expect(BAN_NAME_JOKERS).toContain('Canio')
		expect(BAN_NAME_JOKERS).not.toContain('Caino')
	})
})
