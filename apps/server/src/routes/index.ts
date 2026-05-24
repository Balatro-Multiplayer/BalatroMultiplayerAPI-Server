import { Router } from 'express'
import adminRouter from '../features/admin/admin.route.js'
import authRouter from '../features/auth/auth.route.js'
import emqxRouter from '../features/emqx/emqx.route.js'
import lobbiesRouter from '../features/lobby/lobby.route.js'
import matchmakingRouter from '../features/matchmaking/matchmaking.route.js'

const router = Router()

router.use('/api/auth', authRouter)
router.use('/api/lobbies', lobbiesRouter)
router.use('/api/matchmaking', matchmakingRouter)
router.use('/emqx', emqxRouter)
router.use('/admin', adminRouter)

export default router
