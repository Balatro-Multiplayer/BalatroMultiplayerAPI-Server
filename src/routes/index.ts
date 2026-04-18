import { Router } from 'express'
import adminRouter from './admin.js'
import authRouter from './auth.js'
import emqxRouter from './emqx.js'
import lobbiesRouter from './lobbies.js'
import matchmakingRouter from './matchmaking.js'

const router = Router()

router.use('/api/auth', authRouter)
router.use('/api/lobbies', lobbiesRouter)
router.use('/api/matchmaking', matchmakingRouter)
router.use('/emqx', emqxRouter)
router.use('/admin', adminRouter)

export default router
