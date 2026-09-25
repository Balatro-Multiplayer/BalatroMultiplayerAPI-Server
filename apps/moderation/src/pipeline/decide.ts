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
): guard is { safety: GuardSafetyLevel; score?: number; contextUsed?: boolean } {
	if (!isObject(guard)) return false
	const { safety, score, contextUsed } = guard as Record<string, unknown>
	return (
		GUARD_SAFETY_LEVELS.includes(safety as GuardSafetyLevel) &&
		(score === undefined || typeof score === 'number') &&
		(contextUsed === undefined || typeof contextUsed === 'boolean')
	)
}

// The pure moderation decision. Total (never throws), clock/guard injected as
// data. Precedence: threat > preset > blocklist > safety > guard-block >
// review > clean.
//
// Per-player rate limiting deliberately does NOT live here: the relay's chat
// route already limits each player to the same budget before this service is
// called, so a second identical bucket only duplicated it — and it was the
// service's only per-player state. Overload is handled where it belongs, by
// the global ingress valve (service/admission.ts) and the guard lane's own
// backlog/deadline shedding.

export function decideModeration(input: DecisionInput): Decision {
	const {
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

	// 1. Deterministic violent-threat tier (2026-07-09). A violence verb aimed at
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
		}
	}

	// 2. Preset / allowlist fast-pass — skips all content checks.
	if (isAllowlisted) {
		return {
			decision: 'allow',
			band: 'preset',
			verdict: base('preset', {}),
		}
	}

	// 3. Deterministic blocklist (obscenity + denylist matches, computed by shell).
	if (obscenityMatches.length > 0) {
		return {
			decision: 'reject',
			band: 'blocklist',
			verdict: base('blocklist', { obscenityMatches }),
		}
	}

	// 4. Deterministic safety tier (PII / contact-exchange / doxxing, ADR-8).
	// Red rejects outright (policy violation, not abuse — reviewed, not struck);
	// orange forces at least a review band further down.
	const redSafety = safetySignals.filter((s) => s.severity === 'red')
	if (redSafety.length > 0) {
		return {
			decision: 'reject',
			band: 'safety_block',
			verdict: base('safety_block', { safetySignals }),
		}
	}
	const hasOrangeSafety = safetySignals.length > 0
	const safetyExtra = hasOrangeSafety ? { safetySignals } : {}

	// 5. Guard tier — the ONLY model. Unsafe blocks (or shadows to review),
	// Controversial/unparseable publishes with human review, Safe publishes.
	if (isGuardVerdict(guard)) {
		const guardExtra = {
			guardSafety: guard.safety,
			...(guard.score !== undefined ? { guardScore: guard.score } : {}),
			...(guard.contextUsed !== undefined
				? { guardContextUsed: guard.contextUsed }
				: {}),
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
				}
			}
			return {
				decision: 'reject',
				band: 'guard_block',
				verdict: base('guard_block', { ...guardExtra, ...safetyExtra }),
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
			}
		}

		return {
			decision: 'allow',
			band: 'clean',
			verdict: base('clean', guardExtra),
		}
	}

	// 6. No usable guard verdict — the shell deliberately skipped judging
	// ({skipped: reason}: rate-limited before judging, a cheaper deterministic
	// tier already decided, deadline, backlog, engine down, ...) or (should be
	// impossible — GuardInput has no bare-null variant) guard is nullish.
	// FAIL CLOSED when enforcing (owner's rule: nothing unjudged is ever
	// published) and, in shadow mode, for everything except an absent engine
	// (see below): there is no further "a tier above must already have handled
	// it" fallback — if guard isn't a real verdict, this is the floor, never a
	// silent allow.
	const guardSkipped =
		isObject(guard) && 'skipped' in guard && typeof guard.skipped === 'string'
			? guard.skipped
			: 'guard_missing'
	// FAIL CLOSED, except for a guard that is not merely late but ABSENT while in
	// shadow mode. The distinction is whether a retry could ever succeed:
	//
	//   deadline / backlog — the model works, this message just wasn't judged
	//     in time. Self-correcting: the player retries and it goes through.
	//     Fail-closed here is real protection during a spike and costs one
	//     retry, so it stays even in shadow mode.
	//   engine_not_ready — no model file, still loading, or the load failed.
	//     Nothing will change until an operator acts, so fail-closed is not a
	//     brief refusal, it is chat permanently dead and indistinguishable
	//     from "this feature is broken".
	//
	// In shadow mode the guard has no enforcement power by definition — a
	// verdict of Unsafe publishes (as 'review', above) — so refusing when it
	// cannot answer at all is strictly harsher than the case where it DID
	// object. Allowing grants no exposure this mode has not already granted.
	// The deterministic tiers (links, rate limit, threats, blocklist,
	// PII/contact) all decided BEFORE this point and still enforce.
	if (policy.shadowMode && guardSkipped === 'engine_not_ready') {
		return {
			decision: 'allow',
			band: 'review',
			// guardSkipped carries the reason ('engine_not_ready'), so the log
			// still shows the model did not judge this — never a silent allow.
			verdict: base('review', { guardSkipped, ...safetyExtra }),
		}
	}

	return {
		decision: 'reject',
		band: 'guard_unavailable',
		verdict: base('guard_unavailable', { guardSkipped, ...safetyExtra }),
	}
}

export type { Decision, DecisionInput } from './types.js'
export type { GuardInput } from './types.js'
