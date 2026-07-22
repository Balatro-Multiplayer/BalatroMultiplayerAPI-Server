// Weekly cocktail: the community-curated composition the Cocktail deck uses
// this week. Rotated via the admin endpoint (PUT /admin/weekly-cocktail) --
// no deploy needed.
//
// Persistence: boot loads the single-row `weekly_cocktail` table via
// `loadWeeklyCocktail()` (called from main.ts, mirroring loadConfigFromDb),
// defaulting to the in-code SEED when no row exists yet. Rotations
// write-through to the DB (`setWeeklyCocktail`) to survive a restart; the
// in-memory cache (`current`) keeps `getWeeklyCocktail()` synchronous for
// inline readers like draft.service.ts.
//
// `name` excludes the word "Cocktail" -- the client appends its own localized
// suffix (k_cocktail_suffix), so "Casjb" renders as "Casjb Cocktail" in
// English and translates elsewhere.

import { ValidationError } from '../../shared/utils/errors.js'
import {
	loadWeeklyCocktailFromDb,
	saveWeeklyCocktailToDb,
} from '../../infrastructure/gateways/weekly-cocktail.gateway.js'
import { COCKTAIL_ELIGIBLE_DECKS } from './draft-policy.js'

// O(1) membership check against the explicit allowlist (draft-policy.ts) --
// rebuilt once at module load, not per call.
const COCKTAIL_ELIGIBLE_SET = new Set<string>(COCKTAIL_ELIGIBLE_DECKS)

export interface WeeklyCocktail {
	/** Short display title, WITHOUT the "Cocktail" suffix (client-localized). */
	name: string
	/** The forced composition (the Cocktail deck merges exactly these). */
	decks: string[]
}

const SEED: WeeklyCocktail = {
	name: 'Casjb',
	decks: ['b_green', 'b_black', 'b_mp_orange'],
}

let current: WeeklyCocktail = { ...SEED, decks: [...SEED.decks] }

export function getWeeklyCocktail(): WeeklyCocktail {
	return current
}

/**
 * Validate a rotation candidate: every deck must be on COCKTAIL_ELIGIBLE_DECKS
 * (no smuggling in an excluded deck) and 1-3 decks (the Cocktail merges at
 * most 3 effects). Pure -- throws ValidationError on violation, else returns
 * the normalized WeeklyCocktail.
 */
export function validateWeeklyCocktail(input: unknown): WeeklyCocktail {
	const { name, decks } = (input ?? {}) as { name?: unknown; decks?: unknown }
	if (typeof name !== 'string' || name.trim().length === 0 || name.length > 40)
		throw new ValidationError('name must be a non-empty string (max 40 chars)')
	if (!Array.isArray(decks) || decks.length < 1 || decks.length > 3)
		throw new ValidationError('decks must be an array of 1-3 deck keys')

	for (const key of decks) {
		if (typeof key !== 'string' || key.length === 0)
			throw new ValidationError('every deck must be a non-empty key string')
		if (!COCKTAIL_ELIGIBLE_SET.has(key))
			throw new ValidationError(`deck '${key}' is not cocktail-eligible`)
	}
	if (new Set(decks).size !== decks.length)
		throw new ValidationError('decks must be distinct')

	return { name: name.trim(), decks: [...(decks as string[])] }
}

/**
 * Boot-load the weekly cocktail from the DB, defaulting to SEED when no row
 * exists yet. Default `fetch` is the real gateway; tests inject a fake.
 */
export async function loadWeeklyCocktail(
	fetch: () => Promise<{
		name: string
		decks: string[]
	} | null> = loadWeeklyCocktailFromDb,
): Promise<void> {
	try {
		const row = await fetch()
		current = row
			? { name: row.name, decks: [...row.decks] }
			: { ...SEED, decks: [...SEED.decks] }
	} catch (err) {
		// A cocktail DB problem (e.g. table missing pre-migration) must never take
		// down the server -- degrade gracefully: fall back to SEED and log.
		console.warn(
			'[draft] weekly cocktail DB load failed, using SEED default:',
			err instanceof Error ? err.message : err,
		)
		current = { ...SEED, decks: [...SEED.decks] }
	}
}

/**
 * Rotate the weekly cocktail: validate, update the in-memory cache, then
 * write through to the DB. Default `save` is the real gateway; tests inject a
 * fake.
 */
export async function setWeeklyCocktail(
	input: unknown,
	save: (wc: WeeklyCocktail) => Promise<void> = saveWeeklyCocktailToDb,
): Promise<WeeklyCocktail> {
	const wc = validateWeeklyCocktail(input)
	current = wc
	await save(wc)
	console.log(
		`[draft] weekly cocktail rotated: ${current.name} -- ${current.decks.join(', ')}`,
	)
	return current
}
