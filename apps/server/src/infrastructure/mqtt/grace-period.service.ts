import { syncMatchLobbyState } from '../../features/matchmaking/matchmaking.service.js'
import { replayLogService } from '../../features/replay-log/replay-log.service.js'
import {
	getLobby,
	getSession,
	lobbies,
	removeSession,
} from '../../state/index.js'
import { matchByLobby } from '../../state/matchmaking.js'
import { mqttService } from './mqtt.service.js'

const GRACE_PERIOD_MS = 2 * 60 * 1000 // 2 minutes

interface GracePeriodEntry {
	playerId: string
	lobbyCode: string
	displayName: string
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
			if (lobby.type === 'public') {
				await syncMatchLobbyState(lobby.code)
			}
		}
	}

	const timer = setTimeout(() => {
		expireGracePeriod(playerId)
	}, GRACE_PERIOD_MS)
	timer.unref()

	gracePeriods.set(playerId, {
		playerId,
		lobbyCode: session.lobbyCode,
		displayName: session.getDisplayName(),
		disconnectedAt: new Date(),
		timer,
	})

	await mqttService.publishEvent(session.lobbyCode, {
		type: 'player_disconnected',
		lobbyCode: session.lobbyCode,
		playerId,
		displayName: session.getDisplayName(),
		timestamp: new Date().toISOString(),
	})

	// §7.8: if this disconnect leaves no still-connected player in the lobby
	// (every remaining member is now away), tear it down right now instead of
	// making each of them separately wait out their own 2-minute timer first.
	// expireGracePeriod already does the real teardown (remove player, ranked
	// auto-forfeit, cleanup, lobby_closed + finalizeRun) and itself closes the
	// lobby once the last player is removed, so calling it directly for every
	// currently-away member is sufficient -- no separate teardown path needed.
	const allAway = lobby.players.size > 0 && [...lobby.players.keys()].every((id) => gracePeriods.has(id))
	if (allAway) {
		for (const id of [...lobby.players.keys()]) {
			const awayEntry = gracePeriods.get(id)
			if (awayEntry) clearTimeout(awayEntry.timer)
			await expireGracePeriod(id)
		}
	}
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
		displayName: entry.displayName,
		timestamp: new Date().toISOString(),
	})

	await pushReplayCatchUp(entry.lobbyCode, playerId)

	return true
}

// §22.5: the reconnecting client catches up over MQTT -- the same channel
// every other action already flows through -- instead of pulling a REST
// endpoint itself. The server already knows the instant a player reconnects
// (right here), so it pushes each other player's buffered tail directly
// rather than waiting for the client to ask. MQTT doesn't backlog
// non-retained messages, so this still has to read from the same live
// in-memory run buffer replay/anti-cheat already use, not a retained topic --
// only the transport (push vs. a REST pull) changes.
async function pushReplayCatchUp(lobbyCode: string, reconnectedPlayerId: string): Promise<void> {
	const lobby = getLobby(lobbyCode)
	if (!lobby) return

	const tails = [...lobby.players.keys()]
		.filter((id) => id !== reconnectedPlayerId)
		.map((id) => ({ playerId: id, events: replayLogService.getTail(lobbyCode, id, 0) }))
		.filter((tail) => tail.events.length > 0)

	if (tails.length === 0) return

	await mqttService.publishToPlayer(reconnectedPlayerId, 'replay-tail', {
		type: 'replay_tail',
		tails,
		timestamp: new Date().toISOString(),
	})
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

	// Match auto-forfeit: the disconnected player loses on time -- ranked
	// applies ELO as a loss/win exactly like a normal reportResult, casual
	// just records the result (autoForfeitMatch branches on isRanked itself,
	// see matchmaking.service.ts). Dynamically imports routes/index.js (the
	// composition root, which holds the fully wired matchmakingService
	// singleton) rather than a static import, since routes/index.ts already
	// statically imports this module (as gracePeriodService) -- a static
	// import back would be a real cycle. By the time a grace period actually
	// expires (minutes after startup), routes/index.ts has long since
	// finished evaluating, so this is safe. matchByLobby only holds
	// ranked+casual matchmaking matches, so this is a no-op for practice/
	// private lobbies.
	const match = matchByLobby.get(entry.lobbyCode)
	if (match) {
		const remaining = [...lobby.players.keys()].filter((id) => !gracePeriods.has(id))
		const { matchmakingService } = await import('../../routes/index.js')
		await matchmakingService.autoForfeitMatch(match.matchId, playerId, remaining)
	}

	await mqttService.cleanupPlayerState(entry.lobbyCode, playerId)

	await mqttService.publishEvent(entry.lobbyCode, {
		type: 'player_left',
		lobbyCode: entry.lobbyCode,
		playerId: entry.playerId,
		displayName: entry.displayName,
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
			await replayLogService.finalizeRun(entry.lobbyCode, 'abandoned')
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
		if (lobby.type === 'public') {
			await syncMatchLobbyState(entry.lobbyCode)
		}
	}

	if (lobby.isEmpty) {
		await mqttService.publishEvent(entry.lobbyCode, {
			type: 'lobby_closed',
			lobbyCode: entry.lobbyCode,
			timestamp: new Date().toISOString(),
		})
		await mqttService.cleanupLobbyTopics(entry.lobbyCode)
		lobbies.delete(entry.lobbyCode)
		await replayLogService.finalizeRun(entry.lobbyCode, 'abandoned')
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
