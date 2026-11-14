// A seeded StepContext for tests: the clock is `now`, and the random, id and
// seed sources are deterministic, so a run replays exactly.
import type { StepContext } from '../actions/registry'

export function testContext(now: number, seed = 1): StepContext {
	let state = seed >>> 0
	let ids = 0
	let seeds = 0
	return {
		now,
		// mulberry32
		random: () => {
			state = (state + 0x6d2b79f5) >>> 0
			let t = state
			t = Math.imul(t ^ (t >>> 15), t | 1)
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296
		},
		newId: () => `id-${++ids}`,
		newSeed: () => `SEED${++seeds}`,
	}
}
