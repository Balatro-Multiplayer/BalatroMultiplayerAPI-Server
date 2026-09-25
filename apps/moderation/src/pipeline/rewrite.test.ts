import { describe, expect, it } from 'vitest'
import { applyRewrites, parseRewrites } from './rewrite.js'

const COCK = parseRewrites('cock => cocktail')

describe('parseRewrites', () => {
	it('parses one rule per line and skips comments/blanks', () => {
		const rules = parseRewrites(
			'# community vocabulary\ncock => cocktail\n\n# more\nbm => bad manners\n',
		)
		expect(rules).toEqual([
			{ from: 'cock', to: 'cocktail' },
			{ from: 'bm', to: 'bad manners' },
		])
	})

	it('skips malformed lines and identity rules', () => {
		expect(parseRewrites('no arrow here\ncock => cock\n=> x\n')).toEqual([])
	})

	it('parses an !! unless guard into a case-insensitive regex', () => {
		const rules = parseRewrites('cock => cocktail !! my\\s+cock')
		expect(rules).toHaveLength(1)
		expect(rules[0]?.unless).toBeInstanceOf(RegExp)
		expect(rules[0]?.unless?.test('SUCK MY COCK')).toBe(true)
		expect(rules[0]?.unless?.test('white cock?')).toBe(false)
	})

	it('drops the whole rule when the unless regex is malformed (fail closed)', () => {
		expect(parseRewrites('cock => cocktail !! ((broken')).toEqual([])
	})
})

describe('applyRewrites', () => {
	it('rewrites on word boundaries, preserving the rest of the message', () => {
		expect(applyRewrites('wanna do white cock?', COCK)).toBe(
			'wanna do white cocktail?',
		)
	})

	it('never re-matches inside the target word', () => {
		expect(applyRewrites('cocktail deck anyone?', COCK)).toBe(
			'cocktail deck anyone?',
		)
		// and a message that already says cocktail is a fixed point
		const once = applyRewrites('suck my cock', COCK)
		expect(once).toBe('suck my cocktail')
		expect(applyRewrites(once, COCK)).toBe(once)
	})

	it('preserves simple casing', () => {
		expect(applyRewrites('COCK?', COCK)).toBe('COCKTAIL?')
		expect(applyRewrites('Cock deck', COCK)).toBe('Cocktail deck')
	})

	it('rewrites every occurrence', () => {
		expect(applyRewrites('cock cock cock', COCK)).toBe(
			'cocktail cocktail cocktail',
		)
	})

	it('returns the input unchanged when nothing matches', () => {
		expect(applyRewrites('gg wp', COCK)).toBe('gg wp')
		expect(applyRewrites('peacock feathers', COCK)).toBe('peacock feathers')
	})

	it('escapes regex metacharacters in rule sources', () => {
		const rules = parseRewrites('g.g => gg')
		expect(applyRewrites('gag', rules)).toBe('gag')
		expect(applyRewrites('g.g', rules)).toBe('gg')
	})

	describe('unless guard (anti-laundering, 2026-07-09)', () => {
		// The production rule shape: rewrite deck talk, but NOT sexual frames —
		// those must reach the guard raw so it can block them.
		const GUARDED = parseRewrites(
			'cock => cocktail !! (my|your|ur)\\s+cock|\\b(suck|lick)\\w*\\b[\\s\\w]{0,20}\\bcock',
		)

		it('skips the rewrite in sexual frames so the guard sees the raw text', () => {
			expect(applyRewrites('suck my cock', GUARDED)).toBe('suck my cock')
			expect(applyRewrites('do you want my cock', GUARDED)).toBe(
				'do you want my cock',
			)
			expect(applyRewrites('sucking ur cock', GUARDED)).toBe('sucking ur cock')
		})

		it('still rewrites deck-talk frames', () => {
			expect(applyRewrites('wanna do white cock?', GUARDED)).toBe(
				'wanna do white cocktail?',
			)
			expect(applyRewrites('cock deck anyone?', GUARDED)).toBe(
				'cocktail deck anyone?',
			)
			expect(applyRewrites('wanna play cock?', GUARDED)).toBe(
				'wanna play cocktail?',
			)
		})

		it('the guard matches against the ORIGINAL message, not partial rewrites', () => {
			// one message, both frames: guard hit disables the rule for the whole message
			expect(applyRewrites('white cock? also suck my cock', GUARDED)).toBe(
				'white cock? also suck my cock',
			)
		})
	})
})
