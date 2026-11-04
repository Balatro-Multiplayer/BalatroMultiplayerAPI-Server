import { Router } from 'express'
import { optionalAuthenticate } from '../../middleware/authenticate.js'
import { authenticateActive } from '../../middleware/authenticate-active.js'
import type { ReplayLogService } from './replay-log.service.js'

export function createReplayLogRouter(service: ReplayLogService): Router {
	const router = Router()

	// The website's "My Matches" list.
	router.get('/mine', authenticateActive, async (req, res, next) => {
		try {
			const page = Math.max(
				1,
				Math.min(1000, Number.parseInt(String(req.query.page ?? '1'), 10) || 1),
			)
			const pageSize = Math.max(
				1,
				Math.min(
					50,
					Number.parseInt(String(req.query.pageSize ?? '20'), 10) || 20,
				),
			)
			const result = await service.listMyRuns(
				req.player!.playerId,
				page,
				pageSize,
			)
			res.json(result)
		} catch (err) {
			next(err)
		}
	})

	// Open to anyone: the service answers 404 unless the viewer is in the run,
	// a moderator, or a side is shared.
	router.get('/:runId/replay', optionalAuthenticate, async (req, res, next) => {
		try {
			res.json(
				await service.getReplay(
					String(req.params.runId),
					req.player?.playerId ?? null,
				),
			)
		} catch (err) {
			next(err)
		}
	})

	// A player shares or unshares only their own side.
	router.post('/:runId/share', authenticateActive, async (req, res, next) => {
		try {
			await service.setShared(
				String(req.params.runId),
				req.player!.playerId,
				true,
			)
			res.json({ shared: true })
		} catch (err) {
			next(err)
		}
	})

	router.delete('/:runId/share', authenticateActive, async (req, res, next) => {
		try {
			await service.setShared(
				String(req.params.runId),
				req.player!.playerId,
				false,
			)
			res.json({ shared: false })
		} catch (err) {
			next(err)
		}
	})

	return router
}
