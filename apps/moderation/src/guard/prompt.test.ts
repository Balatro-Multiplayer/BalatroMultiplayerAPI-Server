import { describe, expect, it } from 'vitest'
import {
	FOOTER,
	HEADER,
	buildPrompt,
	parseDomainContext,
	parseGuardOutput,
} from './prompt.js'

describe('buildPrompt', () => {
	it('wraps a single sender turn in the exact trained template', () => {
		const prompt = buildPrompt([{ who: 'sender', text: 'you suck lol' }])

		expect(prompt).toBe(`${HEADER}USER: you suck lol${FOOTER}`)
	})

	it('renders the opponent as ASSISTANT and preserves turn order', () => {
		const prompt = buildPrompt([
			{ who: 'sender', text: 'gg that was close' },
			{ who: 'other', text: 'you got lucky' },
			{ who: 'sender', text: 'you suck lol' },
		])

		expect(prompt).toBe(
			`${HEADER}USER: gg that was close\nASSISTANT: you got lucky\nUSER: you suck lol${FOOTER}`,
		)
	})

	it('injects domain context inside the user turn, before the task block', () => {
		const prompt = buildPrompt(
			[{ who: 'sender', text: 'white stake fine?' }],
			'"white stake" is a difficulty level.',
		)

		expect(prompt).toBe(
			`${HEADER.replace(
				'<|im_start|>user\n',
				'<|im_start|>user\n<GAME CONTEXT>\n"white stake" is a difficulty level.\n</GAME CONTEXT>\n\n',
			)}USER: white stake fine?${FOOTER}`,
		)
		// the trained template's own structure must be untouched
		expect(prompt).toContain('# Task:')
		expect(prompt.endsWith(FOOTER)).toBe(true)
	})

	it('produces the exact stock prompt when domain context is empty/blank', () => {
		const stock = buildPrompt([{ who: 'sender', text: 'gg' }])
		expect(buildPrompt([{ who: 'sender', text: 'gg' }], '')).toBe(stock)
		expect(buildPrompt([{ who: 'sender', text: 'gg' }], '   \n ')).toBe(stock)
		expect(buildPrompt([{ who: 'sender', text: 'gg' }], undefined)).toBe(stock)
	})
})

describe('parseDomainContext', () => {
	it('strips # comment lines and trims the result', () => {
		const text =
			'# editor note\nThis is game chat.\n# another note\n- "stake" is a difficulty\n'

		expect(parseDomainContext(text)).toBe(
			'This is game chat.\n- "stake" is a difficulty',
		)
	})

	it('returns empty string for comment-only or blank input', () => {
		expect(parseDomainContext('# only comments\n# here\n')).toBe('')
		expect(parseDomainContext('')).toBe('')
	})

	it('preserves inline # that is not at line start', () => {
		expect(parseDomainContext('discord tags look like name#1234')).toBe(
			'discord tags look like name#1234',
		)
	})
})

describe('parseGuardOutput', () => {
	it('parses a Safe verdict with no categories', () => {
		const raw = 'Safety: Safe\nCategories: None'

		expect(parseGuardOutput(raw)).toEqual({ safety: 'Safe', categories: [] })
	})

	it('parses an Unsafe verdict with a single category', () => {
		const raw = 'Safety: Unsafe\nCategories: Violent'

		expect(parseGuardOutput(raw)).toEqual({
			safety: 'Unsafe',
			categories: ['Violent'],
		})
	})

	it('parses a Controversial verdict with multiple categories, deduplicated', () => {
		const raw =
			'Safety: Controversial\nCategories: Unethical Acts, Unethical Acts, PII'

		expect(parseGuardOutput(raw)).toEqual({
			safety: 'Controversial',
			categories: ['Unethical Acts', 'PII'],
		})
	})

	it('ignores surrounding reasoning text and <think> tags', () => {
		const raw =
			'<think>the sender is escalating after a stalking signal</think>\nSafety: Unsafe\nCategories: Violent, PII<|im_end|>'

		expect(parseGuardOutput(raw)).toEqual({
			safety: 'Unsafe',
			categories: ['Violent', 'PII'],
		})
	})

	it('returns unknown safety and no categories for malformed output', () => {
		const raw = 'the model rambled without following the format'

		expect(parseGuardOutput(raw)).toEqual({ safety: 'unknown', categories: [] })
	})

	it('returns unknown safety for empty output', () => {
		expect(parseGuardOutput('')).toEqual({ safety: 'unknown', categories: [] })
	})
})
