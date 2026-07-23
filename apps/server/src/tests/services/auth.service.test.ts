import { afterEach, describe, expect, it, vi } from 'vitest'
import type { IGracePeriodService } from '../../contracts/IGracePeriodService.js'
import type {
	IPlayerRepository,
	PlayerRecord,
} from '../../contracts/IPlayerRepository.js'
import {
	authenticateAsTemp,
	createAuthService,
} from '../../features/auth/auth.service.js'
import { signJwt, verifyJwt } from '../../features/auth/jwt.js'
import {
	generateLinkState,
	linkStateNonces,
	verifyLinkState,
} from '../../features/auth/link-state.js'
import { validateSteamTicket } from '../../features/auth/steam.js'
import { hashProviderId } from '../../shared/utils/hash.js'
import {
	createSession,
	discordIndex,
	findByProvider,
	sessions,
	steamIndex,
} from '../../state/index.js'

const mockPlayerRecord: PlayerRecord = {
	id: 'db-player-id',
	steamIdHash: null,
	discordIdHash: null,
	discordUsername: null,
	useDiscordName: false,
	preferredJoker: 'j_joker',
	privileges: [],
	steamName: 'OldName',
	chatEnabled: false,
	chatBlocked: false,
	tosAcceptedVersion: 0,
	deletedAt: null,
}

function makeMockPlayerRepository(): IPlayerRepository {
	return {
		findPlayerBySteamIdHash: vi.fn().mockResolvedValue(null),
		findPlayerByDiscordIdHash: vi.fn().mockResolvedValue(null),
		findPlayerById: vi.fn().mockResolvedValue(null),
		findPlayerBySteamName: vi.fn().mockResolvedValue(null),
		createPlayer: vi.fn().mockResolvedValue(mockPlayerRecord),
		linkSteam: vi.fn().mockResolvedValue(undefined),
		linkDiscord: vi.fn().mockResolvedValue(undefined),
		unlinkDiscord: vi.fn().mockResolvedValue(undefined),
		updateUseDiscordName: vi.fn().mockResolvedValue(undefined),
		updateDiscordUsername: vi.fn().mockResolvedValue(undefined),
		updatePreferredJoker: vi.fn().mockResolvedValue(undefined),
		updateSteamName: vi.fn().mockResolvedValue(undefined),
		updateTosAcceptedVersion: vi.fn().mockResolvedValue(undefined),
		updateChatStatus: vi.fn().mockResolvedValue(undefined),
		softDeletePlayer: vi.fn().mockResolvedValue(undefined),
		reactivateIfDeleted: vi.fn().mockResolvedValue(undefined),
	}
}

function makeMockGracePeriodService(): Pick<
	IGracePeriodService,
	'cancelGracePeriod'
> {
	return {
		cancelGracePeriod: vi.fn().mockResolvedValue(true),
	}
}

function makeAuthService() {
	const playerRepository = makeMockPlayerRepository()
	const gracePeriodService = makeMockGracePeriodService()
	const service = createAuthService({ playerRepository, gracePeriodService })
	return { service, playerRepository, gracePeriodService }
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
			const { service } = makeAuthService()
			const { session, token } = await service.authenticateWithSteam(
				'steam1',
				'Alice',
			)

			expect(session.playerId).toBeDefined()
			expect(session.steamName).toBe('Alice')
			expect(session.steamIdHash).toBe(hashProviderId('steam1'))
			expect(sessions.has(session.playerId)).toBe(true)
			expect(findByProvider('steam', hashProviderId('steam1'))).toBe(session)

			const decoded = verifyJwt(token)
			expect(decoded?.playerId).toBe(session.playerId)
		})

		it('does not call createPlayer for new steam users', async () => {
			const { service, playerRepository } = makeAuthService()
			await service.authenticateWithSteam('steam1', 'Alice')
			expect(playerRepository.createPlayer).not.toHaveBeenCalled()
		})

		it('reuses existing in-memory session on re-auth', async () => {
			const { service } = makeAuthService()
			const first = await service.authenticateWithSteam('steam1', 'Alice')
			const second = await service.authenticateWithSteam('steam1', 'AliceV2')

			expect(first.session).toBe(second.session)
			expect(second.session.steamName).toBe('AliceV2')
		})

		it('updates steam name on re-auth', async () => {
			const { service, playerRepository } = makeAuthService()
			await service.authenticateWithSteam('steam1', 'Alice')
			vi.mocked(playerRepository.updateSteamName).mockClear()

			await service.authenticateWithSteam('steam1', 'AliceV2')

			expect(playerRepository.updateSteamName).toHaveBeenCalledOnce()
		})

		it('restores from DB when not in memory', async () => {
			const { service, playerRepository } = makeAuthService()
			const steamIdHash = hashProviderId('steam1')
			vi.mocked(playerRepository.findPlayerBySteamIdHash).mockResolvedValueOnce(
				{
					...mockPlayerRecord,
					steamIdHash,
					discordIdHash: 'some-discord-hash',
				},
			)

			const { session } = await service.authenticateWithSteam('steam1', 'Alice')

			expect(session.playerId).toBe('db-player-id')
			expect(session.steamIdHash).toBe(steamIdHash)
			expect(session.discordIdHash).toBe('some-discord-hash')
			expect(session.steamName).toBe('Alice')
		})
	})

	describe('authenticateWithDiscord', () => {
		it('creates a new session for unknown discord ID', async () => {
			const { service } = makeAuthService()
			const { session, token } = await service.authenticateWithDiscord(
				'disc1',
				'Bob',
			)

			expect(session.playerId).toBeDefined()
			expect(session.steamName).toBe('Bob')
			expect(session.discordIdHash).toBe(hashProviderId('disc1'))
			expect(findByProvider('discord', hashProviderId('disc1'))).toBe(session)

			const decoded = verifyJwt(token)
			expect(decoded?.playerId).toBe(session.playerId)
		})

		it('reuses existing in-memory session on re-auth', async () => {
			const { service } = makeAuthService()
			const first = await service.authenticateWithDiscord('disc1', 'Bob')
			const second = await service.authenticateWithDiscord('disc1', 'BobV2')

			expect(first.session).toBe(second.session)
			expect(second.session.steamName).toBe('BobV2')
		})

		it('restores from DB when not in memory', async () => {
			const { service, playerRepository } = makeAuthService()
			const discordIdHash = hashProviderId('disc1')
			vi.mocked(
				playerRepository.findPlayerByDiscordIdHash,
			).mockResolvedValueOnce({
				...mockPlayerRecord,
				steamIdHash: 'some-steam-hash',
				discordIdHash,
			})

			const { session } = await service.authenticateWithDiscord('disc1', 'Bob')

			expect(session.playerId).toBe('db-player-id')
			expect(session.discordIdHash).toBe(discordIdHash)
			expect(session.steamIdHash).toBe('some-steam-hash')
		})

		it('propagates DB errors from createPlayer', async () => {
			const { service, playerRepository } = makeAuthService()
			vi.mocked(playerRepository.createPlayer).mockRejectedValueOnce(
				new Error('DB connection failed'),
			)

			await expect(
				service.authenticateWithDiscord('disc1', 'Bob'),
			).rejects.toThrow('DB connection failed')
		})
	})

	describe('linkSteamToPlayer', () => {
		it('links steam to an existing session', async () => {
			const { service } = makeAuthService()
			const session = createSession('Alice', { discordIdHash: 'disc1' })

			const result = await service.linkSteamToPlayer(session.playerId, 'steam1')

			expect(result.session.steamIdHash).toBe(hashProviderId('steam1'))
			expect(findByProvider('steam', hashProviderId('steam1'))).toBe(session)
		})

		it('throws if session not found', async () => {
			const { service } = makeAuthService()
			await expect(
				service.linkSteamToPlayer('unknown', 'steam1'),
			).rejects.toThrow('Player not found')
		})

		it('throws if steam already linked to another player', async () => {
			const { service } = makeAuthService()
			createSession('Alice', { steamIdHash: hashProviderId('steam1') })
			const bob = createSession('Bob', { discordIdHash: 'disc1' })

			await expect(
				service.linkSteamToPlayer(bob.playerId, 'steam1'),
			).rejects.toThrow('Steam account already linked to another player')
		})

		it('allows re-linking same steam to same player', async () => {
			const { service } = makeAuthService()
			const session = createSession('Alice', {
				steamIdHash: hashProviderId('steam1'),
			})

			const result = await service.linkSteamToPlayer(session.playerId, 'steam1')
			expect(result.session.steamIdHash).toBe(hashProviderId('steam1'))
		})

		it('propagates DB errors from linkSteam', async () => {
			const { service, playerRepository } = makeAuthService()
			const session = createSession('Alice', { discordIdHash: 'disc1' })
			vi.mocked(playerRepository.linkSteam).mockRejectedValueOnce(
				new Error('DB write failed'),
			)

			await expect(
				service.linkSteamToPlayer(session.playerId, 'steam1'),
			).rejects.toThrow('DB write failed')
		})
	})

	describe('linkDiscordToPlayer', () => {
		it('links discord to an existing session', async () => {
			const { service } = makeAuthService()
			const session = createSession('Alice', { steamIdHash: 'steam1' })

			const result = await service.linkDiscordToPlayer(
				session.playerId,
				'disc1',
			)

			expect(result.session.discordIdHash).toBe(hashProviderId('disc1'))
			expect(findByProvider('discord', hashProviderId('disc1'))).toBe(session)
		})

		it('throws if session not found', async () => {
			const { service } = makeAuthService()
			await expect(
				service.linkDiscordToPlayer('unknown', 'disc1'),
			).rejects.toThrow('Player not found')
		})

		it('throws if discord already linked to another player', async () => {
			const { service } = makeAuthService()
			createSession('Alice', { discordIdHash: hashProviderId('disc1') })
			const bob = createSession('Bob', { steamIdHash: 'steam1' })

			await expect(
				service.linkDiscordToPlayer(bob.playerId, 'disc1'),
			).rejects.toThrow('Discord account already linked to another player')
		})

		it('propagates DB errors from linkDiscord', async () => {
			const { service, playerRepository } = makeAuthService()
			const session = createSession('Alice', { steamIdHash: 'steam1' })
			vi.mocked(playerRepository.linkDiscord).mockRejectedValueOnce(
				new Error('DB write failed'),
			)

			await expect(
				service.linkDiscordToPlayer(session.playerId, 'disc1'),
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
			expect(result).toEqual({ ok: true, value: { steamId: '76561198012345' } })
		})

		it('returns invalid_ticket error for rejected ticket', async () => {
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

			const result = await validateSteamTicket('bad-ticket')
			expect(result).toEqual({ ok: false, error: 'invalid_ticket' })
		})

		it('returns api_error for Steam API HTTP error', async () => {
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(
				new Response('', { status: 500 }),
			)

			const result = await validateSteamTicket('ticket')
			expect(result).toEqual({ ok: false, error: 'api_error' })
		})
	})

	describe('generateLinkState / verifyLinkState', () => {
		it('generates a valid link state and verifies it', () => {
			const playerId = 'player-123'
			const state = generateLinkState(playerId)

			expect(typeof state).toBe('string')
			expect(state.split('.')).toHaveLength(3)

			const result = verifyLinkState(state)
			expect(result?.playerId).toBe(playerId)
		})

		it('consumes nonce on first use (one-time use)', () => {
			const state = generateLinkState('player-123')

			expect(verifyLinkState(state)?.playerId).toBe('player-123')
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

			for (const [, entry] of linkStateNonces) {
				entry.expiresAt = Date.now() - 1000
			}

			expect(verifyLinkState(state)).toBeNull()
		})
	})
})
