import {
	Lobby,
	getLobby,
	getSession,
	lobbies,
} from '../state/index.js'
import type { JwtPayload } from '../types/index.js'
import { AppError } from '../utils/errors.js'
import { generateLobbyCode } from '../utils/lobby-code.js'
import { signJwt } from './auth.service.js'
import { mqttService } from './mqtt.service.js'

export async function createLobby(
	player: JwtPayload,
	modId: string,
	maxPlayers?: number,
) {
	const session = getSession(player.playerId)
	if (!session) {
		throw new AppError('Player session not found', 401)
	}

	if (session.lobbyCode) {
		throw new AppError('Already in a lobby', 409)
	}

	let code: string
	let attempts = 0
	do {
		code = generateLobbyCode()
		if (!lobbies.has(code)) break
		attempts++
	} while (attempts < 10)

	if (attempts >= 10) {
		throw new AppError('Failed to generate unique lobby code', 500)
	}

	const lobby = new Lobby(code, modId, player.playerId, maxPlayers)
	lobby.addPlayer(session)
	lobbies.set(code, lobby)

	const token = signJwt({
		playerId: player.playerId,
		username: player.username,
		lobbyCode: code,
	})

	return { lobby, token }
}

export async function joinLobby(player: JwtPayload, code: string) {
	const session = getSession(player.playerId)
	if (!session) {
		throw new AppError('Player session not found', 401)
	}

	if (session.lobbyCode) {
		throw new AppError('Already in a lobby', 409)
	}

	const lobby = getLobby(code)
	if (!lobby) {
		throw new AppError('Lobby not found', 404)
	}

	if (lobby.hasPlayer(player.playerId)) {
		throw new AppError('Already in this lobby', 409)
	}

	lobby.addPlayer(session)

	const token = signJwt({
		playerId: player.playerId,
		username: player.username,
		lobbyCode: lobby.code,
	})

	await mqttService.publishEvent(lobby.code, {
		type: 'player_joined',
		lobbyCode: lobby.code,
		playerId: player.playerId,
		username: player.username,
		timestamp: new Date().toISOString(),
	})

	return { lobby, token }
}

export async function leaveLobby(player: JwtPayload, code: string) {
	const session = getSession(player.playerId)
	if (!session) {
		throw new AppError('Player session not found', 401)
	}

	const lobby = getLobby(code)
	if (!lobby) {
		throw new AppError('Lobby not found', 404)
	}

	if (!lobby.hasPlayer(player.playerId)) {
		throw new AppError('Not in this lobby', 400)
	}

	lobby.removePlayer(player.playerId)

	await mqttService.cleanupPlayerState(lobby.code, player.playerId)

	await mqttService.publishEvent(lobby.code, {
		type: 'player_left',
		lobbyCode: lobby.code,
		playerId: player.playerId,
		username: player.username,
		timestamp: new Date().toISOString(),
	})

	if (lobby.hostId === player.playerId) {
		if (lobby.isEmpty) {
			await mqttService.publishEvent(lobby.code, {
				type: 'lobby_closed',
				lobbyCode: lobby.code,
				timestamp: new Date().toISOString(),
			})
			await mqttService.cleanupLobbyTopics(lobby.code)
			lobbies.delete(lobby.code)
		} else {
			const newHostId = lobby.players.keys().next().value!
			lobby.hostId = newHostId

			await mqttService.publishEvent(lobby.code, {
				type: 'host_changed',
				lobbyCode: lobby.code,
				playerId: newHostId,
				timestamp: new Date().toISOString(),
			})
		}
	}

	if (lobby.isEmpty) {
		await mqttService.cleanupLobbyTopics(lobby.code)
		lobbies.delete(lobby.code)
	}

	const token = signJwt({
		playerId: player.playerId,
		username: player.username,
	})

	return { token }
}

export function getLobbyInfo(code: string) {
	const lobby = getLobby(code)
	if (!lobby) {
		throw new AppError('Lobby not found', 404)
	}
	return lobby
}

export function getLobbyPlayers(code: string) {
	const lobby = getLobby(code)
	if (!lobby) {
		throw new AppError('Lobby not found', 404)
	}

	return Array.from(lobby.players.values()).map((p) => ({
		id: p.playerId,
		username: p.username,
	}))
}

export async function setMetadata(
	player: JwtPayload,
	code: string,
	metadata: Record<string, unknown>,
) {
	const lobby = getLobby(code)
	if (!lobby) {
		throw new AppError('Lobby not found', 404)
	}

	if (lobby.hostId !== player.playerId) {
		throw new AppError('Only the host can set metadata', 403)
	}

	lobby.metadata = { ...lobby.metadata, ...metadata }

	await mqttService.publishMetadata(lobby.code, lobby.metadata)

	await mqttService.publishEvent(lobby.code, {
		type: 'metadata_changed',
		lobbyCode: lobby.code,
		data: lobby.metadata,
		timestamp: new Date().toISOString(),
	})

	return lobby.metadata
}
