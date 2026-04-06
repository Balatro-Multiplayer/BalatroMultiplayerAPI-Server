import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	authenticateAsTemp,
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
import { hashProviderId } from '../../utils/hash.js'
import * as playerDb from '../../services/player.service.js'

const mockPlayerRecord = {
	id: 'db-player-id',
	steamIdHash: null as string | null,
	discordIdHash: null as string | null,
	discordUsername: null as string | null,
	useDiscordName: false,
	preferredJoker: 'j_joker',
	privileges: [] as string[],
	steamName: 'OldName',
	chatEnabled: false,
	chatBlocked: false,
	tosAcceptedVersion: 0,
}

describe('auth.service', () => {
	describe('signJwt / verifyJwt', () => {
		it('signs and verifies a JWT round-trip', () => {
			const payload = { playerId: 'p1', steamName: 'Alice' }
			const token = signJwt(payload)

			expect(typeof token).toBe('string')
			expect(token.split('.')).toHaveLength(3)

			const decoded = verifyJwt(token)
			expect(decoded).toMatchObject(payload)
		})

		it('includes lobbyCode when provided', () => {
			const payload = {
				playerId: 'p1',
				steamName: 'Alice',
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
			const token = signJwt({ playerId: 'p1', steamName: 'Alice' })
			const tampered = `${token}x`
			expect(verifyJwt(tampered)).toBeNull()
		})
	})

	describe('authenticateWithSteam', () => {
		it('creates a new session for unknown steam ID', async () => {
			const { session, token } = await authenticateWithSteam('steam1', 'Alice')

			expect(session.playerId).toBeDefined()
			expect(session.steamName).toBe('Alice')
			expect(session.steamIdHash).toBe(hashProviderId('steam1'))
			expect(sessions.has(session.playerId)).toBe(true)
			expect(findByProvider('steam', hashProviderId('steam1'))).toBe(session)

			const decoded = verifyJwt(token)
			expect(decoded?.playerId).toBe(session.playerId)
		})

		it('does not call createPlayer for new steam users', async () => {
			await authenticateWithSteam('steam1', 'Alice')
			expect(playerDb.createPlayer).not.toHaveBeenCalled()
		})

		it('reuses existing in-memory session on re-auth', async () => {
			const first = await authenticateWithSteam('steam1', 'Alice')
			const second = await authenticateWithSteam('steam1', 'AliceV2')

			expect(first.session).toBe(second.session)
			expect(second.session.steamName).toBe('AliceV2')
		})

		it('updates steam name on re-auth', async () => {
			await authenticateWithSteam('steam1', 'Alice')
			vi.mocked(playerDb.updateSteamName).mockClear()

			await authenticateWithSteam('steam1', 'AliceV2')

			expect(playerDb.updateSteamName).toHaveBeenCalledOnce()
		})

		it('restores from DB when not in memory', async () => {
			const steamIdHash = hashProviderId('steam1')
			vi.mocked(playerDb.findPlayerBySteamIdHash).mockResolvedValueOnce({
				...mockPlayerRecord,
				steamIdHash,
				discordIdHash: 'some-discord-hash',
			})

			const { session } = await authenticateWithSteam('steam1', 'Alice')

			expect(session.playerId).toBe('db-player-id')
			expect(session.steamIdHash).toBe(steamIdHash)
			expect(session.discordIdHash).toBe('some-discord-hash')
			expect(session.steamName).toBe('Alice')
		})
	})

	describe('authenticateWithDiscord', () => {
		it('creates a new session for unknown discord ID', async () => {
			const { session, token } = await authenticateWithDiscord('disc1', 'Bob')

			expect(session.playerId).toBeDefined()
			expect(session.steamName).toBe('Bob')
			expect(session.discordIdHash).toBe(hashProviderId('disc1'))
			expect(findByProvider('discord', hashProviderId('disc1'))).toBe(session)

			const decoded = verifyJwt(token)
			expect(decoded?.playerId).toBe(session.playerId)
		})

		it('reuses existing in-memory session on re-auth', async () => {
			const first = await authenticateWithDiscord('disc1', 'Bob')
			const second = await authenticateWithDiscord('disc1', 'BobV2')

			expect(first.session).toBe(second.session)
			expect(second.session.steamName).toBe('BobV2')
		})

		it('restores from DB when not in memory', async () => {
			const discordIdHash = hashProviderId('disc1')
			vi.mocked(playerDb.findPlayerByDiscordIdHash).mockResolvedValueOnce({
				...mockPlayerRecord,
				steamIdHash: 'some-steam-hash',
				discordIdHash,
			})

			const { session } = await authenticateWithDiscord('disc1', 'Bob')

			expect(session.playerId).toBe('db-player-id')
			expect(session.discordIdHash).toBe(discordIdHash)
			expect(session.steamIdHash).toBe('some-steam-hash')
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
			const session = createSession('Alice', { discordIdHash: 'disc1' })

			const result = await linkSteamToPlayer(session.playerId, 'steam1')

			expect(result.session.steamIdHash).toBe(hashProviderId('steam1'))
			expect(findByProvider('steam', hashProviderId('steam1'))).toBe(session)
		})

		it('throws if session not found', async () => {
			await expect(
				linkSteamToPlayer('unknown', 'steam1'),
			).rejects.toThrow('Player session not found')
		})

		it('throws if steam already linked to another player', async () => {
			createSession('Alice', { steamIdHash: hashProviderId('steam1') })
			const bob = createSession('Bob', { discordIdHash: 'disc1' })

			await expect(
				linkSteamToPlayer(bob.playerId, 'steam1'),
			).rejects.toThrow('Steam account already linked to another player')
		})

		it('allows re-linking same steam to same player', async () => {
			const session = createSession('Alice', { steamIdHash: hashProviderId('steam1') })

			const result = await linkSteamToPlayer(session.playerId, 'steam1')
			expect(result.session.steamIdHash).toBe(hashProviderId('steam1'))
		})

		it('propagates DB errors from linkSteam', async () => {
			const session = createSession('Alice', { discordIdHash: 'disc1' })
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
			const session = createSession('Alice', { steamIdHash: 'steam1' })

			const result = await linkDiscordToPlayer(session.playerId, 'disc1')

			expect(result.session.discordIdHash).toBe(hashProviderId('disc1'))
			expect(findByProvider('discord', hashProviderId('disc1'))).toBe(session)
		})

		it('throws if session not found', async () => {
			await expect(
				linkDiscordToPlayer('unknown', 'disc1'),
			).rejects.toThrow('Player session not found')
		})

		it('throws if discord already linked to another player', async () => {
			createSession('Alice', { discordIdHash: hashProviderId('disc1') })
			const bob = createSession('Bob', { steamIdHash: 'steam1' })

			await expect(
				linkDiscordToPlayer(bob.playerId, 'disc1'),
			).rejects.toThrow('Discord account already linked to another player')
		})

		it('propagates DB errors from linkDiscord', async () => {
			const session = createSession('Alice', { steamIdHash: 'steam1' })
			vi.mocked(playerDb.linkDiscord).mockRejectedValueOnce(
				new Error('DB write failed'),
			)

			await expect(
				linkDiscordToPlayer(session.playerId, 'disc1'),
			).rejects.toThrow('DB write failed')
		})
	})

	describe('authenticateAsTemp', () => {
		it('creates a session with random UUID and no providers', () => {
			const { session, token } = authenticateAsTemp('DevUser')

			expect(session.playerId).toBeDefined()
			expect(session.steamName).toBe('DevUser')
			expect(session.steamIdHash).toBeUndefined()
			expect(session.discordIdHash).toBeUndefined()
			expect(sessions.has(session.playerId)).toBe(true)

			const decoded = verifyJwt(token)
			expect(decoded?.playerId).toBe(session.playerId)
			expect(decoded?.isTemp).toBe(true)
		})

		it('creates unique player IDs for each call', () => {
			const first = authenticateAsTemp('Dev1')
			const second = authenticateAsTemp('Dev2')

			expect(first.session.playerId).not.toBe(second.session.playerId)
		})

		it('does not populate provider indexes', () => {
			authenticateAsTemp('DevUser')

			expect(steamIndex.size).toBe(0)
			expect(discordIndex.size).toBe(0)
		})

		it('does not call any playerDb functions', () => {
			authenticateAsTemp('DevUser')

			expect(playerDb.createPlayer).not.toHaveBeenCalled()
			expect(playerDb.updateSteamName).not.toHaveBeenCalled()
			expect(playerDb.findPlayerBySteamIdHash).not.toHaveBeenCalled()
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
				steamName: 'Alice',
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
