import { Router } from 'express'
import { env } from '../../env.js'
import { startGracePeriod } from '../../infrastructure/mqtt/grace-period.service.js'
import { revokeSpectator } from '../../infrastructure/mqtt/spectator-registry.js'
import type {
	EmqxAuthRequest,
	EmqxAuthzRequest,
} from '../../shared/types/index.js'
import { getSession, removeSession } from '../../state/index.js'
import { LOGIN_CHALLENGE_DELAY_MS } from '../launcher-integrity/launcher-integrity.config.js'
import { launcherIntegrityService } from '../launcher-integrity/launcher-integrity.service.js'
import { leaveAllQueues } from '../matchmaking/queue.js'
import { authenticateClient, authorizeAction } from './emqx-auth.service.js'

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

function isClientConnectedEvent(event: string): boolean {
	return event === 'client.connected'
}

function isSystemClientId(clientid: string): boolean {
	return clientid === env.EMQX_SYSTEM_CLIENT_ID
}

// Delayed (not fired inline) so the client's own SUBSCRIBE to
// player/{id}/challenge -- which it sends immediately after CONNECT -- has
// time to land first; see launcher-integrity.config.ts's
// LOGIN_CHALLENGE_DELAY_MS for why this is necessary (non-retained publish).
function handleClientConnected(clientid: string): void {
	if (isSystemClientId(clientid)) return
	setTimeout(() => {
		void launcherIntegrityService
			.handleClientConnected(clientid)
			.catch((err) =>
				console.error('[launcher-integrity] handleClientConnected error:', err),
			)
	}, LOGIN_CHALLENGE_DELAY_MS).unref()
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
	revokeSpectator(clientid)
	launcherIntegrityService.clearSession(clientid)
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
		} else if (isClientConnectedEvent(event)) {
			handleClientConnected(clientid)
		}

		res.status(200).json(ok())
	} catch (err) {
		console.error('[emqx] Webhook error:', err)
		res.status(200).json(ok())
	}
})

export default router
