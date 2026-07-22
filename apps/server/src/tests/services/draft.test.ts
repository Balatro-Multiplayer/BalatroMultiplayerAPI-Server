// Draft feature tests: generator invariants (property-style over seeded PRNG --
// no fast-check dep because the lockfile is in flight) and service idempotency.

import { beforeEach, describe, expect, it } from 'vitest'
import { DECK, STAKE } from '../../features/draft/draft-constants.js'
import {
	ForbiddenError,
	NotFoundError,
	ValidationError,
} from '../../shared/utils/errors.js'
import {
	COCKTAIL_ELIGIBLE_DECKS,
	type DraftPolicy,
	getDraftPolicy,
} from '../../features/draft/draft-policy.js'
import { InMemoryDraftRepository } from '../../features/draft/draft.repository.js'
import {
	type DraftMatchInfo,
	makeDraftService,
} from '../../features/draft/draft.service.js'
import {
	type Rng,
	generateDraftPool,
} from '../../features/draft/generate-draft-pool.js'

// Deterministic PRNG (mulberry32) so every "property" run is reproducible.
function mulberry32(seed: number): Rng {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

const RANKED = getDraftPolicy(
	'MultiplayerPvP',
	'ranked:pvp_standard',
) as DraftPolicy

describe('draft policy seeds', () => {
	it('covers ranked and casual pvp queues (mod-wide default), not other mods', () => {
		for (const mode of [
			'pvp_standard',
			'pvp_expanded',
			'pvp_vanilla',
			'pvp_smallworld',
		]) {
			expect(getDraftPolicy('MultiplayerPvP', `ranked:${mode}`)).toBeDefined()
			expect(getDraftPolicy('MultiplayerPvP', mode)).toBeDefined()
		}
		expect(
			getDraftPolicy('MultiplayerSPDRN', 'white_stake_triple'),
		).toBeUndefined()
	})

	it('keeps the cocktail-only decks out of the policy entirely -- they only exist in the cocktail-eligibility allowlist', () => {
		const byKey = new Map(RANKED.decks.map((d) => [d.key, d]))
		for (const key of [
			DECK.INDIGO,
			DECK.GRADIENT,
			DECK.ORACLE,
			DECK.HEIDELBERG,
			DECK.ECHO,
		]) {
			expect(byKey.has(key)).toBe(false)
		}
		expect(byKey.get(DECK.COCKTAIL)?.draftWeight).toBe(1)
	})

	it('COCKTAIL_ELIGIBLE_DECKS is the single explicit allowlist: every deck except the cocktail itself', () => {
		const eligible = new Set(COCKTAIL_ELIGIBLE_DECKS)
		expect(eligible.size).toBe(COCKTAIL_ELIGIBLE_DECKS.length)
		for (const key of Object.values(DECK)) {
			if (key === DECK.COCKTAIL) {
				expect(eligible.has(key)).toBe(false)
			} else {
				expect(eligible.has(key)).toBe(true)
			}
		}
	})
})

describe('generateDraftPool invariants (300 seeded runs)', () => {
	const draftable = new Set(
		RANKED.decks.filter((d) => d.draftWeight > 0).map((d) => d.key),
	)
	const stakeIds = new Set(RANKED.stakes.map((s) => s.id))

	it('holds every Botlatro invariant on every run', () => {
		for (let seed = 1; seed <= 300; seed++) {
			const pool = generateDraftPool(RANKED, mulberry32(seed))

			expect(pool).toHaveLength(RANKED.poolSize)

			const stakeCounts = new Map<number, number>()
			const deckCounts = new Map<string, number>()
			const pairs = new Set<string>()
			for (const t of pool) {
				expect(draftable.has(t.key)).toBe(true)
				expect(stakeIds.has(t.stake)).toBe(true)
				expect(pairs.has(`${t.key}${t.stake}`)).toBe(false)
				pairs.add(`${t.key}${t.stake}`)
				stakeCounts.set(t.stake, (stakeCounts.get(t.stake) ?? 0) + 1)
				deckCounts.set(t.key, (deckCounts.get(t.key) ?? 0) + 1)
			}
			for (const count of stakeCounts.values())
				expect(count).toBeLessThanOrEqual(RANKED.maxPerStake)
			for (const count of deckCounts.values())
				expect(count).toBeLessThanOrEqual(RANKED.maxPerDeck)

			// White-stake guarantee
			expect(
				pool.some((t) => t.stake === RANKED.guaranteedStakes[0].stakeId),
			).toBe(true)
		}
	})

	it('is deterministic for the same seed', () => {
		expect(generateDraftPool(RANKED, mulberry32(42))).toEqual(
			generateDraftPool(RANKED, mulberry32(42)),
		)
	})

	it('never emits weight-0 decks even under an adversarial rng', () => {
		const excluded = new Set([
			DECK.INDIGO,
			DECK.GRADIENT,
			DECK.ORACLE,
			DECK.HEIDELBERG,
			DECK.ECHO,
		])
		for (const rngValue of [0, 0.5, 0.9999]) {
			const pool = generateDraftPool(RANKED, () => rngValue)
			for (const t of pool) expect(excluded.has(t.key)).toBe(false)
		}
	})

	it('throws up front on infeasible configs', () => {
		const bad: DraftPolicy = { ...RANKED, poolSize: 99 }
		expect(() => generateDraftPool(bad, mulberry32(1))).toThrow(/infeasible/)
	})

	it('a weight-0 guaranteed stake degrades gracefully; overflowing mins are rejected', () => {
		const zeroWhite: DraftPolicy = {
			...RANKED,
			stakes: RANKED.stakes.map((st) =>
				st.id === STAKE.WHITE ? { ...st, weight: 0 } : { ...st },
			),
		}
		expect(generateDraftPool(zeroWhite, mulberry32(1))).toHaveLength(
			RANKED.poolSize,
		)
		// A single min above the per-stake cap is rejected...
		expect(() =>
			generateDraftPool(
				{ ...RANKED, guaranteedStakes: [{ stakeId: STAKE.WHITE, min: 99 }] },
				mulberry32(1),
			),
		).toThrow(/exceeds per-stake cap/)
		// ...and minimums that together overflow the pool (each within cap) too.
		const overflow: DraftPolicy = {
			...RANKED,
			guaranteedStakes: [
				{ stakeId: STAKE.WHITE, min: 4 },
				{ stakeId: STAKE.GREEN, min: 4 },
				{ stakeId: STAKE.BLACK, min: 4 },
			],
		}
		expect(() => generateDraftPool(overflow, mulberry32(1))).toThrow(
			/guaranteed minimums exceed/,
		)
	})

	it('never emits a stake-less tuple on tight policies: retries past a greedy dead-end to a valid pool, never throws', () => {
		// This exact shape passes the aggregate feasibility checks but the greedy
		// ranked fill (matroid intersection over per-stake/per-deck caps) can
		// dead-end short of poolSize on some rankings even though a valid
		// selection always exists (the deck x stake graph is complete). The
		// generator retries with a fresh ranking on a dead-end, so every seed
		// must succeed -- never throw, never emit a corrupt/stake-less tuple.
		const tight: DraftPolicy = {
			poolSize: 6,
			maxPerStake: 2,
			maxPerDeck: 2,
			guaranteedStakes: [],
			decks: [
				{ key: 'a', draftWeight: 1 },
				{ key: 'b', draftWeight: 1 },
				{ key: 'c', draftWeight: 1 },
			],
			stakes: [
				{ id: STAKE.WHITE, weight: 1 },
				{ id: STAKE.GREEN, weight: 1 },
				{ id: STAKE.BLACK, weight: 1 },
			],
		}
		for (let seed = 1; seed <= 300; seed++) {
			const pool = generateDraftPool(tight, mulberry32(seed))
			expect(pool).toHaveLength(6)
			for (const t of pool) {
				expect(Number.isInteger(t.stake)).toBe(true)
				expect(typeof t.key).toBe('string')
			}
		}
	})

	it('policy rows are independent copies, not aliases', () => {
		const a = getDraftPolicy(
			'MultiplayerPvP',
			'ranked:pvp_standard',
		) as DraftPolicy
		const b = getDraftPolicy('MultiplayerPvP', 'pvp_standard') as DraftPolicy
		expect(a).not.toBe(b)
		expect(a.decks[0]).not.toBe(b.decks[0])
	})

	it('weights deck occurrence proportionally: a heavily-weighted deck is drafted far more than a weight-1 deck', () => {
		// Two decks with plenty of stake room so both are always eligible;
		// one deck weighted 10x. Efraimidis-Spirakis picks larger-weight items
		// with priority rng()^(1/w), which skews toward 1 (picked earlier) as w
		// grows, so the heavy deck should be drafted far more often across seeds.
		const heavy: DraftPolicy = {
			poolSize: 4,
			maxPerStake: 4,
			maxPerDeck: 4,
			guaranteedStakes: [],
			decks: [
				{ key: 'heavy', draftWeight: 10 },
				{ key: 'light', draftWeight: 1 },
			],
			stakes: [
				{ id: STAKE.WHITE, weight: 1 },
				{ id: STAKE.GREEN, weight: 1 },
				{ id: STAKE.BLACK, weight: 1 },
				{ id: STAKE.PURPLE, weight: 1 },
			],
		}
		let heavyCount = 0
		let lightCount = 0
		for (let seed = 1; seed <= 500; seed++) {
			const pool = generateDraftPool(heavy, mulberry32(seed))
			for (const t of pool) {
				if (t.key === 'heavy') heavyCount++
				else lightCount++
			}
		}
		expect(heavyCount).toBeGreaterThan(lightCount * 2)
	})

	it('draws each eligible pair with roughly even frequency when all weights are equal', () => {
		const uniform: DraftPolicy = {
			poolSize: 2,
			maxPerStake: 2,
			maxPerDeck: 2,
			guaranteedStakes: [],
			decks: [
				{ key: 'a', draftWeight: 1 },
				{ key: 'b', draftWeight: 1 },
			],
			stakes: [
				{ id: STAKE.WHITE, weight: 1 },
				{ id: STAKE.GREEN, weight: 1 },
			],
		}
		const counts = new Map<string, number>()
		const runs = 800
		for (let seed = 1; seed <= runs; seed++) {
			const pool = generateDraftPool(uniform, mulberry32(seed))
			for (const t of pool) {
				const pairKey = `${t.key}@${t.stake}`
				counts.set(pairKey, (counts.get(pairKey) ?? 0) + 1)
			}
		}
		// 4 distinct pairs, poolSize 2 -> 2*runs tuple-slots total, ~evenly split.
		const totalSlots = runs * uniform.poolSize
		const expectedPerPair = totalSlots / 4
		for (const count of counts.values()) {
			expect(count).toBeGreaterThan(expectedPerPair * 0.5)
			expect(count).toBeLessThan(expectedPerPair * 1.5)
		}
	})
})

describe('draft service', () => {
	const MATCH: DraftMatchInfo = {
		matchId: 'm1',
		modId: 'MultiplayerPvP',
		gameMode: 'ranked:pvp_standard',
		playerIds: ['host', 'guest'],
	}
	let repo: InMemoryDraftRepository
	let service: ReturnType<typeof makeDraftService>

	beforeEach(() => {
		repo = new InMemoryDraftRepository()
		service = makeDraftService({
			repo,
			getMatch: (id) => (id === 'm1' ? MATCH : undefined),
			getPolicy: getDraftPolicy,
			rng: mulberry32(1),
			log: { log: () => {} },
		})
	})

	it('issues a pool once and returns the identical pool on retries', async () => {
		const first = await service.issueDraftPool('m1', 'host')
		const second = await service.issueDraftPool('m1', 'guest')
		expect(first.reused).toBe(false)
		expect(second.reused).toBe(true)
		expect(second.pool).toEqual(first.pool)
	})

	it('rolls exactly once under concurrent first calls (single-flight)', async () => {
		const [a, b] = await Promise.all([
			service.issueDraftPool('m1', 'host'),
			service.issueDraftPool('m1', 'guest'),
		])
		expect(a.pool).toEqual(b.pool)
		expect([a.reused, b.reused].filter((r) => r === false)).toHaveLength(1)
		expect(await repo.getPool('m1')).toEqual(a.pool)
	})

	it('attaches the weekly composition to any cocktail tuple in the pool', async () => {
		// The ranked policy makes b_mp_cocktail draftable, so across a few rolls
		// it will appear; when it does, the pool item must carry decks + a bare
		// name (the client appends its own "Cocktail" suffix).
		let sawCocktail = false
		for (let i = 0; i < 40 && !sawCocktail; i++) {
			const localRepo = new InMemoryDraftRepository()
			const svc = makeDraftService({
				repo: localRepo,
				getMatch: () => MATCH,
				getPolicy: getDraftPolicy,
			})
			const { pool } = await svc.issueDraftPool(`mm${i}`, 'host')
			for (const t of pool) {
				if (t.key === 'b_mp_cocktail') {
					sawCocktail = true
					expect(Array.isArray(t.decks)).toBe(true)
					expect(t.decks!.length).toBeGreaterThan(0)
					expect(typeof t.name).toBe('string')
					// bare name, no "Cocktail" suffix (client owns the wording)
					expect(t.name).not.toMatch(/cocktail/i)
				} else {
					expect(t.decks).toBeUndefined()
				}
			}
		}
		expect(sawCocktail).toBe(true)
	})

	it('rejects non-participants and unknown matches', async () => {
		await expect(service.issueDraftPool('m1', 'stranger')).rejects.toThrow(
			/participant/,
		)
		await expect(
			service.issueDraftPool('m1', 'stranger'),
		).rejects.toBeInstanceOf(ForbiddenError)

		await expect(service.issueDraftPool('nope', 'host')).rejects.toThrow(
			/not found/i,
		)
		await expect(service.issueDraftPool('nope', 'host')).rejects.toBeInstanceOf(
			NotFoundError,
		)
	})

	it('404s when the queue has no policy (client falls back)', async () => {
		const unconfigured = makeDraftService({
			repo,
			getMatch: () => ({
				...MATCH,
				modId: 'MultiplayerSPDRN',
				gameMode: 'white_stake_triple',
			}),
			getPolicy: getDraftPolicy,
		})
		await expect(unconfigured.issueDraftPool('m1', 'host')).rejects.toThrow(
			/No draft policy/,
		)
		await expect(
			unconfigured.issueDraftPool('m1', 'host'),
		).rejects.toBeInstanceOf(NotFoundError)
	})
})

describe('InMemoryDraftRepository TTL eviction', () => {
	it('evicts pools older than the TTL on writes, keeping fresh entries', async () => {
		let now = 0
		const repo = new InMemoryDraftRepository({ ttlMs: 1_000, now: () => now })
		await repo.savePool('old', [{ key: 'b_red', stake: 1 }])
		now = 500
		await repo.savePool('young', [{ key: 'b_blue', stake: 1 }])
		now = 1_001
		await repo.savePool('fresh', [{ key: 'b_green', stake: 1 }])
		expect(await repo.getPool('old')).toBeUndefined()
		expect(await repo.getPool('young')).toBeDefined()
		expect(await repo.getPool('fresh')).toBeDefined()
	})

	it('refreshes the TTL on every write to the same match', async () => {
		let now = 0
		const repo = new InMemoryDraftRepository({ ttlMs: 1_000, now: () => now })
		await repo.savePool('m', [{ key: 'b_red', stake: 1 }])
		now = 900
		await repo.savePool('m', [{ key: 'b_red', stake: 1 }])
		now = 1_800
		await repo.savePool('other', [{ key: 'b_blue', stake: 1 }])
		expect(await repo.getPool('m')).toBeDefined()
	})

	it('never serves an expired entry, even before any sweep runs', async () => {
		let now = 0
		const repo = new InMemoryDraftRepository({ ttlMs: 1_000, now: () => now })
		await repo.savePool('m', [{ key: 'b_red', stake: 1 }])
		now = 2_000
		expect(await repo.getPool('m')).toBeUndefined()
	})
})

describe('weekly cocktail config', () => {
	it('every weekly deck is in COCKTAIL_ELIGIBLE_DECKS', async () => {
		const { getWeeklyCocktail } = await import(
			'../../features/draft/weekly-cocktail.js'
		)
		const weekly = getWeeklyCocktail()
		expect(weekly.decks.length).toBeGreaterThan(0)
		const eligible = new Set(COCKTAIL_ELIGIBLE_DECKS)
		for (const key of weekly.decks) {
			expect(
				eligible.has(key as (typeof COCKTAIL_ELIGIBLE_DECKS)[number]),
			).toBe(true)
		}
	})

	it('accepts a rotation whose decks are all cocktail-eligible', async () => {
		const { validateWeeklyCocktail } = await import(
			'../../features/draft/weekly-cocktail.js'
		)
		const validated = validateWeeklyCocktail({
			name: 'AcceptanceCheck',
			decks: [DECK.HEIDELBERG, DECK.ORACLE, DECK.INDIGO],
		})
		expect(validated.decks).toEqual([DECK.HEIDELBERG, DECK.ORACLE, DECK.INDIGO])
	})

	it('rejects a rotation containing the cocktail deck itself (the only ineligible deck)', async () => {
		const { validateWeeklyCocktail } = await import(
			'../../features/draft/weekly-cocktail.js'
		)
		expect(() =>
			validateWeeklyCocktail({ name: 'X', decks: [DECK.COCKTAIL] }),
		).toThrow(/not cocktail-eligible/)
		expect(() =>
			validateWeeklyCocktail({ name: 'X', decks: [DECK.COCKTAIL] }),
		).toThrow(ValidationError)
	})

	it('accepts Echo -- now cocktail-eligible', async () => {
		const { validateWeeklyCocktail } = await import(
			'../../features/draft/weekly-cocktail.js'
		)
		expect(
			validateWeeklyCocktail({ name: 'X', decks: [DECK.ECHO] }).decks,
		).toEqual([DECK.ECHO])
	})

	it('rotation validates; bad rotations throw and change nothing', async () => {
		const { validateWeeklyCocktail } = await import(
			'../../features/draft/weekly-cocktail.js'
		)

		expect(() =>
			validateWeeklyCocktail({ name: '', decks: [DECK.GREEN] }),
		).toThrow(/name/)
		expect(() =>
			validateWeeklyCocktail({ name: '', decks: [DECK.GREEN] }),
		).toThrow(ValidationError)
		expect(() => validateWeeklyCocktail({ name: 'X', decks: [] })).toThrow(
			/1-3/,
		)
		expect(() =>
			validateWeeklyCocktail({
				name: 'X',
				decks: [DECK.GREEN, DECK.BLACK, DECK.RED, DECK.BLUE],
			}),
		).toThrow(/1-3/)
		expect(() =>
			validateWeeklyCocktail({ name: 'X', decks: [DECK.COCKTAIL] }),
		).toThrow(/not cocktail-eligible/)
		expect(() =>
			validateWeeklyCocktail({ name: 'X', decks: [DECK.GREEN, DECK.GREEN] }),
		).toThrow(/distinct/)
		expect(() =>
			validateWeeklyCocktail({ name: 'X', decks: [DECK.GREEN, DECK.GREEN] }),
		).toThrow(ValidationError)

		const rotated = validateWeeklyCocktail({
			name: 'NextWeek',
			decks: [DECK.GRADIENT, DECK.RED],
		})
		expect(rotated.name).toBe('NextWeek')
		expect(rotated.decks).toEqual([DECK.GRADIENT, DECK.RED])
	})

	it('loadWeeklyCocktail defaults to SEED when no DB row exists', async () => {
		const { getWeeklyCocktail, loadWeeklyCocktail } = await import(
			'../../features/draft/weekly-cocktail.js'
		)
		const fakeFetch = async () => null
		await loadWeeklyCocktail(fakeFetch)
		expect(getWeeklyCocktail()).toEqual({
			name: 'Casjb',
			decks: ['b_green', 'b_black', 'b_mp_orange'],
		})
	})

	it('loadWeeklyCocktail adopts the DB row when one exists', async () => {
		const { getWeeklyCocktail, loadWeeklyCocktail } = await import(
			'../../features/draft/weekly-cocktail.js'
		)
		const dbRow = { name: 'FromDb', decks: [DECK.GRADIENT, DECK.RED] }
		const fakeFetch = async () => dbRow
		await loadWeeklyCocktail(fakeFetch)
		expect(getWeeklyCocktail()).toEqual(dbRow)

		// restore the seed for other tests
		await loadWeeklyCocktail(async () => null)
	})

	it('loadWeeklyCocktail falls back to SEED when the DB fetch throws (never crashes boot)', async () => {
		const { getWeeklyCocktail, loadWeeklyCocktail } = await import(
			'../../features/draft/weekly-cocktail.js'
		)
		const throwingFetch = async () => {
			throw new Error('relation "weekly_cocktail" does not exist')
		}
		await loadWeeklyCocktail(throwingFetch)
		expect(getWeeklyCocktail()).toEqual({
			name: 'Casjb',
			decks: ['b_green', 'b_black', 'b_mp_orange'],
		})
	})

	it('setWeeklyCocktail validates, updates the cache, and writes through save', async () => {
		const { getWeeklyCocktail, setWeeklyCocktail } = await import(
			'../../features/draft/weekly-cocktail.js'
		)
		const before = getWeeklyCocktail()
		const saved: Array<{ name: string; decks: string[] }> = []
		const fakeSave = async (wc: { name: string; decks: string[] }) => {
			saved.push(wc)
		}

		const rotated = await setWeeklyCocktail(
			{ name: 'NextWeek', decks: [DECK.GRADIENT, DECK.RED] },
			fakeSave,
		)
		expect(rotated).toEqual({
			name: 'NextWeek',
			decks: [DECK.GRADIENT, DECK.RED],
		})
		expect(saved).toEqual([
			{ name: 'NextWeek', decks: [DECK.GRADIENT, DECK.RED] },
		])
		expect(getWeeklyCocktail()).toEqual(rotated)

		// restore the seed for other tests
		await setWeeklyCocktail(
			{ name: before.name, decks: before.decks },
			fakeSave,
		)
	})
})
