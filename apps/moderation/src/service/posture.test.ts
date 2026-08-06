import { describe, expect, it } from 'vitest'
import { postureBannerLines } from './posture.js'

describe('postureBannerLines', () => {
	it('shadow mode: names both the review-not-block behavior and the carve count', () => {
		const lines = postureBannerLines(
			{ enforcement: 'shadow', authEnabled: true },
			18,
		)
		expect(lines[0]).toContain('ENFORCEMENT=SHADOW')
		expect(lines[0]).toContain('PUBLISHED')
		expect(lines[0]).toContain('18 profanity phrases')
	})

	it('enforce mode: says blocks are blocked, no carve caveat', () => {
		const lines = postureBannerLines(
			{ enforcement: 'enforce', authEnabled: true },
			18,
		)
		expect(lines[0]).toContain('ENFORCEMENT=ENFORCE')
		expect(lines[0]).toContain('BLOCKED')
	})

	it('auth disabled is loud regardless of enforcement mode', () => {
		const lines = postureBannerLines(
			{ enforcement: 'enforce', authEnabled: false },
			0,
		)
		expect(lines[1]).toContain('AUTH=DISABLED')
		expect(lines[1]).toContain('UNAUTHENTICATED')
	})

	it('auth enabled is a quiet one-liner', () => {
		const lines = postureBannerLines(
			{ enforcement: 'shadow', authEnabled: true },
			0,
		)
		expect(lines[1]).toBe('[moderation] AUTH=enabled')
	})

	it('always returns exactly one enforcement line and one auth line', () => {
		const lines = postureBannerLines(
			{ enforcement: 'shadow', authEnabled: false },
			5,
		)
		expect(lines).toHaveLength(2)
	})
})
