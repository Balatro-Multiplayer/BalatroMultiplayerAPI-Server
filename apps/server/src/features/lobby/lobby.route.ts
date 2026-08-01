import { Router } from 'express'
import { authenticate } from '../../middleware/authenticate.js'
import { processAndPublishMessage } from '../chat/chat.service.js'
import { submitReport } from '../../infrastructure/gateways/report.gateway.js'
import { getLobby, getSession } from '../../state/index.js'
import { getConfig } from '../../state/config.js'
import { AppError } from '../../shared/utils/errors.js'
import { assertCanPlay } from '../../shared/utils/access.js'
import { hasActiveBan } from '../../infrastructure/gateways/ban.gateway.js'
import type { LobbyService } from './lobby.service.js'

export function createLobbyRouter(service: LobbyService): Router {
	const router = Router()

	router.use(authenticate)

	router.post('/', async (req, res, next) => {
		try {
			const session = getSession(req.player!.playerId)
			if (!session) throw new AppError('Session not found', 401)
			assertCanPlay(session)

			const { modId, maxPlayers } = req.body
			if (!modId || typeof modId !== 'string') {
				throw new AppError('Missing or invalid modId', 400)
			}

			if (
				maxPlayers !== undefined &&
				(!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > 128)
			) {
				throw new AppError(
					'maxPlayers must be an integer between 2 and 128',
					400,
				)
			}

			const { lobby, token } = await service.createLobby(
				req.player!,
				modId,
				maxPlayers,
			)

			res.status(201).json({
				token,
				lobby: {
					code: lobby.code,
					modId: lobby.modId,
					hostId: lobby.hostId,
					maxPlayers: lobby.maxPlayers,
					metadata: lobby.metadata,
					isHost: true,
					players: Array.from(lobby.players.values()).map((p) => ({
						id: p.playerId,
						displayName: p.getDisplayName(),
						preferredJoker: p.preferredJoker,
					})),
				},
			})
		} catch (err) {
			next(err)
		}
	})

	router.post('/:code/join', async (req, res, next) => {
		try {
			const { code } = req.params
			const { lobby, token } = await service.joinLobby(req.player!, code)

			res.json({
				token,
				lobby: {
					code: lobby.code,
					modId: lobby.modId,
					hostId: lobby.hostId,
					maxPlayers: lobby.maxPlayers,
					metadata: lobby.metadata,
					isHost: lobby.hostId === req.player!.playerId,
					players: Array.from(lobby.players.values()).map((p) => ({
						id: p.playerId,
						displayName: p.getDisplayName(),
						preferredJoker: p.preferredJoker,
					})),
				},
			})
		} catch (err) {
			next(err)
		}
	})

	router.post('/:code/leave', async (req, res, next) => {
		try {
			const { code } = req.params
			const { token } = await service.leaveLobby(req.player!, code)
			res.json({ token })
		} catch (err) {
			next(err)
		}
	})

	router.get('/:code', async (req, res, next) => {
		try {
			const lobby = service.getLobbyInfo(req.params.code)

			res.json({
				lobby: {
					code: lobby.code,
					modId: lobby.modId,
					hostId: lobby.hostId,
					maxPlayers: lobby.maxPlayers,
					metadata: lobby.metadata,
					isHost: lobby.hostId === req.player!.playerId,
					players: Array.from(lobby.players.values()).map((p) => ({
						id: p.playerId,
						displayName: p.getDisplayName(),
						preferredJoker: p.preferredJoker,
					})),
				},
			})
		} catch (err) {
			next(err)
		}
	})

	router.get('/:code/players', async (req, res, next) => {
		try {
			const players = service.getLobbyPlayers(req.params.code)
			res.json({ players })
		} catch (err) {
			next(err)
		}
	})

	router.post('/:code/chat', async (req, res, next) => {
		try {
			const { code } = req.params
			const session = getSession(req.player!.playerId)
			if (!session) throw new AppError('Session not found', 401)

			if (!getConfig().chatEnabled) {
				throw new AppError('Chat is not enabled', 403)
			}

			if (!session.chatEnabled || session.chatBlocked) {
				throw new AppError('Chat is not enabled for this account', 403)
			}

			if (await hasActiveBan(session.playerId, 'chat')) {
				throw new AppError('You are banned from chat', 403)
			}

			const lobby = getLobby(code)
			if (!lobby) throw new AppError('Lobby not found', 404)
			if (!lobby.hasPlayer(session.playerId)) throw new AppError('Not a member of this lobby', 403)

			const { message } = req.body
			if (!message || typeof message !== 'string') {
				throw new AppError('Missing or invalid message', 400)
			}
			if (message.length > 500) {
				throw new AppError('Message too long (max 500 characters)', 400)
			}

			const displayName = session.getDisplayName()
			const result = await processAndPublishMessage(lobby, session.playerId, displayName, message)

			if (!result.ok) {
				if (result.reason === 'empty') throw new AppError('Message cannot be empty', 400)
				if (result.reason === 'moderated') throw new AppError('Message was rejected by moderation', 403)
				if (result.reason === 'rate_limited') throw new AppError("You're chatting too fast. Wait a few seconds.", 429)
				if (result.reason === 'unavailable') throw new AppError('Chat moderation is unavailable. Try again in a moment.', 503)
				throw new AppError('Failed to send message', 500)
			}

			res.json(result.publishText ? { ok: true, publishText: result.publishText } : { ok: true })
		} catch (err) {
			next(err)
		}
	})

	router.post('/:code/report', async (req, res, next) => {
		try {
			const { code } = req.params
			const session = getSession(req.player!.playerId)
			if (!session) throw new AppError('Session not found', 401)

			const lobby = getLobby(code)
			if (!lobby) throw new AppError('Lobby not found', 404)
			if (!lobby.hasPlayer(session.playerId)) throw new AppError('Not a member of this lobby', 403)

			const { reportedPlayerId, type, message } = req.body

			if (!reportedPlayerId || typeof reportedPlayerId !== 'string') {
				throw new AppError('Missing or invalid reportedPlayerId', 400)
			}
			if (!type || typeof type !== 'string' || type.length > 64) {
				throw new AppError('Missing or invalid type (max 64 characters)', 400)
			}
			if (message !== undefined && (typeof message !== 'string' || message.length > 500)) {
				throw new AppError('Invalid message (max 500 characters)', 400)
			}

			await submitReport(lobby, session.playerId, reportedPlayerId, type, message)

			res.json({ ok: true })
		} catch (err) {
			next(err)
		}
	})

	router.put('/:code/metadata', async (req, res, next) => {
		try {
			const { metadata } = req.body
			if (!metadata || typeof metadata !== 'object') {
				throw new AppError('Missing or invalid metadata object', 400)
			}

			const merged = await service.setMetadata(
				req.player!,
				req.params.code,
				metadata,
			)

			res.json({ metadata: merged })
		} catch (err) {
			next(err)
		}
	})

	return router
}
