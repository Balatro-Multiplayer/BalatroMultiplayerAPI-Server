// Draft pool policy: per-queue configuration for the server-generated deck+stake
// draft (Botlatro parity -- see Botlatro-Multiplayer src/utils/TupleBans.ts).
//
// Keyed by the SAME (modId, gameMode) string the matchmaking queues use (ranked
// is encoded in gameMode: 'ranked:pvp_standard' vs 'pvp_standard' are distinct
// queues/policies). Everything here is SEED data, meant to move into a DB table
// so it's live-tunable like the bot's deck_mults/stake_mults/banned_decks.

import { queueKey } from '../../state/matchmaking.js'
import { DECK, type DeckKey, STAKE } from './draft-constants.js'
import { generateDraftPool } from './generate-draft-pool.js'

export interface DeckPolicy {
	key: string
	/** Roulette weight for draft tiles. 0 = never appears as its own tile. */
	draftWeight: number
}

export interface StakePolicy {
	/** SMODS stake index (see STAKE for the vanilla names; modded stakes are higher). */
	id: number
	weight: number
}

export interface DraftPolicy {
	/** Number of items (deck+stake pairs) in a pool. */
	poolSize: number
	/** Max occurrences of any one stake in a pool. */
	maxPerStake: number
	/** Max occurrences of any one deck in a pool. */
	maxPerDeck: number
	/** Minimum-occurrence guarantees per stake: each listed stake is forced to
	 *  appear at least `min` times. The generator reserves slots so every
	 *  guarantee is met. Empty = no guarantee. */
	guaranteedStakes: StakeGuarantee[]
	decks: DeckPolicy[]
	stakes: StakePolicy[]
}

export interface StakeGuarantee {
	stakeId: number
	min: number
}

const deck = (key: DeckKey, draftWeight: number): DeckPolicy => ({
	key,
	draftWeight,
})

// The 15 vanilla decks, all draftable at weight 1.
const VANILLA_DECKS: DeckPolicy[] = [
	DECK.RED,
	DECK.BLUE,
	DECK.YELLOW,
	DECK.GREEN,
	DECK.BLACK,
	DECK.MAGIC,
	DECK.NEBULA,
	DECK.GHOST,
	DECK.ABANDONED,
	DECK.CHECKERED,
	DECK.ZODIAC,
	DECK.PAINTED,
	DECK.ANAGLYPH,
	DECK.PLASMA,
	DECK.ERRATIC,
].map((key) => deck(key, 1))

// MultiplayerPvP custom decks that are actually draftable: Violet, Orange,
// Cocktail. Indigo/Gradient/Oracle/Heidelberg/Echo used to sit here at
// draftWeight 0 just to carry cocktail-eligibility metadata; that now lives in
// COCKTAIL_ELIGIBLE_DECKS below, so they're dropped from this draftable-only list.
const PVP_CUSTOM_DECKS: DeckPolicy[] = [
	deck(DECK.VIOLET, 1),
	deck(DECK.ORANGE, 1),
	deck(DECK.COCKTAIL, 1),
]

// Every deck may appear in a cocktail except the cocktail deck itself.
export const COCKTAIL_ELIGIBLE_DECKS: DeckKey[] = Object.values(DECK).filter(
	(key) => key !== DECK.COCKTAIL,
)

// 5 of the 8 vanilla stakes (Red/Blue/Orange excluded), equally weighted --
// matches Botlatro's ranked set. Draftable stakes are per-policy; another
// queue can list a different subset.
const RANKED_DRAFTABLE_STAKES: StakePolicy[] = [
	{ id: STAKE.WHITE, weight: 1 },
	{ id: STAKE.GREEN, weight: 1 },
	{ id: STAKE.BLACK, weight: 1 },
	{ id: STAKE.PURPLE, weight: 1 },
	{ id: STAKE.GOLD, weight: 1 },
]

const PVP_RANKED_POLICY: DraftPolicy = {
	poolSize: 9,
	maxPerStake: 4,
	maxPerDeck: 3,
	guaranteedStakes: [{ stakeId: STAKE.WHITE, min: 1 }],
	decks: [...VANILLA_DECKS, ...PVP_CUSTOM_DECKS],
	stakes: RANKED_DRAFTABLE_STAKES,
}

const PVP_MOD_ID = 'MultiplayerPvP'
const PVP_GAME_MODES = [
	'pvp_standard',
	'pvp_expanded',
	'pvp_vanilla',
	'pvp_smallworld',
]

// Deep-copy so each row is independently tunable -- shared references would
// make "re-tune ranked without touching the default" silently impossible.
function clonePolicy(policy: DraftPolicy): DraftPolicy {
	return {
		...policy,
		decks: policy.decks.map((d) => ({ ...d })),
		stakes: policy.stakes.map((s) => ({ ...s })),
	}
}

// Seed rows. Every MultiplayerPvP queue draws the mod-wide default; explicit
// ranked rows exist so ranked can be re-tuned independently later. A queue
// diverges by getting its own row, never by losing server-driven drafts.
const policies = new Map<string, DraftPolicy>()
policies.set(queueKey(PVP_MOD_ID, '*'), clonePolicy(PVP_RANKED_POLICY))
for (const mode of PVP_GAME_MODES) {
	policies.set(
		queueKey(PVP_MOD_ID, `ranked:${mode}`),
		clonePolicy(PVP_RANKED_POLICY),
	)
}

/**
 * Policy lookup with fallthrough: exact queue key, then the mod-wide default
 * (key '<modId>:*'), then undefined -- meaning "this queue is not server-driven;
 * the client generates its own pool" (the mod-side fallback path).
 */
export function getDraftPolicy(
	modId: string,
	gameMode: string,
): DraftPolicy | undefined {
	return (
		policies.get(queueKey(modId, gameMode)) ??
		policies.get(queueKey(modId, '*'))
	)
}

// Deterministic PRNG (mulberry32) purely for the startup self-check below --
// its output never reaches a real draft, so any fixed seed is fine.
function mulberry32(seed: number): () => number {
	let a = seed >>> 0
	return () => {
		a = (a + 0x6d2b79f5) >>> 0
		let t = a
		t = Math.imul(t ^ (t >>> 15), t | 1)
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

/**
 * Boot-time self-check: generates one pool per distinct policy row with a
 * fixed rng. generateDraftPool already retries internally on a greedy
 * dead-end, so this only throws for a genuinely infeasible policy --
 * crashing boot loudly instead of surfacing as a per-request failure later.
 */
export function validateDraftPolicies(): void {
	const distinct = new Set(policies.values())
	for (const policy of distinct) {
		generateDraftPool(policy, mulberry32(1))
	}
}
