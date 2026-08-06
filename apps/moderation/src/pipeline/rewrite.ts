// Deterministic rewrite tier (pure core). Community-vocabulary corrections
// applied to the message BEFORE any judging — the rewritten text is what the
// allowlist/analyzer/guard see AND what gets published (`publishText`). This
// exists for words the guard cannot be taught past even with domain context
// (measured: "wanna do white cock?" stays Unsafe [Sexual] with glossary +
// real conversation — the Cocktail-deck abbreviation reads as crude to the
// model no matter what). Rewriting to the full term fixes the false block.
//
// Rules come from a human-edited file (REWRITES_PATH), one per line:
//   cock => cocktail
//   cock => cocktail !! (my|your)\s+cock|suck\w*[\s\w]{0,16}cock
// `#` lines are comments. Matching is case-insensitive on word boundaries —
// "cocktail" itself is NOT re-matched ("cock" inside it has no trailing word
// boundary). Simple case preservation: ALL-CAPS and Capitalized sources map
// to ALL-CAPS / Capitalized targets.
//
// The optional `!! <regex>` suffix is an UNLESS guard: when the (case-
// insensitive) regex matches the original message, the rule is skipped for
// that whole message. This closes the laundering hole (found 2026-07-09):
// without it, "suck my cock" rewrote to "suck my cocktail", which the guard
// then judged Safe — the rewrite must not fire in clearly-sexual frames, so
// the guard sees the raw text and blocks it (measured: the tuned guard flags
// the raw forms Unsafe/Sexual). A malformed unless-regex disables its rule
// entirely (fail closed to "no rewrite" — the guard judges raw).

export type RewriteRule = { from: string; to: string; unless?: RegExp }

const escapeRegExp = (s: string): string =>
	s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Parses the rewrites file. Malformed lines are skipped, not fatal. */
export function parseRewrites(text: string): RewriteRule[] {
	const rules: RewriteRule[] = []
	for (const line of text.split('\n')) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) continue
		const m = /^(.+?)\s*=>\s*(.+?)(?:\s*!!\s*(.+))?$/.exec(trimmed)
		if (!m) continue
		const from = (m[1] as string).trim().toLowerCase()
		const to = (m[2] as string).trim()
		if (!from || !to || from === to.toLowerCase()) continue
		if (m[3]) {
			let unless: RegExp
			try {
				unless = new RegExp(m[3].trim(), 'i')
			} catch {
				// Malformed guard: skip the whole rule rather than rewriting
				// without its safety condition.
				continue
			}
			rules.push({ from, to, unless })
		} else {
			rules.push({ from, to })
		}
	}
	return rules
}

function matchCase(source: string, target: string): string {
	if (source === source.toUpperCase() && /[A-Z]/.test(source))
		return target.toUpperCase()
	if (source[0] === source[0]?.toUpperCase() && /[A-Z]/.test(source[0] ?? ''))
		return (target[0]?.toUpperCase() ?? '') + target.slice(1)
	return target
}

/**
 * Applies every rule on word boundaries; returns the input unchanged when
 * nothing matches. A rule whose `unless` guard matches the ORIGINAL message
 * is skipped entirely — the raw text flows on to the guard instead.
 */
export function applyRewrites(
	message: string,
	rules: readonly RewriteRule[],
): string {
	let out = message
	for (const rule of rules) {
		if (rule.unless?.test(message)) continue
		const re = new RegExp(`\\b${escapeRegExp(rule.from)}\\b`, 'gi')
		out = out.replace(re, (hit) => matchCase(hit, rule.to))
	}
	return out
}
