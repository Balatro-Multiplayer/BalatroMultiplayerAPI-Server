import { describe, expect, it, vi } from 'vitest'
import {
	Lobby,
	cleanupExpiredSessions,
	createSession,
	discordIndex,
	findByProvider,
	getLobby,
	getSession,
	linkProvider,
	lobbies,
	removeSession,
	sessions,
	steamIndex,
} from '../../state/index.js'

describe('state helpers', () => {
	describe('createSession', () => {
		it('creates a session with a generated ID', () => {
			const session = createSession('Alice', { steamId: 'steam1' })
			expect(session.playerId).toBeDefined()
			expect(session.steamName).toBe('Alice')
			expect(session.steamId).toBe('steam1')
			expect(sessions.has(session.playerId)).toBe(true)
		})

		it('indexes steam ID', () => {
			const session = createSession('Alice', { steamId: 'steam1' })
			expect(steamIndex.get('steam1')).toBe(session.playerId)
		})

		it('indexes discord ID', () => {
			const session = createSession('Alice', { discordId: 'disc1' })
			expect(discordIndex.get('disc1')).toBe(session.playerId)
		})

		it('indexes both when provided', () => {
			const session = createSession('Alice', {
				steamId: 'steam1',
				discordId: 'disc1',
			})
			expect(steamIndex.get('steam1')).toBe(session.playerId)
			expect(discordIndex.get('disc1')).toBe(session.playerId)
		})
	})

	describe('findByProvider', () => {
		it('finds session by steam ID', () => {
			const session = createSession('Alice', { steamId: 'steam1' })
			expect(findByProvider('steam', 'steam1')).toBe(session)
		})

		it('finds session by discord ID', () => {
			const session = createSession('Alice', { discordId: 'disc1' })
			expect(findByProvider('discord', 'disc1')).toBe(session)
		})

		it('returns undefined for unknown provider ID', () => {
			expect(findByProvider('steam', 'unknown')).toBeUndefined()
		})
	})

	describe('linkProvider', () => {
		it('links steam to an existing session', () => {
			const session = createSession('Alice', { discordId: 'disc1' })
			linkProvider(session, 'steam', 'steam1')

			expect(session.steamId).toBe('steam1')
			expect(steamIndex.get('steam1')).toBe(session.playerId)
			expect(findByProvider('steam', 'steam1')).toBe(session)
		})

		it('links discord to an existing session', () => {
			const session = createSession('Alice', { steamId: 'steam1' })
			linkProvider(session, 'discord', 'disc1')

			expect(session.discordId).toBe('disc1')
			expect(discordIndex.get('disc1')).toBe(session.playerId)
		})
	})

	describe('getSession', () => {
		it('returns undefined for unknown player', () => {
			expect(getSession('nobody')).toBeUndefined()
		})

		it('returns the session for a known player', () => {
			const session = createSession('Alice')
			expect(getSession(session.playerId)).toBe(session)
		})
	})

	describe('removeSession', () => {
		it('removes session and cleans up indexes', () => {
			const session = createSession('Alice', {
				steamId: 'steam1',
				discordId: 'disc1',
			})

			removeSession(session.playerId)

			expect(getSession(session.playerId)).toBeUndefined()
			expect(steamIndex.has('steam1')).toBe(false)
			expect(discordIndex.has('disc1')).toBe(false)
		})

		it('is a no-op for unknown player', () => {
			removeSession('nobody')
			expect(sessions.size).toBe(0)
		})
	})

	describe('getLobby', () => {
		it('returns undefined for unknown code', () => {
			expect(getLobby('ZZZZZ')).toBeUndefined()
		})

		it('returns the lobby for a known code', () => {
			const lobby = new Lobby('ABCDE', 'mod1', 'host1')
			lobbies.set('ABCDE', lobby)
			expect(getLobby('ABCDE')).toBe(lobby)
		})

		it('is case-insensitive', () => {
			const lobby = new Lobby('ABCDE', 'mod1', 'host1')
			lobbies.set('ABCDE', lobby)
			expect(getLobby('abcde')).toBe(lobby)
		})
	})

	describe('cleanupExpiredSessions', () => {
		it('removes sessions older than TTL', () => {
			const session = createSession('Alice', { steamId: 'steam1' })
			// Backdate connectedAt to exceed the 24h default TTL
			;(session as any).connectedAt = new Date(
				Date.now() - 25 * 60 * 60 * 1000,
			)

			const removed = cleanupExpiredSessions()

			expect(removed).toBe(1)
			expect(getSession(session.playerId)).toBeUndefined()
			expect(steamIndex.has('steam1')).toBe(false)
		})

		it('does not remove active sessions', () => {
			const session = createSession('Alice', { steamId: 'steam1' })
			// connectedAt is "now" which is within TTL

			const removed = cleanupExpiredSessions()

			expect(removed).toBe(0)
			expect(getSession(session.playerId)).toBe(session)
		})

		it('skips sessions in a lobby even if expired', () => {
			const session = createSession('Alice', { steamId: 'steam1' })
			;(session as any).connectedAt = new Date(
				Date.now() - 25 * 60 * 60 * 1000,
			)
			session.lobbyCode = 'ABCDE'

			const removed = cleanupExpiredSessions()

			expect(removed).toBe(0)
			expect(getSession(session.playerId)).toBe(session)
		})

		it('cleans up provider indexes for removed sessions', () => {
			const session = createSession('Alice', {
				steamId: 'steam1',
				discordId: 'disc1',
			})
			;(session as any).connectedAt = new Date(
				Date.now() - 25 * 60 * 60 * 1000,
			)

			cleanupExpiredSessions()

			expect(steamIndex.has('steam1')).toBe(false)
			expect(discordIndex.has('disc1')).toBe(false)
		})

		it('handles mixed expired and active sessions', () => {
			const expired = createSession('Expired', { steamId: 'steam1' })
			;(expired as any).connectedAt = new Date(
				Date.now() - 25 * 60 * 60 * 1000,
			)

			const active = createSession('Active', { steamId: 'steam2' })

			const removed = cleanupExpiredSessions()

			expect(removed).toBe(1)
			expect(getSession(expired.playerId)).toBeUndefined()
			expect(getSession(active.playerId)).toBe(active)
		})
	})
})
