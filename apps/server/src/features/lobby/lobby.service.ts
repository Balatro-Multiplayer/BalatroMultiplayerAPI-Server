import type { IGracePeriodService } from '../../contracts/IGracePeriodService.js'
import type { IMatchmakingCoordinator } from '../../contracts/IMatchmakingCoordinator.js'
import type { IMessageBus } from '../../contracts/IMessageBus.js'
import type { JwtPayload } from '../../shared/types/index.js'
import { AppError } from '../../shared/utils/errors.js'
import { generateLobbyCode } from '../../shared/utils/lobby-code.js'
import { Lobby, getLobby, getSession, lobbies } from '../../state/index.js'
import { signJwt } from '../auth/jwt.js'
import { replayLogService } from '../replay-log/replay-log.service.js'

interface LobbyServiceDeps {
	messageBus: IMessageBus
	gracePeriodService: IGracePeriodService
	matchmakingCoordinator: IMatchmakingCoordinator
}

export type LobbyService = ReturnType<typeof createLobbyService>

export function createLobbyService(deps: LobbyServiceDeps) {
	const { messageBus, gracePeriodService, matchmakingCoordinator } = deps

	async function createLobby(
		player: JwtPayload,
		modId: string,
		maxPlayers?: number,
	) {
		const session = getSession(player.playerId)
		if (!session) throw new AppError('Player session not found', 401)

		if (session.lobbyCode) throw new AppError('Already in a lobby', 409)

		let code: string
		let attempts = 0
		do {
			code = generateLobbyCode()
			if (!lobbies.has(code)) break
			attempts++
		} while (attempts < 10)

		if (attempts >= 10)
			throw new AppError('Failed to generate unique lobby code', 500)

		const lobby = new Lobby(code, modId, player.playerId, maxPlayers, 'private')
		lobby.addPlayer(session)
		lobbies.set(code, lobby)

		await messageBus.publishPlayerInfo(lobby.code, player.playerId, {
			displayName: session.getDisplayName(),
			preferredJoker: session.preferredJoker,
		})

		const token = signJwt({
			playerId: player.playerId,
			steamName: player.steamName,
			lobbyCode: code,
		})

		return { lobby, token }
	}

	async function joinLobby(player: JwtPayload, code: string) {
		const session = getSession(player.playerId)
		if (!session) throw new AppError('Player session not found', 401)

		const lobby = getLobby(code)
		if (!lobby) throw new AppError('Lobby not found', 404)

		if (lobby.type === 'public' && lobby.hasPlayer(player.playerId)) {
			const token = signJwt({
				playerId: player.playerId,
				steamName: player.steamName,
				lobbyCode: lobby.code,
			})
			return { lobby, token }
		}

		if (session.lobbyCode) throw new AppError('Already in a lobby', 409)
		if (lobby.hasPlayer(player.playerId))
			throw new AppError('Already in this lobby', 409)
		if (lobby.isFull) throw new AppError('Lobby is full', 409)

		lobby.addPlayer(session)

		await messageBus.publishPlayerInfo(lobby.code, player.playerId, {
			displayName: session.getDisplayName(),
			preferredJoker: session.preferredJoker,
		})

		if (lobby.type === 'private') {
			await matchmakingCoordinator.updateGroupQueueOnLobbyJoin(
				lobby.code,
				player.playerId,
			)
		}

		if (lobby.type === 'public') {
			await matchmakingCoordinator.syncMatchLobbyState(lobby.code)
		}

		const token = signJwt({
			playerId: player.playerId,
			steamName: player.steamName,
			lobbyCode: lobby.code,
		})

		await messageBus.publishEvent(lobby.code, {
			type: 'player_joined',
			lobbyCode: lobby.code,
			playerId: player.playerId,
			displayName: session.getDisplayName(),
			timestamp: new Date().toISOString(),
		})

		return { lobby, token }
	}

	async function leaveLobby(player: JwtPayload, code: string) {
		gracePeriodService.cancelGracePeriodSilently(player.playerId)

		const session = getSession(player.playerId)
		if (!session) throw new AppError('Player session not found', 401)

		const lobby = getLobby(code)
		if (!lobby) throw new AppError('Lobby not found', 404)
		if (!lobby.hasPlayer(player.playerId))
			throw new AppError('Not in this lobby', 400)

		lobby.removePlayer(player.playerId)

		if (lobby.type === 'private') {
			matchmakingCoordinator.removeGroupQueueForLobby(lobby.code)
		}

		await messageBus.clearPlayerInfo(lobby.code, player.playerId)
		await messageBus.cleanupPlayerState(lobby.code, player.playerId)

		await messageBus.publishEvent(lobby.code, {
			type: 'player_left',
			lobbyCode: lobby.code,
			playerId: player.playerId,
			displayName: session.getDisplayName(),
			timestamp: new Date().toISOString(),
		})

		if (lobby.hostId === player.playerId) {
			if (lobby.isEmpty) {
				await messageBus.publishEvent(lobby.code, {
					type: 'lobby_closed',
					lobbyCode: lobby.code,
					timestamp: new Date().toISOString(),
				})
				await messageBus.cleanupLobbyTopics(lobby.code, [player.playerId])
				lobbies.delete(lobby.code)
				await replayLogService.finalizeRun(lobby.code, 'terminated')
			} else {
				const newHostId = lobby.players.keys().next().value!
				lobby.hostId = newHostId

				await messageBus.publishEvent(lobby.code, {
					type: 'host_changed',
					lobbyCode: lobby.code,
					playerId: newHostId,
					timestamp: new Date().toISOString(),
				})
			}
		}

		if (lobby.isEmpty) {
			await messageBus.cleanupLobbyTopics(lobby.code, [player.playerId])
			lobbies.delete(lobby.code)
			await replayLogService.finalizeRun(lobby.code, 'terminated')
		}

		const token = signJwt({
			playerId: player.playerId,
			steamName: player.steamName,
		})

		return { token }
	}

	function getLobbyInfo(code: string) {
		const lobby = getLobby(code)
		if (!lobby) throw new AppError('Lobby not found', 404)
		return lobby
	}

	function getLobbyPlayers(code: string) {
		const lobby = getLobby(code)
		if (!lobby) throw new AppError('Lobby not found', 404)

		return Array.from(lobby.players.values()).map((p) => ({
			id: p.playerId,
			displayName: p.getDisplayName(),
			preferredJoker: p.preferredJoker,
			isAway: gracePeriodService.isInGracePeriod(p.playerId),
		}))
	}

	async function setMetadata(
		player: JwtPayload,
		code: string,
		metadata: Record<string, unknown>,
	) {
		const lobby = getLobby(code)
		if (!lobby) throw new AppError('Lobby not found', 404)
		if (lobby.hostId !== player.playerId)
			throw new AppError('Only the host can set metadata', 403)

		lobby.metadata = { ...lobby.metadata, ...metadata }

		await messageBus.publishMetadata(lobby.code, lobby.metadata)

		if (lobby.type === 'public') {
			await matchmakingCoordinator.syncMatchLobbyState(lobby.code)
		}

		await messageBus.publishEvent(lobby.code, {
			type: 'metadata_changed',
			lobbyCode: lobby.code,
			data: lobby.metadata,
			timestamp: new Date().toISOString(),
		})

		return lobby.metadata
	}

	return {
		createLobby,
		joinLobby,
		leaveLobby,
		getLobbyInfo,
		getLobbyPlayers,
		setMetadata,
	}
}
