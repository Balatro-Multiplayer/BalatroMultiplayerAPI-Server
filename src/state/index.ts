import { env } from '../env.js'
import { Lobby } from './lobby.js'
import { PlayerSession } from './player.js'

export const lobbies = new Map<string, Lobby>()
export const sessions = new Map<string, PlayerSession>()

// Provider ID → playerId lookup indexes
export const steamIndex = new Map<string, string>()
export const discordIndex = new Map<string, string>()

export function createSession(
	steamName: string,
	opts?: { id?: string; steamId?: string; discordId?: string; discordUsername?: string; useDiscordName?: boolean; preferredJoker?: string; privileges?: string[] },
): PlayerSession {
	const session = new PlayerSession(steamName, opts)
	sessions.set(session.playerId, session)
	if (opts?.steamId) steamIndex.set(opts.steamId, session.playerId)
	if (opts?.discordId) discordIndex.set(opts.discordId, session.playerId)
	return session
}

export function findByProvider(
	provider: 'steam' | 'discord',
	providerId: string,
): PlayerSession | undefined {
	const index = provider === 'steam' ? steamIndex : discordIndex
	const playerId = index.get(providerId)
	if (!playerId) return undefined
	return sessions.get(playerId)
}

export function linkProvider(
	session: PlayerSession,
	provider: 'steam' | 'discord',
	providerId: string,
): void {
	if (provider === 'steam') {
		session.steamId = providerId
		steamIndex.set(providerId, session.playerId)
	} else {
		session.discordId = providerId
		discordIndex.set(providerId, session.playerId)
	}
}

export function unlinkProvider(
	session: PlayerSession,
	provider: 'steam' | 'discord',
): void {
	if (provider === 'steam') {
		if (session.steamId) steamIndex.delete(session.steamId)
		session.steamId = undefined
	} else {
		if (session.discordId) discordIndex.delete(session.discordId)
		session.discordId = undefined
		session.discordUsername = undefined
	}
}

export function getSession(playerId: string): PlayerSession | undefined {
	return sessions.get(playerId)
}

export function getLobby(code: string): Lobby | undefined {
	return lobbies.get(code.toUpperCase())
}

export function removeSession(playerId: string): void {
	const session = sessions.get(playerId)
	if (session) {
		if (session.steamId) steamIndex.delete(session.steamId)
		if (session.discordId) discordIndex.delete(session.discordId)
	}
	sessions.delete(playerId)
}

// --- Session cleanup ---

function parseExpiresIn(value: string): number {
	const match = value.match(/^(\d+)(s|m|h|d)$/)
	if (!match) return 24 * 60 * 60 * 1000 // default 24h
	const num = Number(match[1])
	switch (match[2]) {
		case 's':
			return num * 1000
		case 'm':
			return num * 60 * 1000
		case 'h':
			return num * 60 * 60 * 1000
		case 'd':
			return num * 24 * 60 * 60 * 1000
		default:
			return 24 * 60 * 60 * 1000
	}
}

export function cleanupExpiredSessions(): number {
	const ttl = parseExpiresIn(env.JWT_EXPIRES_IN)
	const now = Date.now()
	let removed = 0

	for (const [playerId, session] of sessions) {
		if (session.lobbyCode) continue
		if (now - session.connectedAt.getTime() > ttl) {
			removeSession(playerId)
			removed++
		}
	}

	return removed
}

let cleanupInterval: ReturnType<typeof setInterval> | null = null

export function startSessionCleanup(intervalMs = 60_000): void {
	if (cleanupInterval) return
	cleanupInterval = setInterval(() => {
		const removed = cleanupExpiredSessions()
		if (removed > 0) {
			console.log(`[state] Cleaned up ${removed} expired sessions`)
		}
	}, intervalMs)
	cleanupInterval.unref()
}

export function stopSessionCleanup(): void {
	if (cleanupInterval) {
		clearInterval(cleanupInterval)
		cleanupInterval = null
	}
}

export { Lobby, PlayerSession }
