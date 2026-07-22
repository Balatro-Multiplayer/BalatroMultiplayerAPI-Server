// Draft vocabulary: canonical Balatro/SMODS center keys and vanilla stake
// indices, shared as WIRE vocabulary with the Lua client (BalatroMultiplayer).
// Kills magic strings/numbers -- every draft module references this one
// source instead of re-typing literals.

/**
 * Every deck this feature can reference by key: the 15 vanilla SMODS center
 * decks plus the MultiplayerPvP custom decks (draftable and cocktail-only).
 */
export const DECK = {
	RED: 'b_red',
	BLUE: 'b_blue',
	YELLOW: 'b_yellow',
	GREEN: 'b_green',
	BLACK: 'b_black',
	MAGIC: 'b_magic',
	NEBULA: 'b_nebula',
	GHOST: 'b_ghost',
	ABANDONED: 'b_abandoned',
	CHECKERED: 'b_checkered',
	ZODIAC: 'b_zodiac',
	PAINTED: 'b_painted',
	ANAGLYPH: 'b_anaglyph',
	PLASMA: 'b_plasma',
	ERRATIC: 'b_erratic',
	VIOLET: 'b_mp_violet',
	ORANGE: 'b_mp_orange',
	COCKTAIL: 'b_mp_cocktail',
	INDIGO: 'b_mp_indigo',
	GRADIENT: 'b_mp_gradient',
	ORACLE: 'b_mp_oracle',
	HEIDELBERG: 'b_mp_heidelberg',
	ECHO: 'b_mp_echodeck',
} as const

export type DeckKey = (typeof DECK)[keyof typeof DECK]

/**
 * Named vanilla SMODS stake indices (stable). Index-based, not a closed enum --
 * modded stakes take higher indices assigned at load and a policy may
 * reference any by number; these names just kill magic numbers for vanilla.
 */
export const STAKE = {
	WHITE: 1,
	RED: 2,
	GREEN: 3,
	BLACK: 4,
	BLUE: 5,
	PURPLE: 6,
	ORANGE: 7,
	GOLD: 8,
} as const
