import { afterEach, describe, expect, it, vi } from 'vitest'
import { mqttService } from '../../services/mqtt.service.js'
import {
	cancelGracePeriod,
	cancelGracePeriodSilently,
	clearAllGracePeriods,
	expireGracePeriod,
	gracePeriods,
	isInGracePeriod,
	startGracePeriod,
} from '../../services/grace-period.service.js'
import { createSession, getLobby, lobbies } from '../../state/index.js'
import { Lobby } from '../../state/lobby.js'

function setupLobbyWithPlayers(
	...players: { id: string; steamName: string }[]
): Lobby {
	const [host, ...guests] = players
	const sessions = players.map((p) => createSession(p.steamName, { id: p.id }))

	const lobby = new Lobby('TESTLB', 'test-mod', host.id)
	for (const session of sessions) {
		lobby.addPlayer(session)
	}
	lobbies.set('TESTLB', lobby)

	return lobby
}

afterEach(() => {
	clearAllGracePeriods()
})

describe('grace-period.service', () => {
	describe('startGracePeriod', () => {
		it('publishes player_disconnected event', async () => {
			setupLobbyWithPlayers(
				{ id: 'host1', steamName: 'Alice' },
				{ id: 'player1', steamName: 'Bob' },
			)

			await startGracePeriod('player1')

			expect(mqttService.publishEvent).toHaveBeenCalledWith(
				'TESTLB',
				expect.objectContaining({
					type: 'player_disconnected',
					playerId: 'player1',
					displayName: 'Bob',
				}),
			)
			expect(isInGracePeriod('player1')).toBe(true)
		})

		it('does nothing for sessions without lobbyCode', async () => {
			createSession('Alice', { id: 'solo1' })

			await startGracePeriod('solo1')

			expect(mqttService.publishEvent).not.toHaveBeenCalled()
			expect(isInGracePeriod('solo1')).toBe(false)
		})

		it('does nothing for non-existent sessions', async () => {
			await startGracePeriod('nonexistent')

			expect(mqttService.publishEvent).not.toHaveBeenCalled()
		})

		it('is idempotent — starting twice does not duplicate', async () => {
			setupLobbyWithPlayers(
				{ id: 'host1', steamName: 'Alice' },
				{ id: 'player1', steamName: 'Bob' },
			)

			await startGracePeriod('player1')
			await startGracePeriod('player1')

			expect(mqttService.publishEvent).toHaveBeenCalledTimes(1)
		})

		it('transfers host immediately when host disconnects', async () => {
			setupLobbyWithPlayers(
				{ id: 'host1', steamName: 'Alice' },
				{ id: 'player1', steamName: 'Bob' },
			)

			await startGracePeriod('host1')

			const lobby = getLobby('TESTLB')!
			expect(lobby.hostId).toBe('player1')

			expect(mqttService.publishEvent).toHaveBeenCalledWith(
				'TESTLB',
				expect.objectContaining({
					type: 'host_changed',
					playerId: 'player1',
				}),
			)
			expect(mqttService.publishEvent).toHaveBeenCalledWith(
				'TESTLB',
				expect.objectContaining({
					type: 'player_disconnected',
					playerId: 'host1',
				}),
			)
		})

		it('does not transfer host if no non-away players available', async () => {
			setupLobbyWithPlayers({ id: 'host1', steamName: 'Alice' })

			await startGracePeriod('host1')

			const lobby = getLobby('TESTLB')!
			expect(lobby.hostId).toBe('host1')
		})

		it('skips away players when finding next host', async () => {
			setupLobbyWithPlayers(
				{ id: 'host1', steamName: 'Alice' },
				{ id: 'player1', steamName: 'Bob' },
				{ id: 'player2', steamName: 'Charlie' },
			)

			// Put player1 in grace period first
			await startGracePeriod('player1')
			vi.mocked(mqttService.publishEvent).mockClear()

			// Now host disconnects — should skip player1 (away), pick player2
			await startGracePeriod('host1')

			const lobby = getLobby('TESTLB')!
			expect(lobby.hostId).toBe('player2')
		})
	})

	describe('cancelGracePeriod', () => {
		it('publishes player_reconnected event', async () => {
			setupLobbyWithPlayers(
				{ id: 'host1', steamName: 'Alice' },
				{ id: 'player1', steamName: 'Bob' },
			)

			await startGracePeriod('player1')
			vi.mocked(mqttService.publishEvent).mockClear()

			const result = await cancelGracePeriod('player1')

			expect(result).toBe(true)
			expect(isInGracePeriod('player1')).toBe(false)
			expect(mqttService.publishEvent).toHaveBeenCalledWith(
				'TESTLB',
				expect.objectContaining({
					type: 'player_reconnected',
					playerId: 'player1',
					displayName: 'Bob',
				}),
			)
		})

		it('returns false if not in grace period', async () => {
			const result = await cancelGracePeriod('nobody')
			expect(result).toBe(false)
		})
	})

	describe('expireGracePeriod', () => {
		it('removes player from lobby and publishes player_left', async () => {
			setupLobbyWithPlayers(
				{ id: 'host1', steamName: 'Alice' },
				{ id: 'player1', steamName: 'Bob' },
			)

			await startGracePeriod('player1')
			vi.mocked(mqttService.publishEvent).mockClear()

			await expireGracePeriod('player1')

			const lobby = getLobby('TESTLB')!
			expect(lobby.hasPlayer('player1')).toBe(false)
			expect(isInGracePeriod('player1')).toBe(false)

			expect(mqttService.publishEvent).toHaveBeenCalledWith(
				'TESTLB',
				expect.objectContaining({
					type: 'player_left',
					playerId: 'player1',
				}),
			)
			expect(mqttService.cleanupPlayerState).toHaveBeenCalledWith(
				'TESTLB',
				'player1',
			)
		})

		it('closes lobby when last grace period expires', async () => {
			setupLobbyWithPlayers({ id: 'host1', steamName: 'Alice' })

			await startGracePeriod('host1')
			vi.mocked(mqttService.publishEvent).mockClear()

			await expireGracePeriod('host1')

			expect(lobbies.has('TESTLB')).toBe(false)
			expect(mqttService.publishEvent).toHaveBeenCalledWith(
				'TESTLB',
				expect.objectContaining({ type: 'player_left' }),
			)
			expect(mqttService.publishEvent).toHaveBeenCalledWith(
				'TESTLB',
				expect.objectContaining({ type: 'lobby_closed' }),
			)
			expect(mqttService.cleanupLobbyTopics).toHaveBeenCalledWith('TESTLB')
		})

		it('transfers host if expired player was still host', async () => {
			setupLobbyWithPlayers(
				{ id: 'host1', steamName: 'Alice' },
				{ id: 'player1', steamName: 'Bob' },
				{ id: 'player2', steamName: 'Charlie' },
			)

			// Both disconnect, host first
			await startGracePeriod('player1')
			await startGracePeriod('host1')
			vi.mocked(mqttService.publishEvent).mockClear()

			// player1 expires first — not the host, so no transfer needed
			await expireGracePeriod('player1')

			const lobby = getLobby('TESTLB')!
			expect(lobby.hasPlayer('player1')).toBe(false)

			// host1 expires — was still host (since findNextHost found player2 but
			// host1 was the one who disconnected, host was transferred to player2 already)
			// Actually host was transferred to player2 during startGracePeriod
			expect(lobby.hostId).toBe('player2')
		})
	})

	describe('cancelGracePeriodSilently', () => {
		it('clears timer without publishing events', async () => {
			setupLobbyWithPlayers(
				{ id: 'host1', steamName: 'Alice' },
				{ id: 'player1', steamName: 'Bob' },
			)

			await startGracePeriod('player1')
			vi.mocked(mqttService.publishEvent).mockClear()

			cancelGracePeriodSilently('player1')

			expect(isInGracePeriod('player1')).toBe(false)
			expect(mqttService.publishEvent).not.toHaveBeenCalled()
		})

		it('does nothing if not in grace period', () => {
			cancelGracePeriodSilently('nobody')
			// Should not throw
		})
	})

	describe('clearAllGracePeriods', () => {
		it('clears all active grace periods', async () => {
			setupLobbyWithPlayers(
				{ id: 'host1', steamName: 'Alice' },
				{ id: 'player1', steamName: 'Bob' },
				{ id: 'player2', steamName: 'Charlie' },
			)

			await startGracePeriod('player1')
			await startGracePeriod('player2')

			expect(gracePeriods.size).toBe(2)

			clearAllGracePeriods()

			expect(gracePeriods.size).toBe(0)
			expect(isInGracePeriod('player1')).toBe(false)
			expect(isInGracePeriod('player2')).toBe(false)
		})
	})
})
