import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { authenticate } from '../../middleware/authenticate.js'
import { findPlayerById } from '../../infrastructure/gateways/player.gateway.js'
import playersRouter from './players.route.js'
import chatLogsRouter from './chat-logs.route.js'
import reportsRouter from './reports.route.js'
import seasonsRouter from './seasons.route.js'
import matchesRouter from './matches.route.js'
import matchConflictsRouter from './match-conflicts.route.js'
import releasesRouter from './releases.route.js'

const router = Router()

function webAdmin(req: Request, res: Response, next: NextFunction) {
	authenticate(req, res, async () => {
		try {
			const player = await findPlayerById(req.player!.playerId)
			const isAuthorized =
				player?.privileges.includes('admin') ||
				player?.privileges.includes('moderator')
			if (!isAuthorized) {
				res.status(403).json({ error: 'Forbidden' })
				return
			}
			next()
		} catch (err) {
			next(err)
		}
	})
}

router.use(webAdmin)
router.use(playersRouter)
router.use(chatLogsRouter)
router.use(reportsRouter)
router.use(seasonsRouter)
router.use(matchesRouter)
router.use(matchConflictsRouter)
router.use(releasesRouter)

export default router
