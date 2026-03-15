import { Router } from 'express'
import { authenticate } from '../middleware/authenticate.js'
import * as lobbyService from '../services/lobby.service.js'
import { AppError } from '../utils/errors.js'

const router = Router()

router.use(authenticate)

router.post('/', async (req, res, next) => {
	try {
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

		const { lobby, token } = await lobbyService.createLobby(
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
		const { lobby, token } = await lobbyService.joinLobby(req.player!, code)

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
		const { token } = await lobbyService.leaveLobby(req.player!, code)
		res.json({ token })
	} catch (err) {
		next(err)
	}
})

router.get('/:code', async (req, res, next) => {
	try {
		const lobby = lobbyService.getLobbyInfo(req.params.code)

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
		const players = lobbyService.getLobbyPlayers(req.params.code)
		res.json({ players })
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

		const merged = await lobbyService.setMetadata(
			req.player!,
			req.params.code,
			metadata,
		)

		res.json({ metadata: merged })
	} catch (err) {
		next(err)
	}
})

export default router
