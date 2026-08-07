import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { canConsume, consume, newBucket, refill } from './rate-limit.js'
import type { RateLimitConfig, TokenBucket } from './types.js'

const CFG: RateLimitConfig = { burst: 5, refillPerSec: 0.5 } // 1 token / 2s

describe('token bucket — unit', () => {
	it('starts full', () => {
		expect(newBucket(CFG, 1000).tokens).toBe(5)
	})

	it('allows a burst of `burst` then rejects', () => {
		let bucket = newBucket(CFG, 0)
		for (let i = 0; i < 5; i++) {
			const r = consume(bucket, CFG, 0)
			expect(r.allowed).toBe(true)
			if (r.allowed) bucket = r.bucket
		}
		const sixth = consume(bucket, CFG, 0)
		expect(sixth.allowed).toBe(false)
		if (!sixth.allowed) expect(sixth.retryAfterMs).toBe(2000) // 1 token at 0.5/s
	})

	it('refills one token after the refill interval', () => {
		let bucket = newBucket(CFG, 0)
		for (let i = 0; i < 5; i++) {
			const r = consume(bucket, CFG, 0)
			if (r.allowed) bucket = r.bucket
		}
		const after = consume(bucket, CFG, 2000) // +1 token
		expect(after.allowed).toBe(true)
	})

	it('does not exceed burst no matter how long idle', () => {
		const bucket = refill(newBucket(CFG, 0), CFG, 10_000_000)
		expect(bucket.tokens).toBe(5)
	})

	it('does not gain tokens from a backwards clock', () => {
		const b = refill({ tokens: 2, lastRefillMs: 1000 }, CFG, 500)
		expect(b.tokens).toBe(2)
	})

	it('never moves lastRefillMs backwards, even when nowMs is stale (regression)', () => {
		const stale = refill({ tokens: 2, lastRefillMs: 1000 }, CFG, 500)
		expect(stale.lastRefillMs).toBe(1000) // NOT rewound to 500
		const equal = refill({ tokens: 2, lastRefillMs: 1000 }, CFG, 1000)
		expect(equal.lastRefillMs).toBe(1000)
	})

	it('a late-resuming request with a stale nowMs cannot rewind the bucket and re-grant tokens to a later request (regression)', () => {
		const cfg: RateLimitConfig = { burst: 1, refillPerSec: 0.5 } // 1 token / 2000ms
		// t=0: full bucket, one token available.
		let bucket = newBucket(cfg, 0)
		// A slow request captures started=0, then (conceptually) awaits a ~5s
		// guard judgement before it ever calls consume.
		const slowRequestStarted = 0

		// A concurrent, faster request for the SAME player arrives at t=100 and
		// legitimately spends the only token before the slow request resumes.
		const fast = consume(bucket, cfg, 100)
		expect(fast.allowed).toBe(true)
		bucket = fast.bucket
		expect(bucket).toEqual({ tokens: 0, lastRefillMs: 100 })

		// The slow request now resumes and consumes using its STALE started=0,
		// which is behind the bucket's real lastRefillMs=100.
		const slow = consume(bucket, cfg, slowRequestStarted)
		expect(slow.allowed).toBe(false) // correctly still rate-limited
		bucket = slow.bucket
		expect(bucket.lastRefillMs).toBe(100) // must not rewind to 0

		// A later request at t=2050 — only 1950ms after the REAL last refill
		// (t=100) — must still be rejected: a full token needs 2000ms. A
		// rewound lastRefillMs=0 would instead see 2050ms elapsed and wrongly
		// re-grant a token.
		const tooEarly = consume(bucket, cfg, 2050)
		expect(tooEarly.allowed).toBe(false)

		// Once a full interval has genuinely elapsed since the real last
		// refill, a token is available again.
		const afterRealInterval = consume(bucket, cfg, 2101)
		expect(afterRealInterval.allowed).toBe(true)
	})
})

describe('token bucket — properties', () => {
	const arbConfig = fc.record({
		burst: fc.integer({ min: 1, max: 50 }),
		refillPerSec: fc.double({ min: 0.01, max: 100, noNaN: true }),
	})

	it('tokens stay within [0, burst] across arbitrary consume sequences', () => {
		fc.assert(
			fc.property(
				arbConfig,
				fc.array(fc.nat({ max: 100_000 }), { minLength: 1, maxLength: 50 }),
				(cfg, deltas) => {
					let bucket = newBucket(cfg, 0)
					let t = 0
					for (const d of deltas) {
						t += d
						const r = consume(bucket, cfg, t)
						bucket = r.bucket
						expect(bucket.tokens).toBeGreaterThanOrEqual(0)
						expect(bucket.tokens).toBeLessThanOrEqual(cfg.burst)
					}
				},
			),
		)
	})

	it('retryAfterMs is positive whenever a consume is rejected', () => {
		fc.assert(
			fc.property(arbConfig, fc.nat({ max: 1_000_000 }), (cfg, t) => {
				const empty = { tokens: 0, lastRefillMs: t }
				const r = consume(empty, cfg, t)
				if (!r.allowed) expect(r.retryAfterMs).toBeGreaterThan(0)
			}),
		)
	})
})

describe('canConsume — pure peek', () => {
	it('full bucket -> true', () => {
		expect(canConsume(newBucket(CFG, 1000), CFG, 1000)).toBe(true)
	})

	it('empty bucket at the same instant -> false', () => {
		expect(canConsume({ tokens: 0, lastRefillMs: 1000 }, CFG, 1000)).toBe(false)
	})

	it('empty bucket +2000ms (0.5 tok/s) -> true', () => {
		expect(canConsume({ tokens: 0, lastRefillMs: 1000 }, CFG, 3000)).toBe(true)
	})

	const arbConfig = fc.record({
		burst: fc.integer({ min: 1, max: 50 }),
		refillPerSec: fc.double({ min: 0.01, max: 100, noNaN: true }),
	})
	const arbBucket = fc.record({
		tokens: fc.double({ min: 0, max: 5, noNaN: true }),
		lastRefillMs: fc.nat({ max: 1_000_000 }),
	})

	it('AGREEMENT: canConsume(b,c,n) === consume(b,c,n).allowed', () => {
		fc.assert(
			fc.property(
				arbBucket,
				arbConfig,
				fc.nat({ max: 2_000_000 }),
				(bucket, cfg, nowMs) => {
					expect(canConsume(bucket, cfg, nowMs)).toBe(
						consume(bucket, cfg, nowMs).allowed,
					)
				},
			),
		)
	})

	it('NO MUTATION: leaves the input bucket and the world unchanged', () => {
		fc.assert(
			fc.property(
				arbBucket,
				arbConfig,
				fc.nat({ max: 2_000_000 }),
				(bucket, cfg, nowMs) => {
					const before = { ...bucket }
					canConsume(bucket, cfg, nowMs)
					expect(bucket).toEqual(before)
				},
			),
		)
		// 100 consecutive peeks on a full bucket must not drift its consumability.
		const full = newBucket(CFG, 0)
		for (let i = 0; i < 100; i++) canConsume(full, CFG, 0)
		expect(consume(full, CFG, 0).allowed).toBe(true)
	})

	it('MONOTONICITY: a bucket with <= tokens and >= lastRefillMs can only be as consumable', () => {
		fc.assert(
			fc.property(
				arbBucket,
				arbConfig,
				fc.nat({ max: 2_000_000 }),
				fc.double({ min: 0, max: 5, noNaN: true }),
				fc.nat({ max: 2_000_000 }),
				(b1, cfg, nowMs, tokenDelta, refillDelta) => {
					const b2: TokenBucket = {
						tokens: Math.max(0, b1.tokens - tokenDelta),
						lastRefillMs: b1.lastRefillMs + refillDelta,
					}
					if (!canConsume(b1, cfg, nowMs)) {
						expect(canConsume(b2, cfg, nowMs)).toBe(false)
					}
				},
			),
		)
	})
})
