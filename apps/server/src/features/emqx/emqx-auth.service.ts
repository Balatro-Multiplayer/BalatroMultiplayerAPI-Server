import { env } from '../../env.js'
import { getLobby, getSession } from '../../state/index.js'
import { getConfig } from '../../state/config.js'
import { Lobby } from '../../state/lobby.js'
import type { EmqxAuthRequest, EmqxAuthzRequest } from '../../shared/types/index.js'
import { verifyJwt } from '../auth/auth.service.js'

type Action = 'publish' | 'subscribe'
type AuthzResult = { result: 'allow' | 'deny' }

const allow = (): AuthzResult => ({ result: 'allow' })
const deny = (): AuthzResult => ({ result: 'deny' })
const allowIf = (condition: boolean): AuthzResult =>
	condition ? allow() : deny()

function isSystemClient(body: EmqxAuthRequest): boolean {
	return (
		body.clientid === env.EMQX_SYSTEM_CLIENT_ID &&
		body.username === env.EMQX_SYSTEM_USERNAME &&
		body.password === env.EMQX_SYSTEM_PASSWORD
	)
}

function verifyPlayerSessionToken(token: string): { playerId: string } | null {
	const payload = verifyJwt(token)
	if (!payload || payload.purpose) return null
	return { playerId: payload.playerId }
}

function clientIdMatchesToken(clientid: string, tokenPlayerId: string): boolean {
	return clientid === tokenPlayerId
}

function hasActiveSession(playerId: string): boolean {
	return getSession(playerId) !== undefined
}

function hasAcceptedCurrentTos(playerId: string): boolean {
	const session = getSession(playerId)
	if (!session) return false
	return session.tosAcceptedVersion >= getConfig().tosVersion
}

export async function authenticateClient(
	body: EmqxAuthRequest,
): Promise<{ result: 'allow' | 'deny'; is_superuser: boolean }> {
	if (isSystemClient(body)) {
		return { result: 'allow', is_superuser: true }
	}

	const token = verifyPlayerSessionToken(body.password)
	if (!token) return { result: 'deny', is_superuser: false }

	if (!clientIdMatchesToken(body.clientid, token.playerId)) {
		return { result: 'deny', is_superuser: false }
	}

	if (!hasActiveSession(token.playerId)) {
		return { result: 'deny', is_superuser: false }
	}

	if (!hasAcceptedCurrentTos(token.playerId)) {
		return { result: 'deny', is_superuser: false }
	}

	return { result: 'allow', is_superuser: false }
}

function isPlayerNotificationTopic(parts: string[]): boolean {
	return parts[0] === 'player' && parts.length >= 3
}

function authorizePlayerNotificationTopic(
	parts: string[],
	clientid: string,
	action: Action,
): AuthzResult {
	if (action !== 'subscribe') return deny()
	const topicPlayerId = parts[1]
	return allowIf(topicPlayerId === clientid)
}

function isGlobalNotificationsTopic(parts: string[]): boolean {
	return parts[0] === 'bmp' && parts[1] === 'notifications'
}

function authorizeGlobalNotificationsTopic(action: Action): AuthzResult {
	return allowIf(action === 'subscribe')
}

function isLobbyTopic(parts: string[]): boolean {
	return parts[0] === 'lobby' && parts.length >= 3
}

function authorizeLobbyMetadata(
	lobby: Lobby,
	clientid: string,
	action: Action,
): AuthzResult {
	if (action === 'subscribe') return allow()
	if (lobby.type === 'public') return deny()
	return allowIf(lobby.hostId === clientid)
}

function authorizeLobbyEvents(action: Action): AuthzResult {
	return allowIf(action === 'subscribe')
}

function authorizeLobbyPlayerState(
	targetPlayerId: string,
	clientid: string,
): AuthzResult {
	return allowIf(targetPlayerId === clientid)
}

function authorizeLobbyPlayerInfo(action: Action): AuthzResult {
	return allowIf(action === 'subscribe')
}

function authorizeLobbyPlayerActions(
	targetPlayerId: string,
	clientid: string,
	action: Action,
): AuthzResult {
	if (action === 'subscribe') return allow()
	return allowIf(targetPlayerId === clientid)
}

function authorizeLobbyPlayers(
	parts: string[],
	clientid: string,
	action: Action,
): AuthzResult {
	if (parts.length < 5) return deny()
	const targetPlayerId = parts[3]
	const subtype = parts[4]

	switch (subtype) {
		case 'state':
			return authorizeLobbyPlayerState(targetPlayerId, clientid)
		case 'info':
			return authorizeLobbyPlayerInfo(action)
		case 'actions':
			return authorizeLobbyPlayerActions(targetPlayerId, clientid, action)
		default:
			return deny()
	}
}

function authorizeLobbyActions(
	parts: string[],
	clientid: string,
	action: Action,
): AuthzResult {
	if (parts.length < 4) return deny()
	const targetPlayerId = parts[3]
	if (action === 'subscribe') return allowIf(targetPlayerId === clientid)
	return allow()
}

function isChatAccessibleForSession(clientid: string): boolean {
	const session = getSession(clientid)
	if (!session) return false
	return session.chatEnabled && !session.chatBlocked
}

function authorizeLobbyChat(clientid: string, action: Action): AuthzResult {
	if (action !== 'subscribe') return deny()
	return allowIf(isChatAccessibleForSession(clientid))
}

function authorizeLobbyTopic(
	parts: string[],
	clientid: string,
	action: Action,
): AuthzResult {
	const lobbyCode = parts[1]
	const lobby = getLobby(lobbyCode)
	if (!lobby) return deny()
	if (!lobby.hasPlayer(clientid)) return deny()

	const topicType = parts[2]
	switch (topicType) {
		case 'metadata':
			return authorizeLobbyMetadata(lobby, clientid, action)
		case 'events':
			return authorizeLobbyEvents(action)
		case 'players':
			return authorizeLobbyPlayers(parts, clientid, action)
		case 'actions':
			return authorizeLobbyActions(parts, clientid, action)
		case 'chat':
			return authorizeLobbyChat(clientid, action)
		default:
			return deny()
	}
}

export async function authorizeAction(
	body: EmqxAuthzRequest,
): Promise<AuthzResult> {
	const { clientid, topic, action } = body
	const parts = topic.split('/')

	if (isPlayerNotificationTopic(parts)) {
		return authorizePlayerNotificationTopic(parts, clientid, action)
	}

	if (isGlobalNotificationsTopic(parts)) {
		return authorizeGlobalNotificationsTopic(action)
	}

	if (isLobbyTopic(parts)) {
		return authorizeLobbyTopic(parts, clientid, action)
	}

	return deny()
}
