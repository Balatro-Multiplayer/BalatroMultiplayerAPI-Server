import { Router } from 'express'
import authRouter from './auth.js'
import emqxRouter from './emqx.js'
import lobbiesRouter from './lobbies.js'

const router = Router()

router.use('/api/auth', authRouter)
router.use('/api/lobbies', lobbiesRouter)
router.use('/emqx', emqxRouter)

export default router
