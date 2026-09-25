import {
	DataSet,
	RegExpMatcher,
	englishDataset,
	englishRecommendedTransformers,
} from 'obscenity'
import { detectContactExchange } from '../safety/contact-exchange.js'
import { isApprovedLink } from './links.js'
import { scoringVariants } from './normalize.js'
import { findThreats } from './threat.js'
import type { MatchRecord, SafetySignal } from './types.js'

// Composition layer between the raw message and the pure decision core: builds
// the deterministic evidence (obscenity + custom denylist + safety tier over
// all normalization variants) and reduces per-variant ML scores to per-label
// maxima. Used by both the eval harness and the moderation service, so the two
// can never drift apart.

/**
 * Self-harm-directive and kill phrases the ML tier demonstrably underrates
 * (measured in the prototype). DB-loadable later; substring match on
 * normalized variants.
 */
export const DEFAULT_DENYLIST = [
	'kys',
	'kill yourself',
	'kill urself',
	'drink bleach',
	'neck yourself',
	'end yourself',
	'off yourself',
	// Euphemisms the guard doesn't recognize (red-team 2026-07-09).
	'unalive yourself',
	'unalive urself',
	'go unalive',
	'an hero',
]

/**
 * Banter-grade profanity the GUARD judges in context instead of a hard
 * deterministic block (policy 2026-07-09, from the 72k-message teacher run:
 * these words dominated the false-positive residue — "fuck this game",
 * "im so ass" are normal lobby speech, while directed abuse using the same
 * words is caught by the tuned guard). Slurs and sexual-explicit terms stay
 * in the deterministic blocklist. "sex"/"dick" follow MJ's review labels:
 * guard-flagged (Controversial/Unsafe), not blanket-blocked.
 */
export const GUARD_JUDGED_PROFANITY = new Set([
	'arse',
	'ass',
	'bastard',
	'bitch',
	'bollocks',
	'boob',
	'dick',
	'fuck',
	'penis',
	'piss',
	'prick',
	'sex',
	'shit',
	'tit',
	'turd',
	'twat',
	'vagina',
	'wank',
])

export type DeterministicEvidence = {
	variants: string[]
	threatMatches: MatchRecord[]
	obscenityMatches: MatchRecord[]
	safetySignals: SafetySignal[]
}

export type DeterministicAnalyzer = {
	analyze(message: string): DeterministicEvidence
}

/** "kiiiill" and "kill" both become "kil" — squeeze both sides to compare. */
function squeezeRepeats(text: string): string {
	return text.replace(/([a-z])\1+/g, '$1')
}

export function createDeterministicAnalyzer(
	opts: { denylist?: string[]; approvedDomains?: readonly string[] } = {},
): DeterministicAnalyzer {
	const denylist = opts.denylist ?? DEFAULT_DENYLIST
	const approvedDomains = opts.approvedDomains ?? []
	// Each phrase matches in raw form or with repeats squeezed on both sides.
	const denyForms = denylist.map((phrase) => ({
		phrase,
		squeezed: squeezeRepeats(phrase),
	}))
	// English dataset minus banter-grade profanity (guard judges those in
	// context); slurs and sexual-explicit terms remain deterministic blocks.
	const dataset = new DataSet<{ originalWord: string }>()
		.addAll(englishDataset)
		.removePhrasesIf((phrase) =>
			GUARD_JUDGED_PROFANITY.has(phrase.metadata?.originalWord ?? ''),
		)
	const matcher = new RegExpMatcher({
		...dataset.build(),
		...englishRecommendedTransformers,
	})

	return {
		analyze(message: string): DeterministicEvidence {
			const variants = scoringVariants(message)
			const obscenityMatches: MatchRecord[] = []
			const safetySignals: SafetySignal[] = []
			const seenObscenity = new Set<string>()
			const seenSafety = new Set<string>()

			for (const variant of variants) {
				for (const raw of matcher.getAllMatches(variant)) {
					const word =
						dataset.getPayloadWithPhraseMetadata(raw).phraseMetadata
							?.originalWord ?? ''
					const key = `${word}:${raw.startIndex}`
					if (seenObscenity.has(key)) continue
					seenObscenity.add(key)
					obscenityMatches.push({
						word,
						startIndex: raw.startIndex,
						endIndex: raw.endIndex,
					})
				}
				const squeezedVariant = squeezeRepeats(variant)
				for (const { phrase, squeezed } of denyForms) {
					const hit = variant.includes(phrase)
						? { haystack: variant, needle: phrase }
						: squeezedVariant.includes(squeezed)
							? { haystack: squeezedVariant, needle: squeezed }
							: null
					if (hit) {
						const key = `denylist:${phrase}`
						if (seenObscenity.has(key)) continue
						seenObscenity.add(key)
						const startIndex = hit.haystack.indexOf(hit.needle)
						obscenityMatches.push({
							word: phrase,
							startIndex,
							endIndex: startIndex + hit.needle.length,
						})
					}
				}
				for (const match of detectContactExchange(variant)) {
					// Approved-domain links are exempt from the url/invite safety block
					// (they are explicitly allowlisted; the link tier keeps them intact).
					if (
						(match.kind === 'url' || match.kind === 'invite_link') &&
						isApprovedLink(match.span, approvedDomains)
					)
						continue
					const key = `${match.kind}:${match.severity}`
					if (seenSafety.has(key)) continue
					seenSafety.add(key)
					safetySignals.push({ severity: match.severity, kind: match.kind })
				}
			}

			// findThreats normalizes internally (leet-fold + punctuation), so the
			// raw transformed message covers evasion without the variant loop.
			const threatMatches = findThreats(message)
			return { variants, threatMatches, obscenityMatches, safetySignals }
		},
	}
}
