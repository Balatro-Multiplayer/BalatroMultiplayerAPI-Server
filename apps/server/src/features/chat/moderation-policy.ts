import {
	BAND_MUTED,
	BAND_RATE_LIMITED,
	type ModerationResult,
	type OutagePolicy,
} from '../../infrastructure/gateways/moderation.gateway.js'

// Pure mapping from a moderation-service outcome to a chat delivery decision.
// All the branching lives here, on plain data, so the whole verdict/outage
// matrix is testable with literals — chat.service.ts stays gather -> decide ->
// publish (mirroring the normalization.ts / obscenity.ts split).

export type ChatRejection =
	| { ok: false; reason: 'empty' | 'moderated' | 'moderation_unavailable' }
	| { ok: false; reason: 'muted'; mutedUntil?: string }
	| { ok: false; reason: 'rate_limited'; retryAfterMs?: number }

export type ChatResult =
	| {
			ok: true
			// Set only when moderation rewrote the message: the text other players
			// actually received, so the sender's client can show what was delivered.
			publishText?: string
	  }
	| ChatRejection

export type Delivery =
	| { action: 'publish'; text: string }
	| { action: 'reject'; rejection: ChatRejection }

export function decideDelivery(
	outcome: ModerationResult,
	message: string,
	allowlisted: boolean,
	outagePolicy: OutagePolicy,
): Delivery {
	if (outcome.status === 'unreachable') {
		// Fail closed. The 'presets' outage policy still delivers curated
		// allowlist messages — safe by construction, moderation not needed.
		if (outagePolicy === 'presets' && allowlisted) {
			return { action: 'publish', text: message }
		}
		return {
			action: 'reject',
			rejection: { ok: false, reason: 'moderation_unavailable' },
		}
	}

	if (outcome.status === 'shed') {
		// Service load-shedding and per-player rate limiting are one contract
		// to the client: back off and retry.
		return {
			action: 'reject',
			rejection: {
				ok: false,
				reason: 'rate_limited',
				retryAfterMs: outcome.retryAfterMs,
			},
		}
	}

	const v = outcome.verdict
	if (v.verdict === 'reject') {
		// Only these two wire bands get special treatment; every other rejecting
		// band — including ones future service versions invent — is a generic
		// block. See the wire-contract note in moderation.gateway.ts.
		if (v.band === BAND_MUTED) {
			return {
				action: 'reject',
				rejection: { ok: false, reason: 'muted', mutedUntil: v.mutedUntil },
			}
		}
		if (v.band === BAND_RATE_LIMITED) {
			return {
				action: 'reject',
				rejection: {
					ok: false,
					reason: 'rate_limited',
					retryAfterMs: v.retryAfterMs,
				},
			}
		}
		return { action: 'reject', rejection: { ok: false, reason: 'moderated' } }
	}

	// Allowed. An empty rewrite is treated as no rewrite — never deliver a
	// blanked-out message.
	return { action: 'publish', text: v.publishText || message }
}
