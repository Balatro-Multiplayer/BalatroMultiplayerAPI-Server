// Puts entrants in seed order before a bracket is built.
import { type Result, err, ok } from '../../shared/result'
import type { EngineError, EntrantId } from './types'

export interface SeedingEntrant {
	id: EntrantId
	// Rating on the board the organiser picked; null/undefined = unrated.
	rating?: number | null
}

export type SeedingKind = 'rating' | 'random' | 'manual'

// A random number in [0, 1). Injected so seeding and tests are repeatable.
export type Rng = () => number

// Small seeded generator (mulberry32) for repeatable random seeding.
export function seededRng(seed: number): Rng {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

export function shuffle<T>(items: T[], rng: Rng): T[] {
	const out = items.slice()
	for (let i = out.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1))
		const tmp = out[i]
		out[i] = out[j]
		out[j] = tmp
	}
	return out
}

// Entrants in seed order (seed 1 first).
// rating: highest rating first; unrated entrants after every rated one; ties
// keep sign-up order. random: shuffled with rng. manual: `order` must list
// every entrant exactly once.
export function seedEntrants(
	entrants: SeedingEntrant[],
	kind: SeedingKind,
	options: { rng?: Rng; order?: EntrantId[] } = {},
): Result<EntrantId[], EngineError> {
	const ids = entrants.map((e) => e.id)
	if (new Set(ids).size !== ids.length) {
		return err({ code: 'invalid', message: 'Entrants must be unique' })
	}
	if (kind === 'rating') {
		const indexed = entrants.map((e, index) => ({ e, index }))
		indexed.sort((a, b) => {
			const ra = typeof a.e.rating === 'number' ? a.e.rating : null
			const rb = typeof b.e.rating === 'number' ? b.e.rating : null
			if (ra !== null && rb !== null && ra !== rb) return rb - ra
			if (ra !== null && rb === null) return -1
			if (ra === null && rb !== null) return 1
			return a.index - b.index
		})
		return ok(indexed.map((x) => x.e.id))
	}
	if (kind === 'random') {
		if (!options.rng) return err({ code: 'invalid', message: 'Random seeding needs an rng' })
		return ok(shuffle(ids, options.rng))
	}
	const order = options.order
	if (!order) return err({ code: 'invalid', message: 'Manual seeding needs an order' })
	const known = new Set(ids)
	const seen = new Set<EntrantId>()
	for (const id of order) {
		if (!known.has(id)) return err({ code: 'invalid', message: `Unknown entrant in seeding: ${id}` })
		if (seen.has(id)) return err({ code: 'invalid', message: `Entrant seeded twice: ${id}` })
		seen.add(id)
	}
	if (seen.size !== known.size) {
		return err({ code: 'invalid', message: 'Manual seeding must list every entrant' })
	}
	return ok(order.slice())
}
