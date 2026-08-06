import { describe, expect, it } from 'vitest'
import { normalizeForAllowlist } from '../pipeline/normalize.js'
import { parseAllowlist } from './allowlist.js'

describe('parseAllowlist', () => {
	it('parses one normalized entry per line', () => {
		const set = parseAllowlist('gg\nglhf\nnice hand\n')
		expect(set.has(normalizeForAllowlist('gg') ?? '')).toBe(true)
		expect(set.has(normalizeForAllowlist('Nice Hand!') ?? '')).toBe(true)
		expect(set.size).toBe(3)
	})

	it('skips comments and blank lines', () => {
		const set = parseAllowlist('# header\n\ngg\n  \n# trailing\n')
		expect(set.size).toBe(1)
	})

	it('normalizes entries with the hot-path function (case + one trailing punct)', () => {
		const set = parseAllowlist('Good Game!\n')
		// A live message differing only in case/trailing punctuation must hit it.
		expect(set.has(normalizeForAllowlist('good game') ?? '')).toBe(true)
		expect(set.has(normalizeForAllowlist('GOOD GAME!') ?? '')).toBe(true)
	})

	it('keeps pure-punctuation entries exactly as the hot path would (parity)', () => {
		// normalizeForAllowlist deliberately preserves '!!!' — so must the parser,
		// or a curated '!!!' entry would never match.
		const set = parseAllowlist('!!!\n')
		expect(set.has(normalizeForAllowlist('!!!') ?? '')).toBe(true)
	})

	it('dedupes entries that normalize identically', () => {
		expect(parseAllowlist('gg\nGG\ngg!\n').size).toBe(1)
	})
})
