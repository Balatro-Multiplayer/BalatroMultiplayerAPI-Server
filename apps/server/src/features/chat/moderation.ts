// Pure decision core for the remote moderation bridge. No I/O — the shell
// (infrastructure/gateways/moderation.gateway.ts) performs the HTTP call and
// hands the outcome in as plain data.

export type ModerationAttempt = { status: number; body: unknown } | null

export type ModerationBlockReason = 'moderated' | 'rate_limited' | 'unavailable'

export type ModerationOutcome =
	| { allowed: true; publishText: string | null }
	| { allowed: false; reason: ModerationBlockReason; band?: string }

type ModerationResponseBody = {
	verdict: 'allow' | 'reject'
	band?: unknown
	publishText?: unknown
}

function isModerationResponseBody(
	value: unknown,
): value is ModerationResponseBody {
	if (typeof value !== 'object' || value === null) return false
	const record = value as Record<string, unknown>
	return record.verdict === 'allow' || record.verdict === 'reject'
}

// Must match the relay's own cap on an incoming message (lobby.route.ts) —
// the transform tier can rewrite a compliant message into one that exceeds it.
const MAX_PUBLISH_LENGTH = 500

// Any transport failure, non-200 status, unparseable body, or unrecognised
// verdict fails closed as 'unavailable' — never allow on uncertainty. That
// deliberately includes HTTP 429: the service sheds load globally with that
// status, which is a capacity problem, not this player sending too fast.
// Per-player rate limiting arrives as 200 + {verdict:'reject',
// band:'rate_limited'} and is the only thing told to slow down.
// A malformed band or publishText degrades the single field that's
// unreadable rather than failing the whole message: an unrecognisable band
// on a reject is still a block (just the generic one), and an unreadable
// publishText on an allow is treated as a rewrite to nothing — see below.
export function decideModerationOutcome(
	attempt: ModerationAttempt,
): ModerationOutcome {
	if (
		attempt === null ||
		attempt.status !== 200 ||
		!isModerationResponseBody(attempt.body)
	) {
		return { allowed: false, reason: 'unavailable' }
	}

	const { verdict, band, publishText } = attempt.body

	if (verdict === 'allow') {
		if (publishText === undefined) return { allowed: true, publishText: null }
		// A rewrite was intended. A non-string or blank-after-trim rewrite is
		// unreadable or nothing, and publishing the original in that case would
		// republish exactly the content the rewrite was meant to remove — block
		// instead of falling back to the original.
		if (typeof publishText !== 'string' || !publishText.trim()) {
			return { allowed: false, reason: 'moderated', band: 'unusable_rewrite' }
		}
		// A rewrite that exceeds the relay's own message cap can't be published
		// or echoed to the sender as-is. Truncating risks handing back a broken
		// sentence or a fragment the service never actually returned — verifying
		// a truncated cut would need another round trip, so this blocks instead
		// of guessing at a safe cut point.
		if (publishText.length > MAX_PUBLISH_LENGTH) {
			return { allowed: false, reason: 'moderated', band: 'oversized_rewrite' }
		}
		return { allowed: true, publishText }
	}

	const bandName = typeof band === 'string' ? band : undefined

	// guard_unavailable is the service rejecting because its own model was
	// unavailable, not because the message was bad — the player must not be
	// told they broke a rule.
	if (bandName === 'rate_limited') return { allowed: false, reason: 'rate_limited' }
	if (bandName === 'guard_unavailable')
		return { allowed: false, reason: 'unavailable' }
	return { allowed: false, reason: 'moderated', band: bandName }
}
