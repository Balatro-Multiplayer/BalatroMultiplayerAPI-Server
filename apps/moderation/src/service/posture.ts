// Pure boot-time posture summary (enforcement + auth). Computed once in
// main.ts from already-gathered config and threaded into BOTH the boot
// banner and GET /health, so the two can never drift and an operator can
// always answer "is this thing actually blocking anything?" from either
// channel. The dangerous state (shadow, auth disabled) must never be the
// quiet one — main.ts prints both banner lines unconditionally, not just the
// enforcing/authenticated branch.

export type EnforcementMode = 'shadow' | 'enforce'

export type ServicePosture = {
	enforcement: EnforcementMode
	authEnabled: boolean
}

/**
 * The exact boot-banner lines for a given posture — pure so the wording is
 * unit-tested without booting the process. `carvedWordCount` names how many
 * banter-grade profanity words are judged by the (possibly-ignored, in
 * shadow mode) guard instead of hard-blocked, since that fact is only scary
 * in combination with shadow mode.
 */
export function postureBannerLines(
	posture: ServicePosture,
	carvedWordCount: number,
): string[] {
	return [
		posture.enforcement === 'shadow'
			? `[moderation] ENFORCEMENT=SHADOW — guard 'Unsafe' verdicts are PUBLISHED as band 'review', not blocked; only the deterministic tiers (threat/blocklist/safety) actually reject. ${carvedWordCount} profanity phrases are delegated to that ignored guard verdict instead of a hard block. An unloaded/missing model also publishes as 'review' in this mode (a late one still refuses) — so a model problem here degrades quietly instead of stopping chat; watch model_loaded in /health.`
			: "[moderation] ENFORCEMENT=ENFORCE — a guard 'Unsafe' verdict is BLOCKED (band guard_block).",
		posture.authEnabled
			? '[moderation] AUTH=enabled'
			: '[moderation] AUTH=DISABLED — /moderate accepts UNAUTHENTICATED requests. Set MODERATION_BEARER_TOKEN to at least one non-empty token to require a bearer.',
	]
}
