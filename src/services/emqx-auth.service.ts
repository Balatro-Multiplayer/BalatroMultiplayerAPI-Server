import { env } from '../env.js'
import { getLobby, getSession } from '../state/index.js'
import { getConfig } from '../state/config.js'
import type { EmqxAuthRequest, EmqxAuthzRequest } from '../types/index.js'
import { verifyJwt } from './auth.service.js'

// --- Chat rate limiting ---

const CHAT_WINDOW_MS = 5000
const CHAT_MAX_MESSAGES = 5

// playerId → array of timestamps
export const chatTimestamps = new Map<string, number[]>()

function isChatRateLimited(playerId: string): boolean {
	const now = Date.now()
	let timestamps = chatTimestamps.get(playerId)

	if (!timestamps) {
		timestamps = []
		chatTimestamps.set(playerId, timestamps)
	}

	// Remove timestamps outside the window
	const cutoff = now - CHAT_WINDOW_MS
	while (timestamps.length > 0 && timestamps[0] <= cutoff) {
		timestamps.shift()
	}

	if (timestamps.length >= CHAT_MAX_MESSAGES) {
		return true
	}

	timestamps.push(now)
	return false
}

// --- EMQX Authentication ---

export async function authenticateClient(
	body: EmqxAuthRequest,
): Promise<{ result: 'allow' | 'deny'; is_superuser: boolean }> {
	// System client (API server) gets superuser access
	if (
		body.clientid === env.EMQX_SYSTEM_CLIENT_ID &&
		body.username === env.EMQX_SYSTEM_USERNAME &&
		body.password === env.EMQX_SYSTEM_PASSWORD
	) {
		return { result: 'allow', is_superuser: true }
	}

	// Validate JWT from password field — reject purpose-scoped tokens (e.g. tos-accept)
	const payload = verifyJwt(body.password)
	if (!payload || payload.purpose) {
		return { result: 'deny', is_superuser: false }
	}

	// Client ID must match the player ID in the JWT
	if (body.clientid !== payload.playerId) {
		return { result: 'deny', is_superuser: false }
	}

	// Verify an active session exists
	const session = getSession(payload.playerId)
	if (!session) {
		return { result: 'deny', is_superuser: false }
	}

	// Enforce ToS: player must have accepted the current server ToS version
	const { tosVersion } = getConfig()
	if (session.tosAcceptedVersion < tosVersion) {
		return { result: 'deny', is_superuser: false }
	}

	return { result: 'allow', is_superuser: false }
}

export async function authorizeAction(
	body: EmqxAuthzRequest,
): Promise<{ result: 'allow' | 'deny' }> {
	const { clientid, topic, action } = body

	const parts = topic.split('/')

	// Player notification topics: player/{playerId}/#
	// Players can subscribe to their own topics; only server (superuser) publishes
	if (parts[0] === 'player' && parts.length >= 3) {
		const topicPlayerId = parts[1]
		if (action === 'subscribe') {
			return { result: topicPlayerId === clientid ? 'allow' : 'deny' }
		}
		// Non-superuser clients cannot publish to player topics
		return { result: 'deny' }
	}

	// Global notification topics: bmp/notifications/+
	// Any authenticated client may subscribe; only the server (superuser) publishes.
	if (parts[0] === 'bmp' && parts[1] === 'notifications') {
		if (action === 'subscribe') return { result: 'allow' }
		return { result: 'deny' }
	}

	if (parts[0] !== 'lobby' || parts.length < 3) {
		return { result: 'deny' }
	}

	const lobbyCode = parts[1]
	const topicType = parts[2]

	// Verify lobby exists and player is a member
	const lobby = getLobby(lobbyCode)
	if (!lobby) {
		return { result: 'deny' }
	}

	if (!lobby.hasPlayer(clientid)) {
		return { result: 'deny' }
	}

	switch (topicType) {
		case 'metadata': {
			if (action === 'subscribe') return { result: 'allow' }
			if (action === 'publish') {
				return { result: lobby.hostId === clientid ? 'allow' : 'deny' }
			}
			break
		}

		case 'events': {
			// Only the server publishes events; clients subscribe only
			if (action === 'subscribe') return { result: 'allow' }
			return { result: 'deny' }
		}

		case 'players': {
			// lobby/{code}/players/{playerId}/state
			if (parts.length < 5 || parts[4] !== 'state') {
				return { result: 'deny' }
			}
			const statePlayerId = parts[3]

			if (action === 'subscribe') {
				// Players can only read their own state (privacy)
				// Wildcard subscribe (players/+/state) is denied for regular clients
				// Spectators/privileged access can be granted in the future
				return { result: statePlayerId === clientid ? 'allow' : 'deny' }
			}
			if (action === 'publish') {
				// Players can only write their own state
				return { result: statePlayerId === clientid ? 'allow' : 'deny' }
			}
			break
		}

		case 'actions': {
			// lobby/{code}/actions/{targetPlayerId}
			if (parts.length < 4) return { result: 'deny' }
			const targetPlayerId = parts[3]

			if (action === 'subscribe') {
				// Players can only subscribe to their own action topic
				return { result: targetPlayerId === clientid ? 'allow' : 'deny' }
			}
			if (action === 'publish') {
				// Any lobby member can send actions to any other member
				return { result: 'allow' }
			}
			break
		}

		case 'chat': {
			// lobby/{code}/chat/{senderPlayerId}
			if (parts.length < 4) return { result: 'deny' }
			const chatSenderId = parts[3]

			if (action === 'subscribe') {
				// Any lobby member can read chat
				// Support wildcard subscribe: lobby/{code}/chat/+
				return { result: 'allow' }
			}
			if (action === 'publish') {
				// Players can only publish to their own chat subtopic
				if (chatSenderId !== clientid) return { result: 'deny' }
				// Rate limit chat messages
				if (isChatRateLimited(clientid)) return { result: 'deny' }
				return { result: 'allow' }
			}
			break
		}

		default:
			return { result: 'deny' }
	}

	return { result: 'deny' }
}
