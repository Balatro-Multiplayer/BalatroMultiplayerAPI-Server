import { Router } from 'express'
import { authenticate } from '../../middleware/authenticate.js'
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

	return router
}
