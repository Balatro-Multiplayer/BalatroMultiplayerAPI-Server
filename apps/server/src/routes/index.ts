import { Router } from 'express'
import { mqttService } from '../infrastructure/mqtt/mqtt.service.js'
import * as playerGateway from '../infrastructure/gateways/player.gateway.js'
import * as banGateway from '../infrastructure/gateways/ban.gateway.js'
import * as matchGateway from '../infrastructure/gateways/matchmaking.gateway.js'
import * as gracePeriodService from '../infrastructure/mqtt/grace-period.service.js'
import { createAuthService } from '../features/auth/auth.service.js'
import { createLobbyService } from '../features/lobby/lobby.service.js'
import { createMatchmakingService } from '../features/matchmaking/matchmaking.service.js'
import { createAuthRouter } from '../features/auth/auth.route.js'
import { createLobbyRouter } from '../features/lobby/lobby.route.js'
import { createMatchmakingRouter } from '../features/matchmaking/matchmaking.route.js'
import adminRouter from '../features/admin/admin.route.js'
import configRouter from '../features/draft/config.route.js'
import draftRouter from '../features/draft/draft.route.js'
import weeklyCocktailAdminRouter from '../features/draft/weekly-cocktail-admin.route.js'
import emqxRouter from '../features/emqx/emqx.route.js'
import releasesRouter from '../features/releases/releases.route.js'
import statsRouter from '../features/stats/stats.route.js'
import webadminRouter from '../features/webadmin/webadmin.route.js'

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
router.use('/api/config', configRouter)
router.use('/api/lobbies', createLobbyRouter(lobbyService))
router.use('/api/matches', draftRouter)
router.use('/api/matchmaking', createMatchmakingRouter(matchmakingService))
router.use('/api/stats', statsRouter)
router.use('/api/releases', releasesRouter)
router.use('/api/webadmin', webadminRouter)
router.use('/emqx', emqxRouter)
router.use('/admin', adminRouter)
router.use('/admin', weeklyCocktailAdminRouter)

export default router
