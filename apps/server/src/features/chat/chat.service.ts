import {
	insertFlaggedMessage,
	insertReportedLobbyMessage,
} from '../../infrastructure/gateways/chat.gateway.js'
import { logChat } from '../../infrastructure/gateways/history.gateway.js'
import {
	callModerationService,
	isModerationBridgeEnabled,
} from '../../infrastructure/gateways/moderation.gateway.js'
import { mqttService } from '../../infrastructure/mqtt/mqtt.service.js'
import { getConfig } from '../../state/config.js'
import type { Lobby } from '../../state/lobby.js'
import { decideModerationOutcome } from './moderation.js'
import { normalizeForAllowlist } from './normalization.js'
import { moderateMessage } from './obscenity.js'

export type ChatBlockReason =
	| 'empty'
	| 'moderated'
	| 'unavailable'

export type ChatResult =
	| { ok: true; publishText?: string }
	| { ok: false; reason: ChatBlockReason }

function isAllowlisted(message: string): boolean {
	const key = normalizeForAllowlist(message)
	if (key === null) return false
	// Curation invariant (link-free, rewrite-neutral) documented at the load
	// site: infrastructure/gateways/config.gateway.ts.
	return getConfig().chatAllowlist.has(key)
}

export async function processAndPublishMessage(
	lobby: Lobby,
	playerId: string,
	displayName: string,
	message: string,
	steamIdHash: string | null = null,
): Promise<ChatResult> {
	const normalized = normalizeForAllowlist(message)
	if (normalized === null) {
		return { ok: false, reason: 'empty' }
	}

	// textToPublish may be rewritten by the moderation service; message (the
	// original typed text) always goes to the evidence buffer/report DB — a
	// rewrite must never launder what the player actually typed.
	let textToPublish = message

	if (!isAllowlisted(message)) {
		// Dormant when MODERATION_SERVICE_URL is unset — chat keeps using the
		// local obscenity filter, unchanged.
		if (isModerationBridgeEnabled()) {
			// No displayName: the service has no use for it, and a name is
			// needless identity to hand a component that only judges text.
			const attempt = await callModerationService({
				playerId,
				lobbyCode: lobby.code,
				message,
			})
			const outcome = decideModerationOutcome(attempt)
			if (!outcome.allowed) {
				// The remote service logs no message content by design, and this
				// branch bypasses the local obscenity filter's own evidence write
				// below — without this, a remotely-blocked message would exist
				// nowhere at all. Never blocking on it: a DB hiccup here must not
				// turn a moderation block into a 500.
				if (outcome.reason === 'moderated') {
					try {
						await insertFlaggedMessage(playerId, message, {
							source: 'remote',
							band: outcome.band ?? 'unknown',
						})
					} catch (err) {
						console.error(
							'[moderation] failed to record a remotely-blocked message as evidence:',
							err,
						)
					}
				}
				return { ok: false, reason: outcome.reason }
			}
			textToPublish = outcome.publishText ?? message
		} else {
			const result = await moderateMessage(message, playerId)
			if (!result.allowed) {
				return { ok: false, reason: 'moderated' }
			}
		}
	}

	await mqttService.publishChatMessage(
		lobby.code,
		playerId,
		displayName,
		textToPublish,
	)

	const sentAt = new Date()
	lobby.bufferMessage({ playerId, displayName, message, sentAt })

	await logChat(lobby.code, playerId, message, steamIdHash)

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

	// Only when a rewrite happened: the sender's client shows what other
	// players actually received, so a rewrite is never silent.
	if (textToPublish !== message) {
		return { ok: true, publishText: textToPublish }
	}
	return { ok: true }
}
