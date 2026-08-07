import { describe, expect, it } from 'vitest'
import { findThreats } from './threat.js'

// The demonstrated guard misses (2026-07-09) plus obvious siblings. These MUST
// be caught deterministically — the guard rated several of them Safe.
const MUST_BLOCK = [
	'i will execute your family',
	'I will execute your fucking family',
	'i will fucking kill you',
	'im gonna kill you',
	'imma kill u',
	'i will murder your family',
	'execute your whole family',
	'i will behead you', // intent + you
	'strangle your kids',
	'i will slaughter your entire family',
	'k1ll your family', // leetspeak
	'i will kiiiill you', // stretched
	'i.will.kill.you', // punctuation as separators
	'i will k i l l you', // letter-spacing evasion
	'imma end your bloodline', // bloodline family target
	'murder your mom',
	'i will destroy your family', // tier B + family
	'imma end your whole family',
	'i will beat your mom',
	// Game-scope exemption must NOT be a bypass template: qualifier not at the
	// end, or aimed at family, still blocks.
	'ima kill you in this game and then in real life',
	'i will kill you in this game and irl too',
	'i will kill your family in this game',
	'ima kill you in your house',
]

// Normal lobby speech / game-speak / hyperbole / mom-jokes with no directed
// person target. These must NOT block — this is the false-positive floor the
// guard fine-tune exists to protect, and the reason this tier is target-gated.
const MUST_NOT_BLOCK = [
	'execute the combo',
	"i'll kill this run",
	'gonna murder this boss',
	'destroy you', // tier B + bare you stays banter
	'i will destroy you at this game',
	'i destroyed you lol',
	'you killed that last hand',
	"you're killing me",
	'this rng is murdering me',
	'gg i will kill it next time',
	'kill your combo',
	'execute your macro',
	'end your turn',
	'i will end my run',
	'my family loves this game',
	'skill issue', // 'skill' must not read as 'kill'
	'that boss will kill you', // no first-person intent -> guard's job, not ours
	'nice you beat me',
	'gg wp that was close',
	'fuck this rng man',
	// Game-scoped match taunts (measured FP 2026-07-11): the qualifier ends the
	// message, so the bare-you rung defers to the guard instead of hard-blocking.
	'ima kill you in this game',
	'i will kill you this run',
	'imma kill u in the next round lol',
	'i will kill you in balatro',
]

describe('findThreats', () => {
	it('blocks directed violent threats', () => {
		for (const m of MUST_BLOCK) {
			expect(findThreats(m).length, `should block: "${m}"`).toBeGreaterThan(0)
		}
	})

	it('does not block banter / game-speak / hyperbole', () => {
		for (const m of MUST_NOT_BLOCK) {
			expect(findThreats(m), `should NOT block: "${m}"`).toEqual([])
		}
	})

	it('returns match spans with the offending phrase', () => {
		const [m] = findThreats('i will execute your family')
		expect(m.word).toContain('execute')
		expect(m.endIndex).toBeGreaterThan(m.startIndex)
	})

	it('is total — never throws on odd input', () => {
		for (const m of ['', '   ', '💀💀💀', '\n\n', 'a'.repeat(3000)]) {
			expect(() => findThreats(m)).not.toThrow()
		}
	})
})
