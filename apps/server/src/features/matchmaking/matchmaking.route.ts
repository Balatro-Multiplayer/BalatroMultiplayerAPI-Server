import { Router } from 'express'
import { authenticate } from '../../middleware/authenticate.js'
import { getSession } from '../../state/index.js'
import type { PlacementEntry } from '../../shared/types/index.js'
import { AppError } from '../../shared/utils/errors.js'
import { assertCanPlay, assertRankedEnabled } from '../../shared/utils/access.js'
import {
	getLeaderboard,
	getOwnRating,
	getQueueStatus,
	leaveAllQueues,
	leaveQueue,
	resolveSeasonId,
} from './matchmaking.service.js'
import type { MatchmakingService } from './matchmaking.service.js'
import { isRanked } from './queue.js'

async function resolveSeason(season: unknown): Promise<number> {
	let explicit: number | undefined
	if (season !== undefined) {
		explicit = Number(season)
		if (Number.isNaN(explicit)) throw new AppError('Invalid season', 400)
	}
	const resolved = await resolveSeasonId(explicit)
	if (resolved === undefined) throw new AppError('No season available', 404)
	return resolved
}

export function createMatchmakingRouter(service: MatchmakingService): Router {
	const router = Router()

	router.use(authenticate)

	router.post('/queue', async (req, res, next) => {
		try {
			const session = getSession(req.player!.playerId)
			if (!session) throw new AppError('Session not found', 401)
			assertCanPlay(session)

			const { modId, gameMode, minPlayers, maxPlayers } = req.body
			if (!modId || typeof modId !== 'string') throw new AppError('Missing modId', 400)
			if (!gameMode || typeof gameMode !== 'string') throw new AppError('Missing gameMode', 400)
			if (!Number.isInteger(minPlayers) || minPlayers < 2)
				throw new AppError('minPlayers must be an integer >= 2', 400)
			if (!Number.isInteger(maxPlayers) || maxPlayers < minPlayers)
				throw new AppError('maxPlayers must be an integer >= minPlayers', 400)
			assertRankedEnabled(isRanked(gameMode))

			const result = await service.joinQueue(session, { modId, gameMode, minPlayers, maxPlayers })
			res.status(200).json(result)
		} catch (err) {
			next(err)
		}
	})

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

	router.delete('/queue/all', async (req, res, next) => {
		try {
			leaveAllQueues(req.player!.playerId)
			res.status(204).send()
		} catch (err) {
			next(err)
		}
	})

	router.get('/queue', async (req, res, next) => {
		try {
			const entries = getQueueStatus(req.player!.playerId)
			res.json({ entries })
		} catch (err) {
			next(err)
		}
	})

	router.post('/matches/:matchId/start', async (req, res, next) => {
		try {
			const session = getSession(req.player!.playerId)
			if (!session) throw new AppError('Session not found', 401)

			await service.markRunStart(session, req.params.matchId)
			res.status(204).send()
		} catch (err) {
			next(err)
		}
	})

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
				if (
					p.performance !== undefined &&
					(typeof p.performance !== 'number' || p.performance < 0 || p.performance > 1)
				)
					throw new AppError('Invalid placement: performance must be 0.0–1.0', 400)
				if (
					p.metric !== undefined &&
					(typeof p.metric !== 'number' || !Number.isFinite(p.metric) || p.metric < 0)
				)
					throw new AppError('Invalid placement: metric must be a non-negative finite number', 400)
			}

			await service.reportResult(session, matchId, placements)
			res.status(204).send()
		} catch (err) {
			next(err)
		}
	})

	router.get('/leaderboard', async (req, res, next) => {
		try {
			const { modId, gameMode, season } = req.query
			if (!modId || typeof modId !== 'string') throw new AppError('Missing modId', 400)
			if (!gameMode || typeof gameMode !== 'string') throw new AppError('Missing gameMode', 400)

			const seasonId = await resolveSeason(season)

			const data = await getLeaderboard(modId, gameMode, seasonId, req.player!.playerId)
			res.json(data)
		} catch (err) {
			next(err)
		}
	})

	// playerId is optional and defaults to the caller -- ratings are already
	// fully public via GET /leaderboard's entries array, so allowing a lookup
	// of an arbitrary other player here (e.g. an opponent currently in your
	// lobby) doesn't expose anything that wasn't already reachable, just
	// without needing to scan a paginated leaderboard for them.
	router.get('/ratings', async (req, res, next) => {
		try {
			const { modId, gameMode, season, playerId } = req.query
			if (!modId || typeof modId !== 'string') throw new AppError('Missing modId', 400)
			if (!gameMode || typeof gameMode !== 'string') throw new AppError('Missing gameMode', 400)
			if (playerId !== undefined && typeof playerId !== 'string') {
				throw new AppError('Invalid playerId', 400)
			}

			const seasonId = await resolveSeason(season)
			const targetId = playerId ?? req.player!.playerId

			const data = await getOwnRating(targetId, modId, gameMode, seasonId)
			if (!data) {
				res.json(null)
				return
			}
			res.json(data)
		} catch (err) {
			next(err)
		}
	})

	return router
}
