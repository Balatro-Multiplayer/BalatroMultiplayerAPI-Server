// Pure draft-pool generator: a faithful port of Botlatro's TupleBans generation
// (Botlatro-Multiplayer src/utils/TupleBans.ts), minus the Discord/emote plumbing.
//
// Efraimidis-Spirakis A-Res weighted sampling without replacement: each (deck,
// stake) pair gets priority rng()^(1/pairWeight); sorting descending yields a
// weighted-random permutation in one pass, no rejection loop. Weight 1
// degrades to a plain uniform shuffle; pairWeight = deckWeight * stakeWeight
// reproduces independent stake- and deck-weighted picks.
//
// Invariants (enforced + property-tested): exactly poolSize tuples; every deck
// draftWeight > 0 and stake weight > 0; no duplicate pairs; no stake/deck over
// its maxPerStake/maxPerDeck cap; if guaranteedStakeId is set, a pre-pass
// reserves that stake's highest-priority candidates first, up to its minimum.
//
// Deviation from the bot: instead of per-slot stake-then-deck rolls with up to
// 100 retries, this ranks every candidate pair once per attempt and walks the
// ranking twice (guarantees, then fill); a dead-end re-ranks with fresh rng
// draws (MAX_GENERATION_ATTEMPTS) rather than corrupting or producing a
// stake-less tuple. Only failure mode is a loud throw -- up front
// (assertFeasible) or after exhausting every retry.

import type { DraftPolicy } from './draft-policy.js'

export interface DraftTuple {
	key: string
	stake: number
	/** Composite deck (cocktail) only: the sub-composition it merges. */
	decks?: string[]
	/** Composite deck only: bare display title (the client appends its own
	 *  localized "Cocktail" suffix). */
	name?: string
}

/** Random source in [0, 1). Injected so generation is deterministic in tests. */
export type Rng = () => number

interface StakePolicyLike {
	id: number
	weight: number
}

interface Candidate {
	key: string
	stake: number
	priority: number
}

function assertFeasible(
	policy: DraftPolicy,
	deckCount: number,
	stakes: StakePolicyLike[],
): void {
	if (deckCount === 0) throw new Error('draft policy has no draftable decks')
	if (stakes.length === 0) throw new Error('draft policy has no stakes')
	if (policy.poolSize > deckCount * policy.maxPerDeck)
		throw new Error('draft policy infeasible: poolSize exceeds deck capacity')
	if (policy.poolSize > stakes.length * policy.maxPerStake)
		throw new Error('draft policy infeasible: poolSize exceeds stake capacity')
	if (policy.poolSize > deckCount * stakes.length)
		throw new Error(
			'draft policy infeasible: poolSize exceeds distinct pair capacity',
		)
	// Each guarantee must target a rollable stake, fit its cap, and all guarantees
	// together must fit the pool -- else one goes silently unmet or forces an excluded stake.
	let guaranteedTotal = 0
	for (const g of policy.guaranteedStakes) {
		if (!stakes.some((st) => st.id === g.stakeId))
			throw new Error(
				`draft policy infeasible: guaranteed stake ${g.stakeId} is not rollable`,
			)
		if (g.min > policy.maxPerStake)
			throw new Error(
				`draft policy infeasible: guaranteed stake ${g.stakeId} min ${g.min} exceeds per-stake cap`,
			)
		guaranteedTotal += g.min
	}
	if (guaranteedTotal > policy.poolSize)
		throw new Error(
			'draft policy infeasible: guaranteed minimums exceed poolSize',
		)
}

/**
 * Ranks every (deck, stake) pair by Efraimidis-Spirakis priority (see module
 * comment). FIXED iteration order (deck outer, stake inner) so exactly
 * decks.length * stakes.length rng() draws happen in the same order
 * regardless of outcome -- required for a seed to reproduce an identical pool.
 */
function rankCandidates(
	decks: { key: string; weight: number }[],
	stakes: StakePolicyLike[],
	rng: Rng,
): Candidate[] {
	const candidates: Candidate[] = []
	for (const d of decks) {
		for (const s of stakes) {
			const priority = rng() ** (1 / (d.weight * s.weight))
			candidates.push({ key: d.key, stake: s.id, priority })
		}
	}
	return candidates.sort((a, b) => b.priority - a.priority)
}

/**
 * Greedy fill over two independent caps (per-stake, per-deck) is a
 * matroid-intersection problem: assertFeasible's checks are necessary but not
 * sufficient, so an unlucky ranking can strand a tight policy short of
 * poolSize even though some other selection would work. Returns null on a
 * dead-end (never a partial/corrupt pool) so the caller can retry with a
 * fresh ranking -- see generateDraftPool's retry loop.
 */
function selectPool(
	candidates: Candidate[],
	policy: DraftPolicy,
	guarantees: DraftPolicy['guaranteedStakes'],
	maxPerStake: number,
): DraftTuple[] | null {
	const pool: DraftTuple[] = []
	const stakeCounts = new Map<number, number>()
	const deckCounts = new Map<string, number>()
	const taken = new Set<Candidate>()

	const stakeCount = (id: number) => stakeCounts.get(id) ?? 0
	const deckCount = (key: string) => deckCounts.get(key) ?? 0

	const take = (c: Candidate): void => {
		pool.push({ key: c.key, stake: c.stake })
		stakeCounts.set(c.stake, stakeCount(c.stake) + 1)
		deckCounts.set(c.key, deckCount(c.key) + 1)
		taken.add(c)
	}

	// Guarantee pre-pass: take each guaranteed stake's highest-priority eligible
	// candidates first, up to its minimum, before the general fill runs.
	for (const g of guarantees) {
		for (const c of candidates) {
			if (stakeCount(g.stakeId) >= g.min) break
			if (taken.has(c) || c.stake !== g.stakeId) continue
			if (deckCount(c.key) >= policy.maxPerDeck) continue
			take(c)
		}
	}

	// Fill: walk the ranking once more, taking any pair still fitting both caps.
	for (const c of candidates) {
		if (pool.length >= policy.poolSize) break
		if (taken.has(c)) continue
		if (
			stakeCount(c.stake) >= maxPerStake ||
			deckCount(c.key) >= policy.maxPerDeck
		)
			continue
		take(c)
	}

	if (pool.length < policy.poolSize) return null

	return pool
}

/**
 * A dead-end retries with a fresh ranking rather than failing on unlucky
 * candidate order; a valid pool is found almost immediately in practice (a
 * real policy succeeds on attempt 0). A persistent failure across all
 * attempts means a genuinely misconfigured policy -- caught by
 * validateDraftPolicies() at startup, never as a per-request failure.
 */
const MAX_GENERATION_ATTEMPTS = 100

export function generateDraftPool(policy: DraftPolicy, rng: Rng): DraftTuple[] {
	const decks = policy.decks
		.filter((d) => d.draftWeight > 0)
		.map((d) => ({ key: d.key, weight: d.draftWeight }))
	const stakes = policy.stakes.filter((s) => s.weight > 0)
	const maxPerStake = policy.maxPerStake
	// A guarantee only survives if its stake is still rollable (weight > 0);
	// a weight-0 guarantee degrades to none rather than forcing an excluded stake.
	const guarantees = policy.guaranteedStakes.filter((g) =>
		stakes.some((st) => st.id === g.stakeId),
	)
	assertFeasible(
		{ ...policy, guaranteedStakes: guarantees },
		decks.length,
		stakes,
	)

	for (let attempt = 0; attempt < MAX_GENERATION_ATTEMPTS; attempt++) {
		const candidates = rankCandidates(decks, stakes, rng)
		const pool = selectPool(candidates, policy, guarantees, maxPerStake)
		if (pool) {
			// Stable display order, mirroring the bot's orderTupleBans (stake, then deck).
			return pool.sort(
				(a, b) => a.stake - b.stake || a.key.localeCompare(b.key),
			)
		}
	}

	throw new Error(
		`draft pool generation failed after ${MAX_GENERATION_ATTEMPTS} attempts -- policy appears infeasible`,
	)
}
