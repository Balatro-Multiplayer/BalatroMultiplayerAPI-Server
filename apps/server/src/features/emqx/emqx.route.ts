import { Router } from 'express'
import { env } from '../../env.js'
import {
	cancelGracePeriodImmediate,
	notifyReconnected,
	startGracePeriod,
} from '../../infrastructure/mqtt/grace-period.service.js'
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

	// Cancel any pending ranked-forfeit grace period the instant the raw MQTT
	// CONNECT succeeds -- this fires on every reconnect (client redialing with
	// its still-cached JWT, no HTTP re-auth needed) as well as a fresh login,
	// and cancelGracePeriodImmediate is a no-op if the player wasn't in one.
	// Safe to run inline (unlike notifyReconnected below): it only touches the
	// in-memory timer/map, no MQTT publish. This closes the race that let a
	// reconnected-but-still-mid-match player get auto-forfeited anyway (see
	// grace-period.service.ts's GRACE_PERIOD_MS and expireGracePeriod).
	const reconnectedEntry = cancelGracePeriodImmediate(clientid)

	setTimeout(() => {
		if (reconnectedEntry) {
			void notifyReconnected(reconnectedEntry).catch((err) =>
				console.error('[grace-period] notifyReconnected error:', err),
			)
		}

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
