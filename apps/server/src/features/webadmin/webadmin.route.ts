import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { findPlayerById } from '../../infrastructure/gateways/player.gateway.js'
import { authenticate } from '../../middleware/authenticate.js'
import chatLogsRouter from './chat-logs.route.js'
import configRouter from './config.route.js'
import launcherReleasesRouter from './launcher-releases.route.js'
import matchConflictsRouter from './match-conflicts.route.js'
import matchesRouter from './matches.route.js'
import modsRouter from './mods.route.js'
import playersRouter from './players.route.js'
import reportsRouter from './reports.route.js'
import seasonsRouter from './seasons.route.js'

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
router.use(launcherReleasesRouter)
router.use(configRouter)
router.use(modsRouter)

export default router
