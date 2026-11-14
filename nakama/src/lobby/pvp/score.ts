// PVP.Score on the server: a thin wrapper over big-score.ts (the port of
// MPAPI.BigScore), shaped like the client's lib/score.lua. A missing or
// malformed score never reaches it: the reducers refuse one at the door
// (`bad_payload` / `bad_score`), so every compare here takes canonical score text. Pure.
import {
	ZERO_SCORE,
	compareScores,
	fromNumber,
	normalizeScore,
} from '../../../../packages/types/src/big-score'

export const SCORE_ZERO = ZERO_SCORE

// Canonical score text of a finite game value (a double).
export function fromGameValue(value: number): string {
	return fromNumber(value)
}

// Canonical score text, or null when the value is not score text.
export function parse(text: unknown): string | null {
	if (typeof text !== 'string') return null
	return normalizeScore(text)
}

// -1, 0 or 1, of two canonical score texts.
export function compare(a: string, b: string): -1 | 0 | 1 {
	const order = compareScores(a, b)
	if (order === null)
		throw new Error('compare was given text that is not a score')
	return order
}

// Ranks round scores, where null is a score the player has not reported: null
// ranks below every reported score and equal to null.
export function compareRoundScore(
	a: string | null,
	b: string | null,
): -1 | 0 | 1 {
	if (a === null) return b === null ? 0 : -1
	if (b === null) return 1
	return compare(a, b)
}

export function greater(a: string, b: string): boolean {
	return compare(a, b) > 0
}

export function equal(a: string, b: string): boolean {
	return compare(a, b) === 0
}

// Beyond this the double sum has no meaning and the largest score stands in.
const SUM_LIMIT = 1e300

// Score text of the sum of score texts, by the client's no-number-mod rule:
// plain integers add as doubles; any array text (a comma) or a total past
// 1e300 gives the largest score instead.
export function sum(list: readonly string[]): string {
	let total = 0
	let allPlain = true
	let largest = SCORE_ZERO
	for (const text of list) {
		if (greater(text, largest)) largest = text
		if (text.includes(',')) allPlain = false
		else total += Number(text)
	}
	if (allPlain && total < SUM_LIMIT) return fromGameValue(total)
	return largest
}
