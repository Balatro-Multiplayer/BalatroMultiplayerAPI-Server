import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	authenticateWithSteam,
	authenticateWithDiscord,
	generateLinkState,
	linkSteamToPlayer,
	linkDiscordToPlayer,
	linkStateNonces,
	signJwt,
	validateSteamTicket,
	verifyJwt,
	verifyLinkState,
} from '../../services/auth.service.js'
import {
	createSession,
	findByProvider,
	sessions,
	steamIndex,
	discordIndex,
} from '../../state/index.js'
import * as playerDb from '../../services/player.service.js'

describe('auth.service', () => {
	describe('signJwt / verifyJwt', () => {
		it('signs and verifies a JWT round-trip', () => {
			const payload = { playerId: 'p1', username: 'Alice' }
			const token = signJwt(payload)

			expect(typeof token).toBe('string')
			expect(token.split('.')).toHaveLength(3)

			const decoded = verifyJwt(token)
			expect(decoded).toMatchObject(payload)
		})

		it('includes lobbyCode when provided', () => {
			const payload = {
				playerId: 'p1',
				username: 'Alice',
				lobbyCode: 'ABCDE',
			}
			const token = signJwt(payload)
			const decoded = verifyJwt(token)
			expect(decoded?.lobbyCode).toBe('ABCDE')
		})

		it('returns null for invalid token', () => {
			expect(verifyJwt('garbage.token.here')).toBeNull()
		})

		it('returns null for tampered token', () => {
			const token = signJwt({ playerId: 'p1', username: 'Alice' })
			const tampered = `${token}x`
			expect(verifyJwt(tampered)).toBeNull()
		})
	})

	describe('authenticateWithSteam', () => {
		it('creates a new session for unknown steam ID', async () => {
			const { session, token } = await authenticateWithSteam(
				'steam1',
				'Alice',
			)

			expect(session.playerId).toBeDefined()
			expect(session.username).toBe('Alice')
			expect(session.steamId).toBe('steam1')
			expect(sessions.has(session.playerId)).toBe(true)
			expect(findByProvider('steam', 'steam1')).toBe(session)

			const decoded = verifyJwt(token)
			expect(decoded?.playerId).toBe(session.playerId)
		})

		it('reuses existing in-memory session on re-auth', async () => {
			const first = await authenticateWithSteam('steam1', 'Alice')
			const second = await authenticateWithSteam('steam1', 'AliceV2')

			expect(first.session).toBe(second.session)
			expect(second.session.username).toBe('AliceV2')
		})

		it('restores from DB when not in memory', async () => {
			vi.mocked(playerDb.findPlayerBySteamId).mockResolvedValueOnce({
				id: 'db-player-id',
				steamId: 'steam1',
				discordId: 'disc1',
				username: 'OldName',
			})

			const { session } = await authenticateWithSteam('steam1', 'Alice')

			expect(session.playerId).toBe('db-player-id')
			expect(session.steamId).toBe('steam1')
			expect(session.discordId).toBe('disc1')
			expect(session.username).toBe('Alice')
		})

		it('propagates DB errors from createPlayer', async () => {
			vi.mocked(playerDb.createPlayer).mockRejectedValueOnce(
				new Error('DB connection failed'),
			)

			await expect(
				authenticateWithSteam('steam1', 'Alice'),
			).rejects.toThrow('DB connection failed')
		})

		it('propagates DB errors from updateUsername', async () => {
			// Create existing in-memory session
			await authenticateWithSteam('steam1', 'Alice')
			vi.mocked(playerDb.updateUsername).mockRejectedValueOnce(
				new Error('DB write failed'),
			)

			await expect(
				authenticateWithSteam('steam1', 'AliceV2'),
			).rejects.toThrow('DB write failed')
		})
	})

	describe('authenticateWithDiscord', () => {
		it('creates a new session for unknown discord ID', async () => {
			const { session, token } = await authenticateWithDiscord(
				'disc1',
				'Bob',
			)

			expect(session.playerId).toBeDefined()
			expect(session.username).toBe('Bob')
			expect(session.discordId).toBe('disc1')
			expect(findByProvider('discord', 'disc1')).toBe(session)

			const decoded = verifyJwt(token)
			expect(decoded?.playerId).toBe(session.playerId)
		})

		it('reuses existing in-memory session on re-auth', async () => {
			const first = await authenticateWithDiscord('disc1', 'Bob')
			const second = await authenticateWithDiscord('disc1', 'BobV2')

			expect(first.session).toBe(second.session)
			expect(second.session.username).toBe('BobV2')
		})

		it('restores from DB when not in memory', async () => {
			vi.mocked(playerDb.findPlayerByDiscordId).mockResolvedValueOnce({
				id: 'db-player-id',
				steamId: 'steam1',
				discordId: 'disc1',
				username: 'OldName',
			})

			const { session } = await authenticateWithDiscord('disc1', 'Bob')

			expect(session.playerId).toBe('db-player-id')
			expect(session.steamId).toBe('steam1')
			expect(session.discordId).toBe('disc1')
		})

		it('propagates DB errors from createPlayer', async () => {
			vi.mocked(playerDb.createPlayer).mockRejectedValueOnce(
				new Error('DB connection failed'),
			)

			await expect(
				authenticateWithDiscord('disc1', 'Bob'),
			).rejects.toThrow('DB connection failed')
		})
	})

	describe('linkSteamToPlayer', () => {
		it('links steam to an existing session', async () => {
			const session = createSession('Alice', { discordId: 'disc1' })

			const result = await linkSteamToPlayer(session.playerId, 'steam1')

			expect(result.session.steamId).toBe('steam1')
			expect(findByProvider('steam', 'steam1')).toBe(session)
		})

		it('throws if session not found', async () => {
			await expect(
				linkSteamToPlayer('unknown', 'steam1'),
			).rejects.toThrow('Player session not found')
		})

		it('throws if steam already linked to another player', async () => {
			const alice = createSession('Alice', { steamId: 'steam1' })
			const bob = createSession('Bob', { discordId: 'disc1' })

			await expect(
				linkSteamToPlayer(bob.playerId, 'steam1'),
			).rejects.toThrow('Steam account already linked to another player')
		})

		it('allows re-linking same steam to same player', async () => {
			const session = createSession('Alice', { steamId: 'steam1' })

			const result = await linkSteamToPlayer(session.playerId, 'steam1')
			expect(result.session.steamId).toBe('steam1')
		})

		it('propagates DB errors from linkSteam', async () => {
			const session = createSession('Alice', { discordId: 'disc1' })
			vi.mocked(playerDb.linkSteam).mockRejectedValueOnce(
				new Error('DB write failed'),
			)

			await expect(
				linkSteamToPlayer(session.playerId, 'steam1'),
			).rejects.toThrow('DB write failed')
		})
	})

	describe('linkDiscordToPlayer', () => {
		it('links discord to an existing session', async () => {
			const session = createSession('Alice', { steamId: 'steam1' })

			const result = await linkDiscordToPlayer(session.playerId, 'disc1')

			expect(result.session.discordId).toBe('disc1')
			expect(findByProvider('discord', 'disc1')).toBe(session)
		})

		it('throws if session not found', async () => {
			await expect(
				linkDiscordToPlayer('unknown', 'disc1'),
			).rejects.toThrow('Player session not found')
		})

		it('throws if discord already linked to another player', async () => {
			const alice = createSession('Alice', { discordId: 'disc1' })
			const bob = createSession('Bob', { steamId: 'steam1' })

			await expect(
				linkDiscordToPlayer(bob.playerId, 'disc1'),
			).rejects.toThrow(
				'Discord account already linked to another player',
			)
		})

		it('propagates DB errors from linkDiscord', async () => {
			const session = createSession('Alice', { steamId: 'steam1' })
			vi.mocked(playerDb.linkDiscord).mockRejectedValueOnce(
				new Error('DB write failed'),
			)

			await expect(
				linkDiscordToPlayer(session.playerId, 'disc1'),
			).rejects.toThrow('DB write failed')
		})
	})

	describe('validateSteamTicket', () => {
		afterEach(() => {
			vi.restoreAllMocks()
		})

		it('returns steamId for valid ticket', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response(
					JSON.stringify({
						response: {
							params: {
								result: 'OK',
								steamid: '76561198012345',
								ownersteamid: '76561198012345',
								vacbanned: false,
								publisherbanned: false,
							},
						},
					}),
					{ status: 200 },
				),
			)

			const result = await validateSteamTicket('hex-ticket')
			expect(result.steamId).toBe('76561198012345')
		})

		it('throws on invalid ticket', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response(
					JSON.stringify({
						response: {
							params: {
								result: 'FAIL',
								steamid: '',
								ownersteamid: '',
								vacbanned: false,
								publisherbanned: false,
							},
						},
					}),
					{ status: 200 },
				),
			)

			await expect(validateSteamTicket('bad-ticket')).rejects.toThrow(
				'Invalid Steam ticket',
			)
		})

		it('throws on Steam API HTTP error', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response('', { status: 500 }),
			)

			await expect(validateSteamTicket('ticket')).rejects.toThrow(
				'Steam API request failed',
			)
		})
	})

	describe('generateLinkState / verifyLinkState', () => {
		it('generates a valid link state and verifies it', () => {
			const playerId = 'player-123'
			const state = generateLinkState(playerId)

			expect(typeof state).toBe('string')
			expect(state.split('.')).toHaveLength(3)

			const result = verifyLinkState(state)
			expect(result).toBe(playerId)
		})

		it('consumes nonce on first use (one-time use)', () => {
			const state = generateLinkState('player-123')

			expect(verifyLinkState(state)).toBe('player-123')
			expect(verifyLinkState(state)).toBeNull()
		})

		it('returns null for invalid state token', () => {
			expect(verifyLinkState('garbage.token.here')).toBeNull()
		})

		it('returns null for a regular JWT (wrong purpose)', () => {
			const regularToken = signJwt({
				playerId: 'player-123',
				username: 'Alice',
			})
			expect(verifyLinkState(regularToken)).toBeNull()
		})

		it('returns null for expired nonce', () => {
			const state = generateLinkState('player-123')

			// Manually expire the nonce
			for (const [, entry] of linkStateNonces) {
				entry.expiresAt = Date.now() - 1000
			}

			expect(verifyLinkState(state)).toBeNull()
		})
	})
})
