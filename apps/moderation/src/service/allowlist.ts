import { normalizeForAllowlist } from '../pipeline/normalize.js'

/**
 * Parses an allowlist file's text into the Set the moderation service matches
 * against (tier-0 fast-pass, see gen-allowlist output). One message per line;
 * blank lines and `#` comments are ignored; every entry is normalized with the
 * SAME function the hot path uses, so file entries and live messages can never
 * disagree about casing/whitespace. Pure — the file read lives in main.ts.
 */
export function parseAllowlist(text: string): Set<string> {
	const entries = new Set<string>()
	for (const rawLine of text.split('\n')) {
		const line = rawLine.trim()
		if (line === '' || line.startsWith('#')) continue
		const normalized = normalizeForAllowlist(line)
		if (normalized !== null) entries.add(normalized)
	}
	return entries
}
