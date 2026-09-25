// --- Rate limiting ---

/**
 * Token bucket state, carried as plain data so the decision core stays pure.
 * `tokens` is the current fill; `lastRefillMs` is when it was last computed.
 */
export type TokenBucket = {
	tokens: number
	lastRefillMs: number
}

export type RateLimitConfig = {
	/** Maximum tokens (burst size). */
	burst: number
	/** Tokens regenerated per second. */
	refillPerSec: number
}

// --- Moderation policy ---

export type ModerationPolicy = {
	/**
	 * Shadow mode: when true, a guard-block decision is downgraded to `review`
	 * (published) and the verdict records `wouldHaveBlocked`. Deterministic
	 * blocklist/denylist rejections are unaffected — they enforce from day one.
	 */
	shadowMode: boolean
	/**
	 * Wall-clock budget for the guard judgement inside /moderate. When the
	 * judgement doesn't land in time the shell passes `{skipped: 'deadline'}`
	 * and the decision FAILS CLOSED: no verdict, no publish — the message is
	 * rejected with band `guard_unavailable` (owner's rule: nothing unjudged
	 * ever appears in chat). 0/negative = wait indefinitely.
	 */
	guardDeadlineMs: number
	/**
	 * Cap (in characters) on the input fed to the guard, applied per
	 * normalization variant. Toxic signal appears early and the server already
	 * bounds a message at 2000 chars, so judging a long wall of text end-to-end
	 * is pure cost and an easy abuse vector (paste text to inflate LLM cost).
	 * Only the guard input is capped; the deterministic tiers (obscenity,
	 * denylist, PII/contact) still scan the FULL message, so nothing that
	 * must-never-be-missed is affected. Omit / `0` / negative = no cap.
	 */
	scoreMaxChars?: number
}

// --- Guard input ---

/**
 * The rank-based guard's assessment of the message, as plain data (the engine lives in
 * the shell; the decision core never sees the model). `unknown` = the model
 * answered with something unparseable — treated like `Controversial`
 * (publish + human review), never like `Safe`.
 */
export type GuardSafetyLevel = 'Safe' | 'Unsafe' | 'Controversial' | 'unknown'

/**
 * The guard's contribution to a decision. `{skipped}` records WHY no
 * judgement exists (deadline, engine down, backlog, rate-limited before
 * judging, a cheaper deterministic tier already decided, ...) — the decision
 * then fails CLOSED (band `guard_unavailable`, nothing published). There is
 * deliberately no bare `null` variant: every caller that skips judging must
 * say why, so `decideModeration`'s fail-closed branch always sees a
 * `{skipped}` marker instead of silently falling through to `allow`.
 *
 * `categories` was dropped (Track B, single-score classifier): confirmed no
 * enforcement logic anywhere branches on the specific harm category, only on
 * `safety` — categorization is now a human task during admin review of
 * blocked messages, not a model output. `score`/`contextUsed` are optional
 * pass-through audit fields from the score-based guard (the older
 * text-generating guard doesn't populate them) for that future admin surface.
 */
export type GuardInput =
	| { safety: GuardSafetyLevel; score?: number; contextUsed?: boolean }
	| { skipped: string }

// --- Safety input (PII / contact-exchange tier, ws08) ---

/**
 * A deterministic safety finding, adapted from the safety module's matches.
 * `red` rejects the message outright; `orange` forces at least a review band.
 */
export type SafetySignal = {
	severity: 'red' | 'orange'
	kind: string
}

// --- Decision output ---

export type Band =
	| 'preset'
	| 'threat_block'
	| 'blocklist'
	| 'safety_block'
	| 'guard_block'
	| 'guard_unavailable'
	| 'review'
	| 'clean'

export type MatchRecord = {
	word: string
	startIndex: number
	endIndex: number
}

/**
 * The pure decision core's per-message verdict. There is no database on this
 * branch (verdict-only, docs/13) — the shell (service.ts) reads a handful of
 * these fields into the content-free JSONL line handed to `onVerdict`; this
 * type itself is never serialized wholesale.
 */
export type VerdictJson = {
	v: 2
	band: Band
	allowlisted: boolean
	threatMatches?: MatchRecord[]
	obscenityMatches?: MatchRecord[]
	safetySignals?: SafetySignal[]
	guardSafety?: GuardSafetyLevel
	guardScore?: number
	guardContextUsed?: boolean
	guardSkipped?: string
	wouldHaveBlocked?: boolean
}

export type Decision = {
	decision: 'allow' | 'reject'
	band: Band
	verdict: VerdictJson
}

export type DecisionInput = {
	message: string
	nowMs: number
	isAllowlisted: boolean
	threatMatches: MatchRecord[]
	obscenityMatches: MatchRecord[]
	safetySignals: SafetySignal[]
	guard: GuardInput
	policy: ModerationPolicy
}
