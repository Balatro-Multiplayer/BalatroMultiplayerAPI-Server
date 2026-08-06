import type { RateLimitConfig, TokenBucket } from './types.js'

// Pure token-bucket math. No clock of its own — `nowMs` is always passed in.

/** A full bucket at time `nowMs`. */
export function newBucket(config: RateLimitConfig, nowMs: number): TokenBucket {
	return { tokens: config.burst, lastRefillMs: nowMs }
}

/**
 * Refills a bucket up to `nowMs` without consuming. Clamps to [0, burst] and
 * never moves `lastRefillMs` backwards: a stale `nowMs <= lastRefillMs`
 * returns the bucket UNCHANGED (no gained tokens, no rewritten timestamp).
 * This matters beyond clock skew — a caller that captures `nowMs` before an
 * await and writes the bucket back after (e.g. a rate-limit peek held across
 * a slow guard judgement) must not rewind a timestamp a concurrent, later
 * writer already advanced; doing so would let a subsequent request compute
 * elapsed time from the rewound point and re-gain tokens nobody earned.
 */
export function refill(
	bucket: TokenBucket,
	config: RateLimitConfig,
	nowMs: number,
): TokenBucket {
	if (nowMs <= bucket.lastRefillMs) return bucket
	const elapsedMs = nowMs - bucket.lastRefillMs
	const gained = (elapsedMs / 1000) * config.refillPerSec
	const tokens = Math.min(config.burst, bucket.tokens + gained)
	return { tokens, lastRefillMs: nowMs }
}

/**
 * PURE PEEK: would `consume` succeed right now? Returns a boolean and NOTHING
 * else — deliberately no bucket — so a caller physically cannot spend a token
 * with it. `decideModeration`'s internal `consume` call stays the ONE place a
 * token is ever spent.
 * Invariant (property-tested): canConsume(b,c,n) === consume(b,c,n).allowed.
 */
export function canConsume(
	bucket: TokenBucket,
	config: RateLimitConfig,
	nowMs: number,
): boolean {
	return refill(bucket, config, nowMs).tokens >= 1
}

export type ConsumeResult =
	| { allowed: true; bucket: TokenBucket }
	| { allowed: false; bucket: TokenBucket; retryAfterMs: number }

/**
 * Refills then attempts to consume one token. On success the bucket loses a
 * token; on failure the bucket is unchanged (except the refill timestamp) and
 * `retryAfterMs` says how long until one token is available.
 */
export function consume(
	bucket: TokenBucket,
	config: RateLimitConfig,
	nowMs: number,
): ConsumeResult {
	const refilled = refill(bucket, config, nowMs)
	if (refilled.tokens >= 1) {
		return {
			allowed: true,
			bucket: { ...refilled, tokens: refilled.tokens - 1 },
		}
	}
	const deficit = 1 - refilled.tokens
	const retryAfterMs = Math.ceil((deficit / config.refillPerSec) * 1000)
	return { allowed: false, bucket: refilled, retryAfterMs }
}
