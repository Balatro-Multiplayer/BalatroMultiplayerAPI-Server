import { Router } from 'express'
import { authenticate } from '../../middleware/authenticate.js'
import {
	getLeaderboard,
	getOwnRating,
	getQueueStatus,
	joinQueue,
	leaveAllQueues,
	leaveQueue,
	reportResult,
} from './matchmaking.service.js'
import { getSession } from '../../state/index.js'
import type { PlacementEntry } from '../../shared/types/index.js'
import { AppError } from '../../shared/utils/errors.js'

const router = Router()

router.use(authenticate)

// Join queue
router.post('/queue', async (req, res, next) => {
	try {
		const session = getSession(req.player!.playerId)
		if (!session) throw new AppError('Session not found', 401)

		const { modId, gameMode, minPlayers, maxPlayers } = req.body
		if (!modId || typeof modId !== 'string') throw new AppError('Missing modId', 400)
		if (!gameMode || typeof gameMode !== 'string') throw new AppError('Missing gameMode', 400)
		if (!Number.isInteger(minPlayers) || minPlayers < 2)
			throw new AppError('minPlayers must be an integer >= 2', 400)
		if (!Number.isInteger(maxPlayers) || maxPlayers < minPlayers)
			throw new AppError('maxPlayers must be an integer >= minPlayers', 400)

		const result = await joinQueue(session, { modId, gameMode, minPlayers, maxPlayers })
		res.status(200).json(result)
	} catch (err) {
		next(err)
	}
})

// Leave specific queue slot
router.delete('/queue', async (req, res, next) => {
	try {
		const { modId, gameMode } = req.body
		if (!modId || typeof modId !== 'string') throw new AppError('Missing modId', 400)
		if (!gameMode || typeof gameMode !== 'string') throw new AppError('Missing gameMode', 400)

		leaveQueue(req.player!.playerId, modId, gameMode)
		res.status(204).send()
	} catch (err) {
		next(err)
	}
})

// Leave all queue slots
router.delete('/queue/all', async (req, res, next) => {
	try {
		leaveAllQueues(req.player!.playerId)
		res.status(204).send()
	} catch (err) {
		next(err)
	}
})

// Get queue status
router.get('/queue', async (req, res, next) => {
	try {
		const entries = getQueueStatus(req.player!.playerId)
		res.json({ entries })
	} catch (err) {
		next(err)
	}
})

// Report match result
router.post('/matches/:matchId/result', async (req, res, next) => {
	try {
		const session = getSession(req.player!.playerId)
		if (!session) throw new AppError('Session not found', 401)

		const { matchId } = req.params
		const { placements } = req.body as { placements: PlacementEntry[] }

		if (!Array.isArray(placements) || placements.length < 2) {
			throw new AppError('placements must be an array of at least 2 entries', 400)
		}

		for (const p of placements) {
			if (typeof p.playerId !== 'string') throw new AppError('Invalid placement: missing playerId', 400)
			if (!Number.isInteger(p.place) || p.place < 1)
				throw new AppError('Invalid placement: place must be a positive integer', 400)
			if (p.performance !== undefined && (typeof p.performance !== 'number' || p.performance < 0 || p.performance > 1))
				throw new AppError('Invalid placement: performance must be 0.0–1.0', 400)
		}

		await reportResult(session, matchId, placements)
		res.status(204).send()
	} catch (err) {
		next(err)
	}
})

// Get leaderboard
router.get('/leaderboard', async (req, res, next) => {
	try {
		const { modId, gameMode, season } = req.query
		if (!modId || typeof modId !== 'string') throw new AppError('Missing modId', 400)
		if (!gameMode || typeof gameMode !== 'string') throw new AppError('Missing gameMode', 400)

		const seasonId = season ? Number(season) : undefined
		if (seasonId === undefined || Number.isNaN(seasonId))
			throw new AppError('Missing or invalid season', 400)

		const data = await getLeaderboard(modId, gameMode, seasonId, req.player!.playerId)
		res.json(data)
	} catch (err) {
		next(err)
	}
})

// Get own rating
router.get('/ratings', async (req, res, next) => {
	try {
		const { modId, gameMode, season } = req.query
		if (!modId || typeof modId !== 'string') throw new AppError('Missing modId', 400)
		if (!gameMode || typeof gameMode !== 'string') throw new AppError('Missing gameMode', 400)
		const seasonId = season ? Number(season) : undefined
		if (seasonId === undefined || Number.isNaN(seasonId))
			throw new AppError('Missing or invalid season', 400)

		const data = await getOwnRating(req.player!.playerId, modId, gameMode, seasonId)
		if (!data) {
			res.json(null)
			return
		}
		res.json(data)
	} catch (err) {
		next(err)
	}
})

export default router
