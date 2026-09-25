import { consume, newBucket } from '../pipeline/rate-limit.js'
import type { RateLimitConfig, TokenBucket } from '../pipeline/types.js'

// Admission control for the service as a whole (ADR-7): a GLOBAL ingress
// bucket (separate from per-player chat buckets) so a raid or a misbehaving
// relay can't drive the service into unbounded work. Pure math + one stateful
// wrapper; the future LLM slow lane adds its own queue cap on top of this.

export const DEFAULT_GLOBAL_INGRESS: RateLimitConfig = {
	// Generous vs the measured ~0.3 msg/s average: bursts of 50, sustained 25/s.
	burst: 50,
	refillPerSec: 25,
}

export type AdmissionController = {
	/** True = admit; false = shed (relay maps this to 429/presets). */
	admit(nowMs: number): boolean
}

export function createAdmissionController(
	config: RateLimitConfig = DEFAULT_GLOBAL_INGRESS,
	nowMs = 0,
): AdmissionController {
	let bucket: TokenBucket = newBucket(config, nowMs)
	return {
		admit(now: number): boolean {
			const result = consume(bucket, config, now)
			bucket = result.bucket
			return result.allowed
		},
	}
}
