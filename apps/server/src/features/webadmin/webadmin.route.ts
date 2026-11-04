import { Router } from 'express'
import type { NextFunction, Request, Response } from 'express'
import { authenticate } from '../../middleware/authenticate.js'
import { currentStaffRole, roleGuard } from '../../shared/utils/staff-role.js'
import achievementsRouter from './achievements.route.js'
import archivesRouter from './archives.route.js'
import blogRouter from './blog.route.js'
import chatLogsRouter from './chat-logs.route.js'
import configRouter from './config.route.js'
import forfeitReconciliationRouter from './forfeit-reconciliation.route.js'
import launcherReleasesRouter from './launcher-releases.route.js'
import lobbiesRouter from './lobbies.route.js'
import matchConflictsRouter from './match-conflicts.route.js'
import matchEditRouter from './match-edit.route.js'
import matchesRouter from './matches.route.js'
import modsRouter from './mods.route.js'
import playersRouter from './players.route.js'
import reportsRouter from './reports.route.js'
import seasonReplayRouter from './season-replay.route.js'
import seasonsRouter from './seasons.route.js'
import serviceQueueRouter from './service-queue.route.js'
import staffLogRouter from './staff-log.route.js'

const router = Router()

function webAdmin(req: Request, res: Response, next: NextFunction) {
	authenticate(req, res, async () => {
		try {
			if ((await currentStaffRole(req)) === null) {
				res.status(403).json({ error: 'Forbidden' })
				return
			}
			next()
		} catch (err) {
			next(err)
		}
	})
}

// Pages and routes for admins only: a moderator gets no data from them.
const admin = roleGuard('admin')

router.use(webAdmin)
router.use(playersRouter)
router.use(chatLogsRouter)
router.use(reportsRouter)
router.use(seasonsRouter)
router.use(matchesRouter)
router.use(matchEditRouter)
router.use(lobbiesRouter)
router.use(matchConflictsRouter)
router.use(forfeitReconciliationRouter)
router.use('/launcher-releases', admin)
router.use(launcherReleasesRouter)
router.use('/config', admin)
router.use(configRouter)
router.use('/mods', admin)
router.use(modsRouter)
router.use(blogRouter)
router.use(archivesRouter)
router.use(serviceQueueRouter)
router.use(staffLogRouter)
router.use('/achievements', admin)
router.use(achievementsRouter)
router.use('/ratings', admin)
router.use(seasonReplayRouter)

export default router
