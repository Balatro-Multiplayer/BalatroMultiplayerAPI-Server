// Normalization for allowlist lookup and for scoring.
//
// - normalizeForAllowlist mirrors apps/server/src/features/chat/chat.service.ts
//   exactly (allowlist keys are stored in that normalized form).
// - scoringVariants defeats common evasion (leetspeak, stretched letters) by
//   producing several spellings; the pipeline scores each and takes the
//   per-label max. The ORIGINAL text is always what gets published.

const LEET: Record<string, string> = {
	'0': 'o',
	'1': 'i',
	'3': 'e',
	'4': 'a',
	'5': 's',
	'7': 't',
	'8': 'b',
	'!': 'i',
	'@': 'a',
	$: 's',
}

/**
 * Normalizes a message for allowlist comparison. Returns null for
 * whitespace-only input (which the caller drops).
 */
export function normalizeForAllowlist(message: string): string | null {
	const trimmed = message.trim()
	if (trimmed === '') return null

	const lower = trimmed.toLowerCase()

	// Pure-punctuation messages: don't strip the trailing character.
	if (/^[.!?]+$/.test(lower)) return lower

	if (lower.endsWith('.') || lower.endsWith('!') || lower.endsWith('?')) {
		return lower.slice(0, -1)
	}

	return lower
}

function leetFold(text: string): string {
	return text.toLowerCase().replace(/[0134578!@$]/g, (c) => LEET[c] ?? c)
}

// '1'/'|'/'!' are ambiguous strokes: often 'i' (k1ll), but just as often 'l'
// (ki11 = kill) or 'i'. leetFold picks 'i'; this alternate picks 'l' so the
// other spelling gets scored too (red-team 2026-07-09: "ki11 yourself" leaked).
function leetFoldAltL(text: string): string {
	// Map 1/|/! -> 'l' FIRST (before the default fold turns 1 into 'i'), then
	// apply the remaining leet substitutions.
	return text
		.toLowerCase()
		.replace(/[1|!]/g, 'l')
		.replace(/[034578@$]/g, (c) => LEET[c] ?? c)
}

// Collapses letter-spacing evasion ("k i l l you" -> "kill you") by joining runs
// of 2+ single letters. Harmless on normal text (real words aren't spelled out).
function despace(text: string): string {
	return text.replace(/(?:\b[a-z]\b[ ]){2,}\b[a-z]\b/g, (s) =>
		s.replace(/ /g, ''),
	)
}

/**
 * Produces de-duplicated spellings to score: the original, leetspeak folds
 * (both 'i' and 'l' readings of 1/|/!), a letter-despaced form, and
 * repeat-squeezed forms ("kiiiill" -> "kiill" / "kil"). Scoring all of them and
 * taking the per-label maximum catches evasion the raw text hides ("k1ll
 * y0urs3lf", "ki11 yourself", "k i l l you").
 */
export function scoringVariants(text: string): string[] {
	const bases = [leetFold(text), leetFoldAltL(text)]
	const out = new Set<string>([text])
	for (const b of bases) {
		for (const v of [b, despace(b)]) {
			out.add(v)
			out.add(v.replace(/([a-z])\1+/g, '$1$1')) // 3+ repeats -> 2
			out.add(v.replace(/([a-z])\1+/g, '$1')) // all repeats -> 1
		}
	}
	return [...out]
}

/**
 * Caps each scoring variant to its first `maxChars` characters and de-dupes
 * (truncation can collapse variants that only differed past the cut). Bounds
 * the guard's per-call cost on long messages — toxic signal is front-loaded
 * and the deterministic tiers still scan the full text, so this trades only the
 * unlikely late-in-a-wall-of-text ML hit for a hard latency ceiling.
 * `maxChars` omitted / `<= 0` returns the variants unchanged (offline eval).
 */
export function capForScoring(variants: string[], maxChars?: number): string[] {
	if (!maxChars || maxChars <= 0) return variants
	return [...new Set(variants.map((v) => v.slice(0, maxChars)))]
}
