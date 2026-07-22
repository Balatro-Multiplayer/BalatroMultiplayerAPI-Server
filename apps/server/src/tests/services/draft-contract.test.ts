// CONTRACT: this pool shape is consumed by the Lua client -- keep in sync with
// BalatroMultiplayer/tests/test_pool_contract.lua
//
// Canonical wire shape (exact JSON issueDraftPool returns): an array of items --
//   plain item:    { "key": <non-empty string>, "stake": <integer> }  (no other fields)
//   cocktail item: { "key": "b_mp_cocktail", "stake": <integer>,
//                     "decks": [<string>, ...], "name": <string, no "Cocktail" suffix> }
//
// e.g. [
//   { "key": "b_red", "stake": 1 },
//   { "key": "b_mp_cocktail", "stake": 3, "decks": ["b_green", "b_black", "b_mp_orange"], "name": "Casjb" }
// ]

import { describe, expect, it } from 'vitest'
import { DECK } from '../../features/draft/draft-constants.js'
import { getDraftPolicy } from '../../features/draft/draft-policy.js'
import {
	type DraftTuple,
	type Rng,
	generateDraftPool,
} from '../../features/draft/generate-draft-pool.js'
import { getWeeklyCocktail } from '../../features/draft/weekly-cocktail.js'

// Deterministic PRNG (mulberry32), matching draft.test.ts's convention.
function mulberry32(seed: number): Rng {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

// Mirrors the enrichment issueDraftPool performs (draft.service.ts) exactly, so
// the pool asserted here is what the endpoint actually returns.
function issuePoolLikeTheService(seed: number): DraftTuple[] {
	const policy = getDraftPolicy('MultiplayerPvP', 'ranked:pvp_standard')
	if (!policy) throw new Error('ranked pvp policy missing')
	const pool = generateDraftPool(policy, mulberry32(seed))
	const weekly = getWeeklyCocktail()
	for (const tuple of pool) {
		if (tuple.key === DECK.COCKTAIL) {
			tuple.decks = [...weekly.decks]
			tuple.name = weekly.name
		}
	}
	return pool
}

describe('draft pool wire contract', () => {
	it('every item is key+stake only, or key+stake+decks+name for the cocktail tuple', () => {
		// Sweep seeds so both plain items and a cocktail item are exercised.
		let sawCocktail = false
		for (let seed = 1; seed <= 60; seed++) {
			const pool = issuePoolLikeTheService(seed)
			for (const item of pool) {
				expect(typeof item.key).toBe('string')
				expect(item.key.length).toBeGreaterThan(0)
				expect(Number.isInteger(item.stake)).toBe(true)

				if (item.key === DECK.COCKTAIL) {
					sawCocktail = true
					expect(Array.isArray(item.decks)).toBe(true)
					expect(item.decks!.every((d) => typeof d === 'string')).toBe(true)
					expect(typeof item.name).toBe('string')
				} else {
					expect(item.decks).toBeUndefined()
					expect(item.name).toBeUndefined()
				}
			}
		}
		expect(sawCocktail).toBe(true)
	})

	it('survives a real wire round-trip (JSON.parse(JSON.stringify(pool))) unchanged', () => {
		for (let seed = 1; seed <= 10; seed++) {
			const pool = issuePoolLikeTheService(seed)
			const roundTripped = JSON.parse(JSON.stringify(pool))
			expect(roundTripped).toEqual(pool)
		}
	})
})
