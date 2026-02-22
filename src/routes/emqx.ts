import { Router } from 'express'
import {
	authenticateClient,
	authorizeAction,
} from '../services/emqx-auth.service.js'
import type { EmqxAuthRequest, EmqxAuthzRequest } from '../types/index.js'

const router = Router()

router.post('/auth', async (req, res) => {
	try {
		const body = req.body as EmqxAuthRequest
		const result = await authenticateClient(body)
		res.status(200).json(result)
	} catch (err) {
		console.error('[emqx] Auth webhook error:', err)
		res.status(200).json({ result: 'deny', is_superuser: false })
	}
})

router.post('/authz', async (req, res) => {
	try {
		const body = req.body as EmqxAuthzRequest
		const result = await authorizeAction(body)
		res.status(200).json(result)
	} catch (err) {
		console.error('[emqx] Authz webhook error:', err)
		res.status(200).json({ result: 'deny' })
	}
})

export default router
