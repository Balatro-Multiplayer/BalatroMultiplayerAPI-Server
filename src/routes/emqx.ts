import { Router } from 'express'
import { env } from '../env.js'
import {
	authenticateClient,
	authorizeAction,
} from '../services/emqx-auth.service.js'
import { startGracePeriod } from '../services/grace-period.service.js'
import { leaveAllQueues } from '../services/matchmaking.service.js'
import { getSession, removeSession } from '../state/index.js'
import type { EmqxAuthRequest, EmqxAuthzRequest } from '../types/index.js'

const router = Router()

const denyAuth = () => ({ result: 'deny', is_superuser: false })
const denyAuthz = () => ({ result: 'deny' })
const ok = () => ({ result: 'ok' })

router.post('/auth', async (req, res) => {
	try {
		const result = await authenticateClient(req.body as EmqxAuthRequest)
		res.status(200).json(result)
	} catch (err) {
		console.error('[emqx] Auth webhook error:', err)
		res.status(200).json(denyAuth())
	}
})

router.post('/authz', async (req, res) => {
	try {
		const result = await authorizeAction(req.body as EmqxAuthzRequest)
		res.status(200).json(result)
	} catch (err) {
		console.error('[emqx] Authz webhook error:', err)
		res.status(200).json(denyAuthz())
	}
})

function isClientDisconnectedEvent(event: string): boolean {
	return event === 'client.disconnected'
}

function isSystemClientId(clientid: string): boolean {
	return clientid === env.EMQX_SYSTEM_CLIENT_ID
}

async function releasePlayerLobbyOrSession(clientid: string): Promise<void> {
	const session = getSession(clientid)
	if (!session) return

	leaveAllQueues(clientid)

	if (session.lobbyCode) {
		await startGracePeriod(clientid)
	} else {
		removeSession(clientid)
	}
}

async function handleClientDisconnected(clientid: string): Promise<void> {
	if (isSystemClientId(clientid)) return
	await releasePlayerLobbyOrSession(clientid)
}

router.post('/webhook', async (req, res) => {
	try {
		const { event, clientid } = req.body as {
			event: string
			clientid: string
		}

		if (isClientDisconnectedEvent(event)) {
			await handleClientDisconnected(clientid)
		}

		res.status(200).json(ok())
	} catch (err) {
		console.error('[emqx] Webhook error:', err)
		res.status(200).json(ok())
	}
})

export default router
