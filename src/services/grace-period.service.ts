import { getSession, getLobby, lobbies, removeSession } from '../state/index.js'
import { mqttService } from './mqtt.service.js'

const GRACE_PERIOD_MS = 2 * 60 * 1000 // 2 minutes

interface GracePeriodEntry {
	playerId: string
	lobbyCode: string
	username: string
	disconnectedAt: Date
	timer: ReturnType<typeof setTimeout>
}

const gracePeriods = new Map<string, GracePeriodEntry>()

export async function startGracePeriod(playerId: string): Promise<void> {
	const session = getSession(playerId)
	if (!session || !session.lobbyCode) return

	if (gracePeriods.has(playerId)) return

	const lobby = getLobby(session.lobbyCode)
	if (!lobby) return

	// If player is host and lobby has other non-away players, transfer host immediately
	if (lobby.hostId === playerId) {
		const newHostId = findNextHost(lobby, playerId)
		if (newHostId) {
			lobby.hostId = newHostId
			await mqttService.publishEvent(lobby.code, {
				type: 'host_changed',
				lobbyCode: lobby.code,
				playerId: newHostId,
				timestamp: new Date().toISOString(),
			})
		}
	}

	const timer = setTimeout(() => {
		expireGracePeriod(playerId)
	}, GRACE_PERIOD_MS)
	timer.unref()

	gracePeriods.set(playerId, {
		playerId,
		lobbyCode: session.lobbyCode,
		username: session.username,
		disconnectedAt: new Date(),
		timer,
	})

	await mqttService.publishEvent(session.lobbyCode, {
		type: 'player_disconnected',
		lobbyCode: session.lobbyCode,
		playerId,
		username: session.username,
		timestamp: new Date().toISOString(),
	})
}

export async function cancelGracePeriod(playerId: string): Promise<boolean> {
	const entry = gracePeriods.get(playerId)
	if (!entry) return false

	clearTimeout(entry.timer)
	gracePeriods.delete(playerId)

	await mqttService.publishEvent(entry.lobbyCode, {
		type: 'player_reconnected',
		lobbyCode: entry.lobbyCode,
		playerId: entry.playerId,
		username: entry.username,
		timestamp: new Date().toISOString(),
	})

	return true
}

async function expireGracePeriod(playerId: string): Promise<void> {
	const entry = gracePeriods.get(playerId)
	if (!entry) return

	gracePeriods.delete(playerId)

	const lobby = getLobby(entry.lobbyCode)
	if (!lobby) {
		removeSession(playerId)
		return
	}

	lobby.removePlayer(playerId)

	await mqttService.cleanupPlayerState(entry.lobbyCode, playerId)

	await mqttService.publishEvent(entry.lobbyCode, {
		type: 'player_left',
		lobbyCode: entry.lobbyCode,
		playerId: entry.playerId,
		username: entry.username,
		timestamp: new Date().toISOString(),
	})

	// Handle host transfer if this player was still host (edge case)
	if (lobby.hostId === playerId) {
		if (lobby.isEmpty) {
			await mqttService.publishEvent(entry.lobbyCode, {
				type: 'lobby_closed',
				lobbyCode: entry.lobbyCode,
				timestamp: new Date().toISOString(),
			})
			await mqttService.cleanupLobbyTopics(entry.lobbyCode)
			lobbies.delete(entry.lobbyCode)
			return
		}

		const newHostId = lobby.players.keys().next().value!
		lobby.hostId = newHostId
		await mqttService.publishEvent(entry.lobbyCode, {
			type: 'host_changed',
			lobbyCode: entry.lobbyCode,
			playerId: newHostId,
			timestamp: new Date().toISOString(),
		})
	}

	if (lobby.isEmpty) {
		await mqttService.publishEvent(entry.lobbyCode, {
			type: 'lobby_closed',
			lobbyCode: entry.lobbyCode,
			timestamp: new Date().toISOString(),
		})
		await mqttService.cleanupLobbyTopics(entry.lobbyCode)
		lobbies.delete(entry.lobbyCode)
	}
}

export function cancelGracePeriodSilently(playerId: string): void {
	const entry = gracePeriods.get(playerId)
	if (!entry) return

	clearTimeout(entry.timer)
	gracePeriods.delete(playerId)
}

export function isInGracePeriod(playerId: string): boolean {
	return gracePeriods.has(playerId)
}

export function clearAllGracePeriods(): void {
	for (const entry of gracePeriods.values()) {
		clearTimeout(entry.timer)
	}
	gracePeriods.clear()
}

// Exported for tests
export { gracePeriods, expireGracePeriod }

function findNextHost(
	lobby: { players: Map<string, unknown> },
	excludePlayerId: string,
): string | undefined {
	for (const id of lobby.players.keys()) {
		if (id !== excludePlayerId && !gracePeriods.has(id)) {
			return id
		}
	}
	return undefined
}
