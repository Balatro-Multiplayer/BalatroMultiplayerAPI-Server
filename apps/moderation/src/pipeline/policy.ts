import type { ModerationPolicy } from './types.js'

/**
 * Default policy (ADR-5, revised: Qwen3Guard is the only model — toxic-bert
 * and its per-label thresholds are gone). The guard's three-way verdict maps
 * directly: Unsafe blocks, Controversial/unparseable goes to review, Safe
 * publishes. Deterministic tiers (allowlist, blocklist/denylist, PII) decide
 * before the guard ever runs and are unaffected by shadow mode.
 *
 * Ships with shadowMode ON: guard-blocks are logged as would-block and
 * published, until the verdict quality is confirmed on live traffic (ADR-4).
 */
export const DEFAULT_POLICY: ModerationPolicy = {
	rateLimit: { burst: 5, refillPerSec: 0.5 },
	shadowMode: true,
	// Real-traffic reconstruction (685 days of queue transcripts): p99.9 load
	// ≈0.8 msg/s and the worst minute ever ≈7.2 msg/s. Judgements that can't
	// land inside the deadline FAIL CLOSED (reject + retry hint) — nothing
	// unjudged is ever published; the shell also rejects early when the lane's
	// backlog already guarantees a miss, so overload feels instant, not slow.
	guardDeadlineMs: 5000,
	guardRetryAfterMs: 2000,
	// Judge the first 400 chars per variant. Real chat messages are well under
	// this (BMP median is a handful of words); it only bites the long-message
	// tail the load test flagged as the dominant model cost. Tunable via DB later.
	scoreMaxChars: 400,
}
