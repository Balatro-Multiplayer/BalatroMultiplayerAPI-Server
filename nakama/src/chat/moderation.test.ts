import { describe, expect, it } from 'vitest'
import { decideModerationOutcome } from './moderation'

const ok = (body: unknown, status = 200) => ({ status, body })

describe('decideModerationOutcome', () => {
	it('allows an allow verdict, ignoring any publishText', () => {
		expect(decideModerationOutcome(ok({ verdict: 'allow' }))).toEqual({ allowed: true, review: false })
		expect(decideModerationOutcome(ok({ verdict: 'allow', publishText: 'gg' }))).toEqual({ allowed: true, review: false })
	})
	it('keeps the guard score of an allowed message', () => {
		const body = { verdict: 'allow', band: 'clean', guardSafety: 'Safe', guardScore: 0.02, guardContextUsed: true }
		expect(decideModerationOutcome(ok(body))).toEqual({
			allowed: true,
			review: false,
			band: 'clean',
			guard: { safety: 'Safe', score: 0.02, contextUsed: true },
		})
	})
	it('keeps the guard score of a blocked message', () => {
		const body = { verdict: 'reject', band: 'high', guardSafety: 'Unsafe', guardScore: 0.97, guardContextUsed: false }
		expect(decideModerationOutcome(ok(body))).toEqual({
			allowed: false,
			reason: 'moderated',
			band: 'high',
			guard: { safety: 'Unsafe', score: 0.97, contextUsed: false },
		})
	})
	it('ignores a guard field of the wrong type', () => {
		expect(decideModerationOutcome(ok({ verdict: 'allow', guardScore: 'high' }))).toEqual({ allowed: true, review: false })
	})
	it('blocks a reject as moderated, with its band', () => {
		expect(decideModerationOutcome(ok({ verdict: 'reject', band: 'slur' }))).toEqual({
			allowed: false,
			reason: 'moderated',
			band: 'slur',
		})
	})
	it('fails closed on anything it cannot read', () => {
		for (const attempt of [null, ok({ verdict: 'allow' }, 500), ok({ verdict: 'allow' }, 429), ok('x'), ok({ verdict: 'maybe' })])
			expect(decideModerationOutcome(attempt)).toEqual({ allowed: false, reason: 'unavailable' })
	})
	it('does not blame the player when the service model is down', () => {
		expect(decideModerationOutcome(ok({ verdict: 'reject', band: 'guard_unavailable' }))).toEqual({
			allowed: false,
			reason: 'unavailable',
		})
	})
})
