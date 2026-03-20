import { env } from '../env.js'
import { Lobby } from './lobby.js'
import { PlayerSession } from './player.js'

export const lobbies = new Map<string, Lobby>()
export const sessions = new Map<string, PlayerSession>()

// Hashed provider ID → playerId lookup indexes
export const steamIndex = new Map<string, string>()
export const discordIndex = new Map<string, string>()

export function createSession(
	steamName: string,
	opts?: { id?: string; steamIdHash?: string; discordIdHash?: string; discordUsername?: string; useDiscordName?: boolean; preferredJoker?: string; privileges?: string[]; tosAcceptedVersion?: number },
): PlayerSession {
	const session = new PlayerSession(steamName, opts)
	sessions.set(session.playerId, session)
	if (opts?.steamIdHash) steamIndex.set(opts.steamIdHash, session.playerId)
	if (opts?.discordIdHash) discordIndex.set(opts.discordIdHash, session.playerId)
	return session
}

export function findByProvider(
	provider: 'steam' | 'discord',
	idHash: string,
): PlayerSession | undefined {
	const index = provider === 'steam' ? steamIndex : discordIndex
	const playerId = index.get(idHash)
	if (!playerId) return undefined
	return sessions.get(playerId)
}

export function linkProvider(
	session: PlayerSession,
	provider: 'steam' | 'discord',
	idHash: string,
): void {
	if (provider === 'steam') {
		session.steamIdHash = idHash
		steamIndex.set(idHash, session.playerId)
	} else {
		session.discordIdHash = idHash
		discordIndex.set(idHash, session.playerId)
	}
}

export function unlinkProvider(
	session: PlayerSession,
	provider: 'steam' | 'discord',
): void {
	if (provider === 'steam') {
		if (session.steamIdHash) steamIndex.delete(session.steamIdHash)
		session.steamIdHash = undefined
	} else {
		if (session.discordIdHash) discordIndex.delete(session.discordIdHash)
		session.discordIdHash = undefined
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
		if (session.steamIdHash) steamIndex.delete(session.steamIdHash)
		if (session.discordIdHash) discordIndex.delete(session.discordIdHash)
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
