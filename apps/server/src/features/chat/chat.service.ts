import { getConfig } from '../../state/config.js'
import type { Lobby } from '../../state/lobby.js'
import { mqttService } from '../../infrastructure/mqtt/mqtt.service.js'
import { insertReportedLobbyMessage } from '../../infrastructure/gateways/chat.gateway.js'
import { normalizeForAllowlist } from './normalization.js'
import { moderateMessage } from './obscenity.js'

function isAllowlisted(message: string): boolean {
	const key = normalizeForAllowlist(message)
	if (key === null) return false
	return getConfig().chatAllowlist.has(key)
}

export async function processAndPublishMessage(
	lobby: Lobby,
	playerId: string,
	displayName: string,
	message: string,
): Promise<{ ok: boolean; reason?: string }> {
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

	await mqttService.publishChatMessage(lobby.code, playerId, displayName, message)

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

	return { ok: true }
}
