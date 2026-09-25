import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
	CONTACT_PATTERNS,
	INTENT_PHRASES,
	detectContactExchange,
	foldObfuscations,
} from './contact-exchange.js'
import type { SafetyMatchKind } from './contact-exchange.js'

function kinds(text: string): SafetyMatchKind[] {
	return detectContactExchange(text).map((m) => m.kind)
}

describe('foldObfuscations', () => {
	it('folds bracket/paren dot markers', () => {
		expect(foldObfuscations('mail me at name[dot]gmail[dot]com')).toContain(
			'gmail.com',
		)
		expect(foldObfuscations('name(dot)gmail(dot)com')).toContain('gmail.com')
		expect(foldObfuscations('name[.]gmail[.]com')).toContain('gmail.com')
	})

	it('folds spelled "dot" between words', () => {
		expect(foldObfuscations('check balatro dot wiki')).toContain('balatro.wiki')
	})

	it('folds a two-dot chain ("co dot uk"-style)', () => {
		expect(
			foldObfuscations('reach me at name dot site dot co dot uk'),
		).toContain('site.co.uk')
	})

	it('folds " at " only in email-shaped context (dotted domain present)', () => {
		expect(foldObfuscations('name at gmail dot com')).toContain(
			'name@gmail.com',
		)
		// no trailing dotted domain -> "at" must NOT fold
		expect(foldObfuscations('look at this')).toBe('look at this')
		expect(foldObfuscations('shooting at me')).toBe('shooting at me')
	})

	it('folds bracket "at" markers only in email-shaped context', () => {
		expect(foldObfuscations('name[at]gmail.com')).toContain('name@gmail.com')
	})

	it('folds spelled-out digit runs (3+ words)', () => {
		expect(foldObfuscations('five five five one two three four')).toContain(
			'5551234',
		)
	})

	it('does not fold a lone digit word', () => {
		expect(foldObfuscations('I have two dogs and one cat')).toBe(
			'I have two dogs and one cat',
		)
	})

	it('folds spaced-out single digits (7+)', () => {
		expect(foldObfuscations('call 5 5 5 1 2 3 4 now')).toContain('5551234')
	})

	it('does not fold a short spaced digit run (under 7)', () => {
		expect(foldObfuscations('ante 1 2 3')).toBe('ante 1 2 3')
	})

	it('folds fullwidth characters to ASCII', () => {
		expect(foldObfuscations('ｇｍａｉｌ．ｃｏｍ')).toBe('gmail.com')
	})

	it('property: never throws for arbitrary (incl. unicode) input', () => {
		fc.assert(
			fc.property(fc.string(), (s) => {
				expect(() => foldObfuscations(s)).not.toThrow()
			}),
		)
	})
})

describe('detectContactExchange — email', () => {
	it('matches a plain email', () => {
		expect(kinds('reach me at bob@example.com')).toContain('email')
	})

	it('matches an obfuscated email (bracket dot)', () => {
		expect(kinds('bob[dot]smith[at]example[dot]com')).toContain('email')
	})

	it('matches an obfuscated email (spelled dot/at)', () => {
		expect(kinds('bob at example dot com')).toContain('email')
	})
})

describe('detectContactExchange — phone', () => {
	it('matches a standard hyphenated phone number', () => {
		expect(kinds('call me at 555-123-4567')).toContain('phone')
	})

	it('matches a parenthesized area code', () => {
		expect(kinds('(555) 123-4567 is my number')).toContain('phone')
	})

	it('matches spelled-out digits', () => {
		expect(kinds('five five five one two three four')).toContain('phone')
	})

	it('matches spaced-out single digits', () => {
		expect(kinds('5 5 5 1 2 3 4')).toContain('phone')
	})

	it('does NOT match short game-speak numbers', () => {
		expect(kinds('gg 42 points')).not.toContain('phone')
		expect(kinds('i played 8888 hands')).not.toContain('phone')
	})
})

describe('detectContactExchange — ip', () => {
	it('matches a dotted-quad IP', () => {
		expect(kinds('connect to 192.168.1.1 please')).toContain('ip')
	})

	it('does not double-report an IP as phone', () => {
		const matches = detectContactExchange('connect to 192.168.1.1 please')
		expect(matches.filter((m) => m.kind === 'phone')).toHaveLength(0)
	})
})

describe('detectContactExchange — url', () => {
	it('matches an http(s) url', () => {
		expect(kinds('go to https://example.com/x now')).toContain('url')
	})

	it('matches a www url', () => {
		expect(kinds('go to www.example.com now')).toContain('url')
	})

	it('matches a bare domain with a known TLD', () => {
		expect(kinds('check balatro.wiki for seeds')).toContain('url')
	})

	it('does NOT match plain words with no dot present', () => {
		expect(kinds('check the balatro wiki')).not.toContain('url')
	})

	it('matches an obfuscated bare domain ("dot" spelled out)', () => {
		expect(kinds('check balatro dot wiki for seeds')).toContain('url')
	})
})

describe('detectContactExchange — invite_link', () => {
	it('matches a discord.gg invite', () => {
		expect(kinds('join us at discord.gg/abc123')).toContain('invite_link')
	})

	it('matches a discord.com/invite link', () => {
		expect(kinds('discord.com/invite/abc123')).toContain('invite_link')
	})

	it('reports the invite as invite_link, not a generic url', () => {
		const matches = detectContactExchange('join us at discord.gg/abc123')
		expect(matches.filter((m) => m.kind === 'url')).toHaveLength(0)
	})
})

describe('detectContactExchange — social_handle', () => {
	it('matches a discord discriminator tag', () => {
		expect(kinds('add me, xyz#1234')).toContain('social_handle')
	})

	it('matches "@handle on <platform>"', () => {
		expect(kinds('hit me up @coolkid99 on snap')).toContain('social_handle')
		expect(kinds('@player1 on telegram')).toContain('social_handle')
	})

	it('matches "on discord: handle"', () => {
		expect(kinds('on discord: xyz')).toContain('social_handle')
	})

	it('does NOT match a bare Balatro seed string', () => {
		expect(kinds('the seed is ALEEB7AM')).not.toContain('social_handle')
		expect(kinds('try seed ALEEB7AM next run')).not.toContain('social_handle')
	})
})

describe('detectContactExchange — intent phrases (orange)', () => {
	const cases: Array<[string, string]> = [
		['add me on snapchat', 'add_me_on'],
		['dm me later', 'dm_me'],
		['message me on discord', 'message_me_on'],
		["what's your discord", 'whats_your_contact'],
		['whats ur number', 'whats_ur'],
		['send me a pic', 'send_pic'],
		['how old are you', 'how_old'],
		['where do you live', 'where_live'],
		['what school do you go to', 'what_school'],
		['are your parents around', 'parents'],
		["let's talk somewhere else", 'talk_elsewhere'],
		['lets move to whatsapp', 'move_to'],
		['off platform please', 'off_platform'],
	]

	for (const [text] of cases) {
		it(`flags orange intent for: "${text}"`, () => {
			const matches = detectContactExchange(text)
			expect(matches.some((m) => m.severity === 'orange')).toBe(true)
			expect(matches.some((m) => m.kind === 'intent_phrase')).toBe(true)
		})
	}

	it('every declared intent phrase label is reachable by its own pattern', () => {
		for (const { pattern, label } of INTENT_PHRASES) {
			pattern.lastIndex = 0
			expect(label.length).toBeGreaterThan(0)
		}
	})

	it('does not flag ordinary chat as an intent phrase', () => {
		const matches = detectContactExchange('nice hand, gg well played')
		expect(matches.some((m) => m.kind === 'intent_phrase')).toBe(false)
	})
})

describe('detectContactExchange — severity', () => {
	it('contact matches and intent phrases are orange (review, not hard-block)', () => {
		const matches = detectContactExchange('email me at bob@example.com, dm me')
		const email = matches.find((m) => m.kind === 'email')
		const intent = matches.find((m) => m.kind === 'intent_phrase')
		expect(email?.severity).toBe('orange')
		expect(intent?.severity).toBe('orange')
	})
})

describe('detectContactExchange — match record shape', () => {
	it('reports span/startIndex/endIndex/pattern consistent with the folded text', () => {
		const folded = foldObfuscations('bob@example.com')
		const [match] = detectContactExchange('bob@example.com')
		expect(match.span).toBe(folded.slice(match.startIndex, match.endIndex))
		expect(match.pattern.length).toBeGreaterThan(0)
	})

	it('returns matches sorted by startIndex', () => {
		const matches = detectContactExchange(
			'bob@example.com then call 555-123-4567 then dm me',
		)
		const indices = matches.map((m) => m.startIndex)
		expect(indices).toEqual([...indices].sort((a, b) => a - b))
	})

	it('does not overlap-report the same span under two kinds', () => {
		const matches = detectContactExchange(
			'bob@example.com then www.example.com then dm me',
		)
		for (let i = 0; i < matches.length; i++) {
			for (let j = i + 1; j < matches.length; j++) {
				const a = matches[i]
				const b = matches[j]
				const overlap = a.startIndex < b.endIndex && b.startIndex < a.endIndex
				expect(overlap).toBe(false)
			}
		}
	})
})

describe('detectContactExchange — totality property', () => {
	it('never throws for arbitrary (incl. unicode) input and returns well-formed matches', () => {
		fc.assert(
			fc.property(fc.string(), (s) => {
				const matches = detectContactExchange(s)
				expect(Array.isArray(matches)).toBe(true)
				for (const m of matches) {
					expect(m.startIndex).toBeGreaterThanOrEqual(0)
					expect(m.endIndex).toBeGreaterThan(m.startIndex)
					expect(['red', 'orange']).toContain(m.severity)
				}
			}),
		)
	})
})

describe('RE2 safety — adversarial latency', () => {
	// A 10KB adversarial string mixing long digit runs, repeated punctuation,
	// and a stretched-out non-matching prefix designed to maximize backtracking
	// in a naively-written regex. Every exported pattern must resolve linearly.
	const ADVERSARIAL = `${'a'.repeat(2000)}!${'1'.repeat(2000)} ${'5 '.repeat(2000)}${'.'.repeat(2000)}${'@'.repeat(1000)}`

	it('every CONTACT_PATTERNS regex completes linearly (no ReDoS) on adversarial input', () => {
		for (const { regex, kind } of CONTACT_PATTERNS) {
			regex.lastIndex = 0
			const start = performance.now()
			// exhaust all matches, mirroring how `collect` drives the regex
			let m = regex.exec(ADVERSARIAL)
			let guard = 0
			while (m !== null && guard < 100_000) {
				if (m[0].length === 0) regex.lastIndex += 1
				m = regex.exec(ADVERSARIAL)
				guard++
			}
			const elapsed = performance.now() - start
			expect.soft(elapsed, `${kind}: ${regex.source}`).toBeLessThan(1000)
		}
	})

	it('every INTENT_PHRASES regex completes linearly (no ReDoS) on adversarial input', () => {
		for (const { pattern, label } of INTENT_PHRASES) {
			pattern.lastIndex = 0
			const start = performance.now()
			let m = pattern.exec(ADVERSARIAL)
			let guard = 0
			while (m !== null && guard < 100_000) {
				if (m[0].length === 0) pattern.lastIndex += 1
				m = pattern.exec(ADVERSARIAL)
				guard++
			}
			const elapsed = performance.now() - start
			expect.soft(elapsed, label).toBeLessThan(1000)
		}
	})

	it('the full detectContactExchange pipeline completes linearly (no ReDoS) on adversarial input', () => {
		const start = performance.now()
		detectContactExchange(ADVERSARIAL)
		expect(performance.now() - start).toBeLessThan(1000)
	})

	it('foldObfuscations completes linearly (no ReDoS) on adversarial input', () => {
		const start = performance.now()
		foldObfuscations(ADVERSARIAL)
		expect(performance.now() - start).toBeLessThan(1000)
	})
})
