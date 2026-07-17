import { Router } from 'express'
import { authenticate } from '../../middleware/authenticate.js'
import { AppError } from '../../shared/utils/errors.js'
import { getLobby } from '../../state/index.js'
import type { ReplayLogService } from './replay-log.service.js'

export function createReplayLogRouter(service: ReplayLogService): Router {
	const router = Router()

	router.use(authenticate)

	router.get('/:runId/replay', async (req, res, next) => {
		try {
			const result = await service.getReplay(
				req.params.runId,
				req.player!.playerId,
			)
			res.json(result)
		} catch (err) {
			next(err)
		}
	})

	// Phase 9: reconnect tail-fetch. Keyed by lobbyCode/playerId (not runId)
	// since the match is still active -- there's no finalized matchRunLogs row
	// to look a runId up from yet. Auth checks LIVE lobby membership (like
	// lobby.route.ts's spectate endpoint) rather than a DB participant row,
	// for the same reason.
	router.get('/:lobbyCode/players/:playerId/tail', (req, res, next) => {
		try {
			const lobby = getLobby(req.params.lobbyCode)
			if (!lobby) throw new AppError('Lobby not found', 404)
			if (!lobby.hasPlayer(req.player!.playerId)) {
				throw new AppError('Not a member of this lobby', 403)
			}

			const sinceT = Number(req.query.since_t ?? 0)
			if (!Number.isFinite(sinceT)) {
				throw new AppError('since_t must be a number', 400)
			}

			const events = service.getTail(
				req.params.lobbyCode,
				req.params.playerId,
				sinceT,
			)
			res.json({ events })
		} catch (err) {
			next(err)
		}
	})

	return router
}
