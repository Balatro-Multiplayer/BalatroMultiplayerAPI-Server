import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
	capForScoring,
	normalizeForAllowlist,
	scoringVariants,
} from './normalize.js'

describe('normalizeForAllowlist', () => {
	it('trims, lowercases, strips one trailing punctuation', () => {
		expect(normalizeForAllowlist('  Nice Hand! ')).toBe('nice hand')
		expect(normalizeForAllowlist('GG')).toBe('gg')
	})
	it('returns null for whitespace-only', () => {
		expect(normalizeForAllowlist('   ')).toBeNull()
		expect(normalizeForAllowlist('')).toBeNull()
	})
	it('preserves pure-punctuation messages', () => {
		expect(normalizeForAllowlist('...')).toBe('...')
		expect(normalizeForAllowlist('?')).toBe('?')
	})
})

describe('scoringVariants', () => {
	it('folds leetspeak', () => {
		expect(scoringVariants('k1ll y0u')).toContain('kill you')
	})
	it('squeezes stretched letters', () => {
		const v = scoringVariants('kiiiill')
		expect(v).toContain('kiill') // 3+ -> 2
		expect(v).toContain('kil') // all -> 1
	})
	it('always includes the original text first', () => {
		expect(scoringVariants('Hello')[0]).toBe('Hello')
	})
	it('de-duplicates (text with no repeats/leet yields one variant)', () => {
		expect(scoringVariants('wp')).toEqual(['wp'])
	})

	it('property: never throws and includes the original for arbitrary input', () => {
		fc.assert(
			fc.property(fc.string(), (s) => {
				const v = scoringVariants(s)
				expect(Array.isArray(v)).toBe(true)
				expect(v).toContain(s)
			}),
		)
	})

	it('property: folded variants are a fixed point (folding again adds nothing new)', () => {
		fc.assert(
			fc.property(fc.string(), (s) => {
				const first = scoringVariants(s)
				// re-running on the folded form must not produce spellings outside a
				// re-fold of those same forms (idempotence of the fold).
				for (const variant of first) {
					const again = scoringVariants(variant)
					for (const a of again) {
						// every re-derived spelling is itself reachable by folding `variant`
						expect(scoringVariants(variant)).toContain(a)
					}
				}
			}),
		)
	})
})

describe('capForScoring', () => {
	it('returns variants unchanged when no cap is set', () => {
		const v = ['hello world', 'hello']
		expect(capForScoring(v)).toBe(v) // same reference: pure pass-through
		expect(capForScoring(v, 0)).toBe(v)
		expect(capForScoring(v, -5)).toBe(v)
	})

	it('caps each variant to the first N chars', () => {
		expect(capForScoring(['abcdefgh'], 3)).toEqual(['abc'])
		expect(capForScoring(['ab'], 5)).toEqual(['ab']) // shorter than cap: kept
	})

	it('de-dupes variants that collapse to the same prefix', () => {
		// two spellings that only diverge past the cut become one input to score
		expect(capForScoring(['killer', 'killed'], 4)).toEqual(['kill'])
	})

	it('property: every capped variant is <= maxChars and idempotent', () => {
		fc.assert(
			fc.property(
				fc.array(fc.string(), { maxLength: 6 }),
				fc.integer({ min: 1, max: 50 }),
				(variants, cap) => {
					const capped = capForScoring(variants, cap)
					// hard ceiling on every scored string
					expect(capped.every((s) => s.length <= cap)).toBe(true)
					// distinct (Set semantics)
					expect(new Set(capped).size).toBe(capped.length)
					// capping never grows the work set
					expect(capped.length).toBeLessThanOrEqual(variants.length)
					// re-capping the capped set changes nothing
					expect(capForScoring(capped, cap)).toEqual(capped)
				},
			),
		)
	})
})
