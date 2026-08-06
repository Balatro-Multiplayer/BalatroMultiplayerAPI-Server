import { consume } from './rate-limit.js'
import type {
	Band,
	Decision,
	DecisionInput,
	GuardInput,
	GuardSafetyLevel,
	VerdictJson,
} from './types.js'

const GUARD_SAFETY_LEVELS: readonly GuardSafetyLevel[] = [
	'Safe',
	'Unsafe',
	'Controversial',
	'unknown',
]

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

/**
 * True only for a guard verdict this function can actually reason about. Key
 * presence is not enough: `{safety: undefined}` would pass `'safety' in guard`
 * and then fall to the review branch, publishing an unjudged message. Anything
 * failing this check reaches the fail-closed floor instead.
 */
function isGuardVerdict(
	guard: GuardInput | undefined,
): guard is { safety: GuardSafetyLevel; categories: string[] } {
	if (!isObject(guard)) return false
	const { safety, categories } = guard as Record<string, unknown>
	return (
		GUARD_SAFETY_LEVELS.includes(safety as GuardSafetyLevel) &&
		Array.isArray(categories) &&
		categories.every((c) => typeof c === 'string')
	)
}

// The pure moderation decision. Total (never throws), clock/guard injected as
// data. Precedence: rate-limited > threat > preset > blocklist > safety >
// guard-block > review > clean.

export function decideModeration(input: DecisionInput): Decision {
	const {
		nowMs,
		isAllowlisted,
		threatMatches,
		obscenityMatches,
		safetySignals,
		guard,
		policy,
	} = input

	const base = (band: Band, extra: Partial<VerdictJson>): VerdictJson => ({
		v: 2,
		band,
		allowlisted: isAllowlisted,
		...extra,
	})

	// 1. Rate limit.
	const consumed = consume(input.bucket, policy.rateLimit, nowMs)
	if (!consumed.allowed) {
		return {
			decision: 'reject',
			band: 'rate_limited',
			verdict: base('rate_limited', { rateLimited: true }),
			newBucket: consumed.bucket,
			retryAfterMs: consumed.retryAfterMs,
		}
	}
	const newBucket = consumed.bucket

	// 2. Deterministic violent-threat tier (2026-07-09). A violence verb aimed at
	// a person/family target hard-blocks BEFORE the allowlist and the guard: the
	// 0.6B guard is fuzzy at the threat boundary (measured — it rated "i will
	// execute your family" and "i will fucking kill you" Safe), so this floor is
	// human-written, target-gated (0 FP over 5,884 benign messages), and enforces
	// even in shadow mode. A human still reviews the block.
	if (threatMatches.length > 0) {
		return {
			decision: 'reject',
			band: 'threat_block',
			verdict: base('threat_block', { threatMatches }),
			newBucket,
		}
	}

	// 3. Preset / allowlist fast-pass — skips all content checks.
	if (isAllowlisted) {
		return {
			decision: 'allow',
			band: 'preset',
			verdict: base('preset', {}),
			newBucket,
		}
	}

	// 4. Deterministic blocklist (obscenity + denylist matches, computed by shell).
	if (obscenityMatches.length > 0) {
		return {
			decision: 'reject',
			band: 'blocklist',
			verdict: base('blocklist', { obscenityMatches }),
			newBucket,
		}
	}

	// 5. Deterministic safety tier (PII / contact-exchange / doxxing, ADR-8).
	// Red rejects outright (policy violation, not abuse — reviewed, not struck);
	// orange forces at least a review band further down.
	const redSafety = safetySignals.filter((s) => s.severity === 'red')
	if (redSafety.length > 0) {
		return {
			decision: 'reject',
			band: 'safety_block',
			verdict: base('safety_block', { safetySignals }),
			newBucket,
		}
	}
	const hasOrangeSafety = safetySignals.length > 0
	const safetyExtra = hasOrangeSafety ? { safetySignals } : {}

	// 6. Guard tier — the ONLY model. Unsafe blocks (or shadows to review),
	// Controversial/unparseable publishes with human review, Safe publishes.
	if (isGuardVerdict(guard)) {
		const guardExtra = {
			guardSafety: guard.safety,
			guardCategories: guard.categories,
		}
		if (guard.safety === 'Unsafe') {
			if (policy.shadowMode) {
				// Shadow mode: would-block becomes review (published + logged).
				return {
					decision: 'allow',
					band: 'review',
					verdict: base('review', {
						...guardExtra,
						wouldHaveBlocked: true,
						...safetyExtra,
					}),
					newBucket,
				}
			}
			return {
				decision: 'reject',
				band: 'guard_block',
				verdict: base('guard_block', { ...guardExtra, ...safetyExtra }),
				newBucket,
			}
		}

		// Review: Controversial / unparseable guard output, or an orange safety
		// signal — publishes either way, but a human sees it. `unknown` (the
		// model said something unparseable) must never widen to Safe.
		if (guard.safety !== 'Safe' || hasOrangeSafety) {
			return {
				decision: 'allow',
				band: 'review',
				verdict: base('review', { ...guardExtra, ...safetyExtra }),
				newBucket,
			}
		}

		return {
			decision: 'allow',
			band: 'clean',
			verdict: base('clean', guardExtra),
			newBucket,
		}
	}

	// 7. No usable guard verdict — the shell deliberately skipped judging
	// ({skipped: reason}: rate-limited before judging, a cheaper deterministic
	// tier already decided, deadline, backlog, engine down, ...) or (should be
	// impossible — GuardInput has no bare-null variant) guard is nullish.
	// FAIL CLOSED UNCONDITIONALLY (owner's rule: nothing unjudged is ever
	// published): there is no further "a tier above must already have handled
	// it" fallback — if guard isn't a real verdict, this is the floor, never a
	// silent allow.
	const guardSkipped =
		isObject(guard) && 'skipped' in guard && typeof guard.skipped === 'string'
			? guard.skipped
			: 'guard_missing'
	// The token stays spent. Refunding it here would uncap retries during a
	// guard outage — every retry re-enters the lane, deepening the backlog that
	// caused the outage, and one player can then drain the global admission
	// bucket and shed everyone else's clean messages.
	return {
		decision: 'reject',
		band: 'guard_unavailable',
		verdict: base('guard_unavailable', { guardSkipped, ...safetyExtra }),
		newBucket,
		retryAfterMs: policy.guardRetryAfterMs,
	}
}

export type { Decision, DecisionInput } from './types.js'
export type { GuardInput } from './types.js'
