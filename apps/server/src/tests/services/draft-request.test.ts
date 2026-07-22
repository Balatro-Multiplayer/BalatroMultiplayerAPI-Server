// Draft HTTP-input parser tests: pure parse functions, no req/res/service --
// one happy path + one rejection per validation rule.

import { describe, expect, it } from 'vitest'
import { parseMatchIdParam } from '../../features/draft/draft.request.js'
import { ValidationError } from '../../shared/utils/errors.js'

function expectRejects(fn: () => unknown): void {
	try {
		fn()
		throw new Error('expected fn to throw')
	} catch (err) {
		expect(err).toBeInstanceOf(ValidationError)
		expect((err as ValidationError).statusCode).toBe(400)
	}
}

describe('parseMatchIdParam', () => {
	it('accepts a normal matchId', () => {
		expect(parseMatchIdParam({ matchId: 'm1' })).toBe('m1')
	})

	it('rejects a missing matchId', () => {
		expectRejects(() => parseMatchIdParam({}))
	})

	it('rejects a non-string matchId', () => {
		expectRejects(() => parseMatchIdParam({ matchId: 123 }))
	})

	it('rejects a blank (whitespace-only) matchId', () => {
		expectRejects(() => parseMatchIdParam({ matchId: '   ' }))
	})

	it('rejects a matchId over the max length', () => {
		expectRejects(() => parseMatchIdParam({ matchId: 'a'.repeat(129) }))
	})

	it('accepts a matchId exactly at the max length', () => {
		const matchId = 'a'.repeat(128)
		expect(parseMatchIdParam({ matchId })).toBe(matchId)
	})
})
