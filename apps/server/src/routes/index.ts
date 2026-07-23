import { Router } from 'express'
import adminRouter from '../features/admin/admin.route.js'
import { createAuthRouter } from '../features/auth/auth.route.js'
import { createAuthService } from '../features/auth/auth.service.js'
import emqxRouter from '../features/emqx/emqx.route.js'
import { createLobbyRouter } from '../features/lobby/lobby.route.js'
import { createLobbyService } from '../features/lobby/lobby.service.js'
import { createMatchmakingRouter } from '../features/matchmaking/matchmaking.route.js'
import { createMatchmakingService } from '../features/matchmaking/matchmaking.service.js'
import { createMutesRouter } from '../features/mutes/mutes.route.js'
import releasesRouter from '../features/releases/releases.route.js'
import { createReportsRouter } from '../features/reports/reports.route.js'
import { createReplayLogRouter } from '../features/replay-log/replay-log.route.js'
import { replayLogService } from '../features/replay-log/replay-log.service.js'
import statsRouter from '../features/stats/stats.route.js'
import webadminRouter from '../features/webadmin/webadmin.route.js'
import * as banGateway from '../infrastructure/gateways/ban.gateway.js'
import * as matchGateway from '../infrastructure/gateways/matchmaking.gateway.js'
import * as playerGateway from '../infrastructure/gateways/player.gateway.js'
import * as gracePeriodService from '../infrastructure/mqtt/grace-period.service.js'
import { mqttService } from '../infrastructure/mqtt/mqtt.service.js'

export const matchmakingService = createMatchmakingService({
	messageBus: mqttService,
	matchRepository: matchGateway,
	banRepository: banGateway,
})

export const authService = createAuthService({
	playerRepository: playerGateway,
	gracePeriodService,
})

export const lobbyService = createLobbyService({
	messageBus: mqttService,
	matchmakingCoordinator: matchmakingService,
	gracePeriodService,
})

const router = Router()

router.use('/api/auth', createAuthRouter(authService))
router.use('/api/lobbies', createLobbyRouter(lobbyService))
router.use('/api/matchmaking', createMatchmakingRouter(matchmakingService))
router.use('/api/mutes', createMutesRouter())
router.use('/api/reports', createReportsRouter())
router.use('/api/runs', createReplayLogRouter(replayLogService))
router.use('/api/stats', statsRouter)
router.use('/api/releases', releasesRouter)
router.use('/api/webadmin', webadminRouter)
router.use('/emqx', emqxRouter)
router.use('/admin', adminRouter)

export default router
