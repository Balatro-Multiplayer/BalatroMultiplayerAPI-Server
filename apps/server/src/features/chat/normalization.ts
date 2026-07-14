// Normalization is only for allowlist key lookup. The published text is the
// player's original unless the moderation service supplies a rewrite; the
// reported-lobby evidence buffer always keeps the original.
export function normalizeForAllowlist(message: string): string | null {
	const trimmed = message.trim()
	if (trimmed === '') return null

	const lower = trimmed.toLowerCase()

	// Pure-punctuation sequences don't have a meaningful trailing char to strip
	if (/^[.!?]+$/.test(lower)) return lower

	if (lower.endsWith('.') || lower.endsWith('!') || lower.endsWith('?')) {
		return lower.slice(0, -1)
	}

	return lower
}
