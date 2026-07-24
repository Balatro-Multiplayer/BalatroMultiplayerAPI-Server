import { Router } from 'express'
import { authenticate } from '../../middleware/authenticate.js'
import { findPlayerById } from '../../infrastructure/gateways/player.gateway.js'
import type { ReplayLogService } from './replay-log.service.js'

export function createReplayLogRouter(service: ReplayLogService): Router {
	const router = Router()

	router.use(authenticate)

	router.get('/:runId/replay', async (req, res, next) => {
		try {
			// Same DB-authoritative privilege check webAdmin's middleware uses
			// (not the in-memory session), so a moderator browsing from the
			// website -- no live game session required -- still gets access.
			const player = await findPlayerById(req.player!.playerId)
			const isModerator =
				player?.privileges.includes('admin') || player?.privileges.includes('moderator') || false

			const result = await service.getReplay(
				req.params.runId,
				req.player!.playerId,
				isModerator,
			)
			res.json(result)
		} catch (err) {
			next(err)
		}
	})

	return router
}
