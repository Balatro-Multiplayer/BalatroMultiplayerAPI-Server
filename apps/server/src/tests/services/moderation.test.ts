import { describe, expect, it } from 'vitest'
import { decideModerationOutcome } from '../../features/chat/moderation.js'

describe('moderation.decideModerationOutcome', () => {
	it('allows and publishes the original text when no rewrite is given', () => {
		expect(
			decideModerationOutcome({ status: 200, body: { verdict: 'allow' } }),
		).toEqual({
			allowed: true,
			publishText: null,
		})
	})

	it('allows and returns the rewrite when publishText is a non-empty string', () => {
		expect(
			decideModerationOutcome({
				status: 200,
				body: { verdict: 'allow', publishText: 'cleaned up text' },
			}),
		).toEqual({ allowed: true, publishText: 'cleaned up text' })
	})

	it('blocks rather than republishing the original when the rewrite is empty', () => {
		// A present-but-empty publishText means the service redacted the message
		// down to nothing and still allowed it. Falling back to the original
		// text here would republish exactly what the rewrite removed.
		expect(
			decideModerationOutcome({
				status: 200,
				body: { verdict: 'allow', publishText: '' },
			}),
		).toEqual({ allowed: false, reason: 'moderated', band: 'unusable_rewrite' })
	})

	it('blocks rather than republishing the original when the rewrite is whitespace-only', () => {
		expect(
			decideModerationOutcome({
				status: 200,
				body: { verdict: 'allow', publishText: '   ' },
			}),
		).toEqual({ allowed: false, reason: 'moderated', band: 'unusable_rewrite' })
	})

	it('blocks rather than republishing the original when publishText has the wrong type', () => {
		// A rewrite was intended and is unreadable — that is closer to "reject"
		// than to "service is down", so this degrades to a plain block rather
		// than 'unavailable'.
		expect(
			decideModerationOutcome({
				status: 200,
				body: { verdict: 'allow', publishText: 42 },
			}),
		).toEqual({ allowed: false, reason: 'moderated', band: 'unusable_rewrite' })
	})

	it('blocks with reason rate_limited for the rate_limited band', () => {
		expect(
			decideModerationOutcome({
				status: 200,
				body: { verdict: 'reject', band: 'rate_limited' },
			}),
		).toEqual({ allowed: false, reason: 'rate_limited' })
	})

	// HTTP 429 is the service shedding load globally. Reporting it as
	// rate_limited would tell a player who sent one message that they are
	// chatting too fast, because someone else flooded the service.
	it('treats an HTTP 429 as a service outage, not as the player being too fast', () => {
		expect(
			decideModerationOutcome({ status: 429, body: { verdict: 'allow' } }),
		).toEqual({ allowed: false, reason: 'unavailable' })
		expect(decideModerationOutcome({ status: 429, body: null })).toEqual({
			allowed: false,
			reason: 'unavailable',
		})
		expect(
			decideModerationOutcome({
				status: 429,
				body: '<html>too many requests</html>',
			}),
		).toEqual({ allowed: false, reason: 'unavailable' })
	})

	it.each(['threat_block', 'blocklist', 'safety_block', 'guard_block'])(
		'blocks with the generic reason for the %s band',
		(band) => {
			expect(
				decideModerationOutcome({
					status: 200,
					body: { verdict: 'reject', band },
				}),
			).toEqual({
				allowed: false,
				reason: 'moderated',
				band,
			})
		},
	)

	it('reports guard_unavailable as unavailable, not as a rule violation', () => {
		// The service rejected because its own model was down. Telling the
		// player they broke a rule would be a lie.
		expect(
			decideModerationOutcome({
				status: 200,
				body: { verdict: 'reject', band: 'guard_unavailable' },
			}),
		).toEqual({ allowed: false, reason: 'unavailable' })
	})

	it('degrades an unrecognised reject band to the generic block, never an allow', () => {
		expect(
			decideModerationOutcome({
				status: 200,
				body: { verdict: 'reject', band: 'some_future_band' },
			}),
		).toEqual({ allowed: false, reason: 'moderated', band: 'some_future_band' })
	})

	it('blocks with reason moderated when a reject has no band at all', () => {
		expect(
			decideModerationOutcome({ status: 200, body: { verdict: 'reject' } }),
		).toEqual({
			allowed: false,
			reason: 'moderated',
		})
	})

	it('fails closed as unavailable on a transport failure (null attempt)', () => {
		expect(decideModerationOutcome(null)).toEqual({
			allowed: false,
			reason: 'unavailable',
		})
	})

	it.each([400, 401, 413, 500, 503])(
		'fails closed as unavailable for HTTP status %i',
		(status) => {
			expect(
				decideModerationOutcome({ status, body: { verdict: 'allow' } }),
			).toEqual({
				allowed: false,
				reason: 'unavailable',
			})
		},
	)

	it('fails closed as unavailable on an unparseable body', () => {
		expect(decideModerationOutcome({ status: 200, body: null })).toEqual({
			allowed: false,
			reason: 'unavailable',
		})
		expect(
			decideModerationOutcome({
				status: 200,
				body: '<html>proxy error</html>',
			}),
		).toEqual({
			allowed: false,
			reason: 'unavailable',
		})
		expect(decideModerationOutcome({ status: 200, body: [] })).toEqual({
			allowed: false,
			reason: 'unavailable',
		})
	})

	it('fails closed as unavailable on an unrecognised verdict value', () => {
		expect(
			decideModerationOutcome({ status: 200, body: { verdict: 'maybe' } }),
		).toEqual({
			allowed: false,
			reason: 'unavailable',
		})
	})

	// A malformed band or publishText is a cosmetic contract drift, not
	// evidence the service is unreachable. A bad band on a reject can't cause
	// an unsafe publish (the message is blocked either way), so it degrades to
	// a plain block instead of taking chat down; see the publishText-type-drift
	// cases above for the allow side.
	it('degrades a reject with a wrong-typed band to the generic block, not unavailable', () => {
		expect(
			decideModerationOutcome({
				status: 200,
				body: { verdict: 'reject', band: 42 },
			}),
		).toEqual({ allowed: false, reason: 'moderated' })
	})

	describe("the relay's own message cap (500 chars)", () => {
		it('blocks a rewrite that exceeds the cap rather than publishing or truncating it', () => {
			expect(
				decideModerationOutcome({
					status: 200,
					body: { verdict: 'allow', publishText: 'x'.repeat(501) },
				}),
			).toEqual({ allowed: false, reason: 'moderated', band: 'oversized_rewrite' })
		})

		it('allows a rewrite exactly at the cap', () => {
			const text = 'x'.repeat(500)
			expect(
				decideModerationOutcome({
					status: 200,
					body: { verdict: 'allow', publishText: text },
				}),
			).toEqual({ allowed: true, publishText: text })
		})
	})
})
