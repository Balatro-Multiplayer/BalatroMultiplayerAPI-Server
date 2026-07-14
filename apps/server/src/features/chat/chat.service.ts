import { insertReportedLobbyMessage } from '../../infrastructure/gateways/chat.gateway.js'
import {
	type ModerationBridge,
	moderateRemote,
	moderationBridge,
} from '../../infrastructure/gateways/moderation.gateway.js'
import { mqttService } from '../../infrastructure/mqtt/mqtt.service.js'
import { getConfig } from '../../state/config.js'
import type { Lobby } from '../../state/lobby.js'
import { type ChatResult, decideDelivery } from './moderation-policy.js'
import { normalizeForAllowlist } from './normalization.js'
import { moderateMessage } from './obscenity.js'

export type { ChatResult } from './moderation-policy.js'

function isAllowlisted(message: string): boolean {
	const key = normalizeForAllowlist(message)
	if (key === null) return false
	return getConfig().chatAllowlist.has(key)
}

// Outage diagnostics without per-message log spam: one line per cause per
// window is enough to tell an expired token (http_401) from a dead service.
let lastOutageLog = { cause: '', at: 0 }
function logOutage(cause: string): void {
	const now = Date.now()
	if (cause === lastOutageLog.cause && now - lastOutageLog.at < 30_000) return
	lastOutageLog = { cause, at: now }
	console.error(
		`[chat] moderation service unreachable (${cause}) — failing closed`,
	)
}

export async function processAndPublishMessage(
	lobby: Lobby,
	playerId: string,
	displayName: string,
	message: string,
	// Injectable for tests; production uses the env-configured bridge (parsed
	// once at boot). null = legacy local pipeline.
	bridge: ModerationBridge | null = moderationBridge(),
): Promise<ChatResult> {
	const normalized = normalizeForAllowlist(message)
	if (normalized === null) {
		return { ok: false, reason: 'empty' }
	}

	// What gets published to other players. The moderation service may return a
	// rewritten form; the original `message` is still what lands in the
	// reported-lobby evidence buffer below.
	let publishText = message

	if (bridge) {
		const outcome = await moderateRemote(
			{ playerId, displayName, lobbyCode: lobby.code, message },
			bridge,
		)
		if (outcome.status === 'unreachable') logOutage(outcome.cause)

		const delivery = decideDelivery(
			outcome,
			message,
			isAllowlisted(message),
			bridge.outagePolicy,
		)
		if (delivery.action === 'reject') return delivery.rejection
		publishText = delivery.text
	} else if (!isAllowlisted(message)) {
		// Legacy local pipeline (no moderation service configured).
		const result = await moderateMessage(message, playerId)
		if (!result.allowed) {
			return { ok: false, reason: 'moderated' }
		}
	}

	await mqttService.publishChatMessage(
		lobby.code,
		playerId,
		displayName,
		publishText,
	)

	// Evidence trail keeps what the player actually typed — a rewrite must
	// never launder the record a moderator later reviews.
	const sentAt = new Date()
	lobby.bufferMessage({ playerId, displayName, message, sentAt })

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

	return {
		ok: true,
		...(publishText !== message ? { publishText } : {}),
	}
}
