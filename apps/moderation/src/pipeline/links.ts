// Deterministic link tier (pure core). Balatro chat renders no images and has
// near-zero legitimate use for arbitrary links, so a URL is almost pure downside
// (malware / phishing / NSFW vector the guard can't even see the destination of
// — it hallucinates "Sexual Content" on a cat-gambling gif). We therefore do not
// relay links at all UNLESS their domain is explicitly approved: every other URL
// is replaced with a placeholder BEFORE judging, so it never reaches other
// players and the whole "are we responsible for the destination" question is
// moot — we aren't delivering the link.
//
// Approved domains come from a human-edited file (APPROVED_DOMAINS_PATH), one
// per line; `#` lines are comments. A domain matches its exact host and any
// subdomain (`youtube.com` approves `www.youtube.com`, `m.youtube.com`).

export const LINK_PLACEHOLDER = '[link removed]'

// http(s):// URLs and bare www. hosts. Real pasted links carry a scheme; we do
// not guess at scheme-less bare domains (they collide with slang/versions).
const URL_RE = /(?:https?:\/\/|www\.)[^\s]+/gi

/** Parses the approved-domains file. One domain per line; `#` comments and blanks skipped. */
export function parseApprovedDomains(text: string): string[] {
	const domains: string[] = []
	for (const line of text.split('\n')) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) continue
		// Accept a bare domain or a pasted URL; reduce to the host.
		domains.push(hostOf(trimmed))
	}
	return domains
}

/** Lowercased host of a URL/domain token: scheme, `www.`, path, query, and port stripped. */
function hostOf(token: string): string {
	let s = token.replace(/^https?:\/\//i, '').replace(/^www\./i, '')
	s = s.split(/[/?#]/)[0] ?? '' // drop path/query/fragment
	s = s.split(':')[0] ?? '' // drop port
	return s.toLowerCase()
}

function isApproved(host: string, approved: readonly string[]): boolean {
	return approved.some((d) => host === d || host.endsWith(`.${d}`))
}

/** True when a matched URL/link token belongs to an approved domain (or subdomain). */
export function isApprovedLink(
	url: string,
	approvedDomains: readonly string[],
): boolean {
	return isApproved(hostOf(url), approvedDomains)
}

/**
 * Replaces every URL whose domain is not approved with LINK_PLACEHOLDER.
 * Approved-domain links pass through unchanged. Returns the input untouched
 * when it contains no links.
 */
export function stripLinks(
	message: string,
	approvedDomains: readonly string[] = [],
): string {
	return message.replace(URL_RE, (url) =>
		isApproved(hostOf(url), approvedDomains) ? url : LINK_PLACEHOLDER,
	)
}
