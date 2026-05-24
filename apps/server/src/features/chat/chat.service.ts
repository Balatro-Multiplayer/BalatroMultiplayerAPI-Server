import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity'
import { getConfig } from '../../state/config.js'
import type { Lobby } from '../../state/lobby.js'
import { mqttService } from '../../infrastructure/mqtt/mqtt.service.js'
import { insertFlaggedMessage, insertReportedLobbyMessage } from '../../infrastructure/gateways/chat.gateway.js'

// --- Message normalization (for allowlist lookup only) ---
// The original message is always what gets published and logged.

/**
 * Normalizes a message string for allowlist comparison.
 *
 * Rules:
 * 1. trim()
 * 2. If empty after trim → return null (drop whitespace-only messages)
 * 3. toLowerCase()
 * 4. If the result consists entirely of '.', '!', '?' characters → return as-is
 *    (preserves entries like "?", "!", "...")
 * 5. If the last character is '.', '!', or '?' → remove it
 * 6. Return result
 */
export function normalizeForAllowlist(message: string): string | null {
	const trimmed = message.trim()
	if (trimmed === '') return null

	const lower = trimmed.toLowerCase()

	// Pure-punctuation messages: don't strip trailing character
	if (/^[.!?]+$/.test(lower)) return lower

	// Strip a single trailing punctuation mark
	if (lower.endsWith('.') || lower.endsWith('!') || lower.endsWith('?')) {
		return lower.slice(0, -1)
	}

	return lower
}

function isAllowlisted(message: string): boolean {
	const key = normalizeForAllowlist(message)
	if (key === null) return false
	return getConfig().chatAllowlist.has(key)
}

// --- Obscenity matcher ---

const matcher = new RegExpMatcher({
	...englishDataset.build(),
	...englishRecommendedTransformers,
})

type MatchRecord = {
	word: string
	startIndex: number
	endIndex: number
}

async function moderateMessage(
	message: string,
	playerId: string,
): Promise<{ allowed: boolean }> {
	const raw = matcher.getAllMatches(message)
	if (raw.length === 0) return { allowed: true }

	const matches: MatchRecord[] = raw.map((m) => ({
		word: englishDataset.getPayloadWithPhraseMetadata(m).phraseMetadata?.originalWord ?? '',
		startIndex: m.startIndex,
		endIndex: m.endIndex,
	}))

	await insertFlaggedMessage(playerId, message, matches)

	return { allowed: false }
}

// --- Main export ---

export async function processAndPublishMessage(
	lobby: Lobby,
	playerId: string,
	displayName: string,
	message: string,
): Promise<{ ok: boolean; reason?: string }> {
	// Reject whitespace-only messages
	const normalized = normalizeForAllowlist(message)
	if (normalized === null) {
		return { ok: false, reason: 'empty' }
	}

	if (!isAllowlisted(message)) {
		const result = await moderateMessage(message, playerId)
		if (!result.allowed) {
			return { ok: false, reason: 'moderated' }
		}
	}

	// Publish original message (user's casing/punctuation) via system MQTT client
	await mqttService.publishChatMessage(lobby.code, playerId, displayName, message)

	const sentAt = new Date()
	lobby.bufferMessage({ playerId, displayName, message, sentAt })

	// If this lobby is under an active report, persist the message immediately
	if (lobby.isReported) {
		await insertReportedLobbyMessage({
			lobbyId: lobby.id,
			lobbyCode: lobby.code,
			playerId,
			displayName,
			message,
			sentAt,
		})
	}

	return { ok: true }
}
