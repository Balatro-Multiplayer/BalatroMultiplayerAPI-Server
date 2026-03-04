import { Router } from 'express'
import { env } from '../env.js'
import {
	authenticateClient,
	authorizeAction,
} from '../services/emqx-auth.service.js'
import { startGracePeriod } from '../services/grace-period.service.js'
import { getSession, removeSession } from '../state/index.js'
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

router.post('/webhook', async (req, res) => {
	try {
		const { event, clientid } = req.body as {
			event: string
			clientid: string
		}

		if (event !== 'client.disconnected') {
			res.status(200).json({ result: 'ok' })
			return
		}

		if (clientid === env.EMQX_SYSTEM_CLIENT_ID) {
			res.status(200).json({ result: 'ok' })
			return
		}

		const session = getSession(clientid)
		if (!session) {
			res.status(200).json({ result: 'ok' })
			return
		}

		if (session.lobbyCode) {
			await startGracePeriod(clientid)
		} else {
			removeSession(clientid)
		}

		res.status(200).json({ result: 'ok' })
	} catch (err) {
		console.error('[emqx] Webhook error:', err)
		res.status(200).json({ result: 'ok' })
	}
})

export default router
