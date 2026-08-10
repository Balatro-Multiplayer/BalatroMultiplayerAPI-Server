import { describe, expect, it, vi } from 'vitest'
import { createLobbyService } from '../../features/lobby/lobby.service.js'
import { createSession, lobbies } from '../../state/index.js'
import type { JwtPayload } from '../../shared/types/index.js'
import { verifyJwt } from '../../features/auth/jwt.js'
import type { IMessageBus } from '../../contracts/IMessageBus.js'
import type { IGracePeriodService } from '../../contracts/IGracePeriodService.js'
import type { IMatchmakingCoordinator } from '../../contracts/IMatchmakingCoordinator.js'

function makePlayer(id: string, steamName: string): JwtPayload {
	createSession(steamName, { id })
	return { playerId: id, steamName }
}

function makeMockMessageBus(): IMessageBus {
	return {
		publishEvent: vi.fn().mockResolvedValue(undefined),
		publishMetadata: vi.fn().mockResolvedValue(undefined),
		publishPlayerInfo: vi.fn().mockResolvedValue(undefined),
		publishToPlayer: vi.fn().mockResolvedValue(undefined),
		clearPlayerInfo: vi.fn().mockResolvedValue(undefined),
		cleanupLobbyTopics: vi.fn().mockResolvedValue(undefined),
		cleanupPlayerState: vi.fn().mockResolvedValue(undefined),
		publishChatMessage: vi.fn().mockResolvedValue(undefined),
		publishModUpdate: vi.fn().mockResolvedValue(undefined),
	}
}

function makeMockGracePeriodService(): IGracePeriodService {
	return {
		cancelGracePeriod: vi.fn().mockResolvedValue(true),
		cancelGracePeriodSilently: vi.fn(),
		isInGracePeriod: vi.fn().mockReturnValue(false),
		clearAllGracePeriods: vi.fn(),
	}
}

function makeMockMatchmakingCoordinator(): IMatchmakingCoordinator {
	return {
		updateGroupQueueOnLobbyJoin: vi.fn().mockResolvedValue(undefined),
		removeGroupQueueForLobby: vi.fn(),
		syncMatchLobbyState: vi.fn().mockResolvedValue(undefined),
		forfeitMatchForLeave: vi.fn().mockResolvedValue(undefined),
	}
}

describe('lobby.service', () => {
	describe('createLobby', () => {
		it('creates a lobby and makes the player the host', async () => {
			const messageBus = makeMockMessageBus()
			const service = createLobbyService({
				messageBus,
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})

			const player = makePlayer('host1', 'Alice')
			const { lobby, token } = await service.createLobby(player, 'cool_mod')

			expect(lobby.code).toHaveLength(6)
			expect(lobby.modId).toBe('cool_mod')
			expect(lobby.hostId).toBe('host1')
			expect(lobby.hasPlayer('host1')).toBe(true)
			expect(lobbies.has(lobby.code)).toBe(true)

			const decoded = verifyJwt(token)
			expect(decoded?.lobbyCode).toBe(lobby.code)
		})

		it('throws if player session does not exist', async () => {
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const player = { playerId: 'nobody', steamName: 'Ghost' }
			await expect(service.createLobby(player, 'mod1')).rejects.toThrow(
				'Player session not found',
			)
		})

		it('throws if player is already in a lobby', async () => {
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const player = makePlayer('host1', 'Alice')
			await service.createLobby(player, 'mod1')
			await expect(service.createLobby(player, 'mod2')).rejects.toThrow(
				'Already in a lobby',
			)
		})

		it('self-heals when session.lobbyCode references a lobby that no longer exists', async () => {
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const player = makePlayer('host1', 'Alice')
			const { lobby: staleLobby } = await service.createLobby(player, 'mod1')

			// Simulate the lobby being torn down through a path that didn't clear
			// session.lobbyCode (e.g. a raced grace-period expiry) instead of a
			// normal leaveLobby call.
			lobbies.delete(staleLobby.code)

			const { lobby: newLobby } = await service.createLobby(player, 'mod2')
			expect(newLobby.code).not.toBe(staleLobby.code)
			expect(lobbies.has(newLobby.code)).toBe(true)
		})

		it('creates lobby with custom maxPlayers', async () => {
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const player = makePlayer('host1', 'Alice')
			const { lobby } = await service.createLobby(player, 'cool_mod', 4)

			expect(lobby.maxPlayers).toBe(4)
		})

		it('defaults maxPlayers to 16', async () => {
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const player = makePlayer('host1', 'Alice')
			const { lobby } = await service.createLobby(player, 'cool_mod')

			expect(lobby.maxPlayers).toBe(16)
		})
	})

	describe('joinLobby', () => {
		it('adds a player to an existing lobby', async () => {
			const messageBus = makeMockMessageBus()
			const service = createLobbyService({
				messageBus,
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})

			const host = makePlayer('host1', 'Alice')
			const { lobby } = await service.createLobby(host, 'mod1')

			const guest = makePlayer('guest1', 'Bob')
			const result = await service.joinLobby(guest, lobby.code)

			expect(result.lobby.hasPlayer('guest1')).toBe(true)
			expect(result.lobby.playerCount).toBe(2)

			expect(messageBus.publishEvent).toHaveBeenCalledWith(
				lobby.code,
				expect.objectContaining({ type: 'player_joined', playerId: 'guest1' }),
			)
		})

		it('throws if lobby does not exist', async () => {
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const player = makePlayer('p1', 'Alice')
			await expect(service.joinLobby(player, 'ZZZZZ')).rejects.toThrow(
				'Lobby not found',
			)
		})

		it('throws if player is already in a lobby', async () => {
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await service.createLobby(host, 'mod1')

			const guest = makePlayer('guest1', 'Bob')
			await service.joinLobby(guest, lobby.code)
			await expect(service.joinLobby(guest, lobby.code)).rejects.toThrow(
				'Already in a lobby',
			)
		})

		it('self-heals when session.lobbyCode references a lobby that no longer exists', async () => {
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const playerA = makePlayer('playerA', 'Alice')
			const { lobby: staleLobby } = await service.createLobby(playerA, 'mod1')
			lobbies.delete(staleLobby.code)

			const playerB = makePlayer('playerB', 'Bob')
			const { lobby: realLobby } = await service.createLobby(playerB, 'mod1')

			const { lobby: joinedLobby } = await service.joinLobby(playerA, realLobby.code)
			expect(joinedLobby.code).toBe(realLobby.code)
			expect(joinedLobby.hasPlayer('playerA')).toBe(true)
		})

		it('throws when lobby is full', async () => {
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await service.createLobby(host, 'mod1', 2)

			const guest1 = makePlayer('guest1', 'Bob')
			await service.joinLobby(guest1, lobby.code)

			const guest2 = makePlayer('guest2', 'Charlie')
			await expect(service.joinLobby(guest2, lobby.code)).rejects.toThrow(
				'Lobby is full',
			)
		})
	})

	describe('leaveLobby', () => {
		it('removes a guest from the lobby', async () => {
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await service.createLobby(host, 'mod1')
			const guest = makePlayer('guest1', 'Bob')
			await service.joinLobby(guest, lobby.code)

			const { token } = await service.leaveLobby(guest, lobby.code)

			expect(lobby.hasPlayer('guest1')).toBe(false)
			expect(lobby.playerCount).toBe(1)

			const decoded = verifyJwt(token)
			expect(decoded?.lobbyCode).toBeUndefined()
		})

		it('forfeits any active match for this lobby, passing the remaining connected players', async () => {
			const matchmakingCoordinator = makeMockMatchmakingCoordinator()
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator,
			})
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await service.createLobby(host, 'mod1')
			const guest = makePlayer('guest1', 'Bob')
			await service.joinLobby(guest, lobby.code)

			await service.leaveLobby(guest, lobby.code)

			expect(matchmakingCoordinator.forfeitMatchForLeave).toHaveBeenCalledWith(
				lobby.code,
				'guest1',
				['host1'],
			)
		})

		it('excludes a player currently in their disconnect grace period from "remaining connected"', async () => {
			const gracePeriodService = makeMockGracePeriodService()
			vi.mocked(gracePeriodService.isInGracePeriod).mockImplementation(
				(playerId) => playerId === 'guest2',
			)
			const matchmakingCoordinator = makeMockMatchmakingCoordinator()
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService,
				matchmakingCoordinator,
			})
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await service.createLobby(host, 'mod1')
			const guest1 = makePlayer('guest1', 'Bob')
			await service.joinLobby(guest1, lobby.code)
			const guest2 = makePlayer('guest2', 'Carol')
			await service.joinLobby(guest2, lobby.code)

			await service.leaveLobby(host, lobby.code)

			expect(matchmakingCoordinator.forfeitMatchForLeave).toHaveBeenCalledWith(
				lobby.code,
				'host1',
				['guest1'],
			)
		})

		it('transfers host when host leaves with players remaining', async () => {
			const messageBus = makeMockMessageBus()
			const service = createLobbyService({
				messageBus,
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await service.createLobby(host, 'mod1')
			const guest = makePlayer('guest1', 'Bob')
			await service.joinLobby(guest, lobby.code)

			await service.leaveLobby(host, lobby.code)

			expect(lobby.hostId).toBe('guest1')
			expect(messageBus.publishEvent).toHaveBeenCalledWith(
				lobby.code,
				expect.objectContaining({
					type: 'host_changed',
					playerId: 'guest1',
				}),
			)
		})

		it('closes the lobby when last player leaves', async () => {
			const messageBus = makeMockMessageBus()
			const service = createLobbyService({
				messageBus,
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await service.createLobby(host, 'mod1')
			const code = lobby.code

			await service.leaveLobby(host, code)

			expect(lobbies.has(code)).toBe(false)
			expect(messageBus.cleanupLobbyTopics).toHaveBeenCalledWith(code, expect.any(Array))
		})

		it('throws if lobby does not exist', async () => {
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const player = makePlayer('p1', 'Alice')
			await expect(service.leaveLobby(player, 'ZZZZZ')).rejects.toThrow(
				'Lobby not found',
			)
		})

		it('throws if player is not in the lobby', async () => {
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await service.createLobby(host, 'mod1')
			const outsider = makePlayer('outsider', 'Eve')

			await expect(service.leaveLobby(outsider, lobby.code)).rejects.toThrow(
				'Not in this lobby',
			)
		})

		it('clears the stale session reference even though the lobby is already gone', async () => {
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const player = makePlayer('host1', 'Alice')
			const { lobby } = await service.createLobby(player, 'mod1')
			lobbies.delete(lobby.code)

			await expect(service.leaveLobby(player, lobby.code)).rejects.toThrow(
				'Lobby not found',
			)

			// The session is no longer stuck pointing at the deleted lobby -- a
			// fresh create succeeds without needing a relaunch.
			const { lobby: newLobby } = await service.createLobby(player, 'mod2')
			expect(lobbies.has(newLobby.code)).toBe(true)
		})
	})

	describe('kickPlayer', () => {
		it('host kicks a guest: removed from roster, added to kickedPlayerIds, event published', async () => {
			const messageBus = makeMockMessageBus()
			const gracePeriodService = makeMockGracePeriodService()
			const service = createLobbyService({
				messageBus,
				gracePeriodService,
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await service.createLobby(host, 'mod1')
			const guest = makePlayer('guest1', 'Bob')
			await service.joinLobby(guest, lobby.code)

			await service.kickPlayer(host, lobby.code, 'guest1')

			expect(lobby.hasPlayer('guest1')).toBe(false)
			expect(lobby.kickedPlayerIds.has('guest1')).toBe(true)
			expect(gracePeriodService.cancelGracePeriodSilently).toHaveBeenCalledWith('guest1')
			expect(messageBus.publishEvent).toHaveBeenCalledWith(
				lobby.code,
				expect.objectContaining({
					type: 'player_kicked',
					playerId: 'guest1',
					data: { kickedBy: 'host1' },
				}),
			)
			expect(messageBus.clearPlayerInfo).toHaveBeenCalledWith(lobby.code, 'guest1')
			expect(messageBus.cleanupPlayerState).toHaveBeenCalledWith(lobby.code, 'guest1')
		})

		it('denies a non-host from kicking, with no state mutation', async () => {
			const messageBus = makeMockMessageBus()
			const service = createLobbyService({
				messageBus,
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await service.createLobby(host, 'mod1')
			const guest = makePlayer('guest1', 'Bob')
			await service.joinLobby(guest, lobby.code)

			await expect(
				service.kickPlayer(guest, lobby.code, 'host1'),
			).rejects.toThrow('Only the host can kick players')

			expect(lobby.hasPlayer('host1')).toBe(true)
			expect(lobby.hasPlayer('guest1')).toBe(true)
			expect(lobby.kickedPlayerIds.size).toBe(0)
			expect(messageBus.publishEvent).not.toHaveBeenCalledWith(
				lobby.code,
				expect.objectContaining({ type: 'player_kicked' }),
			)
		})

		it('denies the host from kicking themselves', async () => {
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await service.createLobby(host, 'mod1')

			await expect(
				service.kickPlayer(host, lobby.code, 'host1'),
			).rejects.toThrow('Cannot kick yourself')
		})

		it('throws if the target is not in the lobby', async () => {
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await service.createLobby(host, 'mod1')

			await expect(
				service.kickPlayer(host, lobby.code, 'nobody'),
			).rejects.toThrow('Player not in this lobby')
		})

		it('throws if the lobby does not exist', async () => {
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const host = makePlayer('host1', 'Alice')
			await expect(
				service.kickPlayer(host, 'ZZZZZ', 'guest1'),
			).rejects.toThrow('Lobby not found')
		})

		it('calls forfeitMatchForLeave with the target id and remaining connected players', async () => {
			const matchmakingCoordinator = makeMockMatchmakingCoordinator()
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator,
			})
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await service.createLobby(host, 'mod1')
			const guest = makePlayer('guest1', 'Bob')
			await service.joinLobby(guest, lobby.code)

			await service.kickPlayer(host, lobby.code, 'guest1')

			expect(matchmakingCoordinator.forfeitMatchForLeave).toHaveBeenCalledWith(
				lobby.code,
				'guest1',
				['host1'],
			)
		})

		it('a kicked player cannot rejoin the lobby', async () => {
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await service.createLobby(host, 'mod1')
			const guest = makePlayer('guest1', 'Bob')
			await service.joinLobby(guest, lobby.code)

			await service.kickPlayer(host, lobby.code, 'guest1')

			await expect(service.joinLobby(guest, lobby.code)).rejects.toThrow(
				'You have been kicked from this lobby',
			)
		})

		it('a stale (former) host cannot kick after host has transferred away', async () => {
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await service.createLobby(host, 'mod1')
			const guest = makePlayer('guest1', 'Bob')
			await service.joinLobby(guest, lobby.code)

			await service.leaveLobby(host, lobby.code)
			expect(lobby.hostId).toBe('guest1')

			await expect(
				service.kickPlayer(host, lobby.code, 'guest1'),
			).rejects.toThrow('Only the host can kick players')
		})
	})

	describe('getLobbyInfo', () => {
		it('returns the lobby', async () => {
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await service.createLobby(host, 'mod1')

			const info = service.getLobbyInfo(lobby.code)
			expect(info.code).toBe(lobby.code)
		})

		it('throws for unknown code', () => {
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			expect(() => service.getLobbyInfo('ZZZZZ')).toThrow('Lobby not found')
		})
	})

	describe('getLobbyPlayers', () => {
		it('returns player list', async () => {
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await service.createLobby(host, 'mod1')
			const guest = makePlayer('guest1', 'Bob')
			await service.joinLobby(guest, lobby.code)

			const players = service.getLobbyPlayers(lobby.code)
			expect(players).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ id: 'host1', displayName: 'Alice', isAway: false }),
					expect.objectContaining({ id: 'guest1', displayName: 'Bob', isAway: false }),
				]),
			)
		})
	})

	describe('setMetadata', () => {
		it('allows host to set metadata', async () => {
			const messageBus = makeMockMessageBus()
			const service = createLobbyService({
				messageBus,
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await service.createLobby(host, 'mod1')

			const result = await service.setMetadata(host, lobby.code, { ante: 1 })

			expect(result).toEqual({ ante: 1 })
			expect(lobby.metadata).toEqual({ ante: 1 })
			expect(messageBus.publishMetadata).toHaveBeenCalledWith(
				lobby.code,
				{ ante: 1 },
			)
		})

		it('merges with existing metadata', async () => {
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await service.createLobby(host, 'mod1')

			await service.setMetadata(host, lobby.code, { ante: 1 })
			const result = await service.setMetadata(host, lobby.code, { stake: 'gold' })

			expect(result).toEqual({ ante: 1, stake: 'gold' })
		})

		it('denies non-host from setting metadata', async () => {
			const service = createLobbyService({
				messageBus: makeMockMessageBus(),
				gracePeriodService: makeMockGracePeriodService(),
				matchmakingCoordinator: makeMockMatchmakingCoordinator(),
			})
			const host = makePlayer('host1', 'Alice')
			const { lobby } = await service.createLobby(host, 'mod1')
			const guest = makePlayer('guest1', 'Bob')
			await service.joinLobby(guest, lobby.code)

			await expect(
				service.setMetadata(guest, lobby.code, { ante: 99 }),
			).rejects.toThrow('Only the host can set metadata')
		})
	})
})
