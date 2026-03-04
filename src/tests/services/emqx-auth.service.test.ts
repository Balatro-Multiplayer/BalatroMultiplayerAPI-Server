import { describe, expect, it } from 'vitest'
import {
	authenticateClient,
	authorizeAction,
	chatTimestamps,
} from '../../services/emqx-auth.service.js'
import { signJwt } from '../../services/auth.service.js'
import { Lobby, createSession, lobbies } from '../../state/index.js'

function makeToken(playerId: string, username = 'Test') {
	return signJwt({ playerId, username })
}

function setupLobbyWithPlayer(
	code: string,
	hostId: string,
	...playerIds: string[]
) {
	const lobby = new Lobby(code, 'test_mod', hostId)
	lobbies.set(code, lobby)

	for (const id of [hostId, ...playerIds]) {
		const session = createSession(`User_${id}`, { id })
		lobby.addPlayer(session)
	}
	return lobby
}

describe('emqx-auth.service', () => {
	describe('authenticateClient', () => {
		it('allows the system client as superuser', async () => {
			const result = await authenticateClient({
				clientid: 'bmp-api-server',
				username: 'bmp-system',
				password: 'test-emqx-password',
				peerhost: '127.0.0.1',
			})
			expect(result).toEqual({ result: 'allow', is_superuser: true })
		})

		it('allows a player with valid JWT and matching session', async () => {
			createSession('Alice', { id: 'steam1' })
			const token = makeToken('steam1')

			const result = await authenticateClient({
				clientid: 'steam1',
				username: 'steam1',
				password: token,
				peerhost: '127.0.0.1',
			})
			expect(result).toEqual({ result: 'allow', is_superuser: false })
		})

		it('denies when JWT is invalid', async () => {
			const result = await authenticateClient({
				clientid: 'steam1',
				username: 'steam1',
				password: 'bad-token',
				peerhost: '127.0.0.1',
			})
			expect(result.result).toBe('deny')
		})

		it('denies when clientid does not match JWT playerId', async () => {
			createSession('Alice', { id: 'steam1' })
			const token = makeToken('steam1')

			const result = await authenticateClient({
				clientid: 'steam-DIFFERENT',
				username: 'steam1',
				password: token,
				peerhost: '127.0.0.1',
			})
			expect(result.result).toBe('deny')
		})

		it('denies when no active session exists', async () => {
			// Token is valid but no session was created
			const token = makeToken('steam1')

			const result = await authenticateClient({
				clientid: 'steam1',
				username: 'steam1',
				password: token,
				peerhost: '127.0.0.1',
			})
			expect(result.result).toBe('deny')
		})
	})

	describe('authorizeAction', () => {
		const base = { username: 'host1', peerhost: '127.0.0.1' }

		describe('invalid topics', () => {
			it('denies non-lobby topics', async () => {
				const result = await authorizeAction({
					...base,
					clientid: 'host1',
					topic: 'system/info',
					action: 'subscribe',
				})
				expect(result.result).toBe('deny')
			})

			it('denies topics with too few segments', async () => {
				const result = await authorizeAction({
					...base,
					clientid: 'host1',
					topic: 'lobby/ABCDE',
					action: 'subscribe',
				})
				expect(result.result).toBe('deny')
			})
		})

		describe('lobby membership', () => {
			it('denies if lobby does not exist', async () => {
				const result = await authorizeAction({
					...base,
					clientid: 'host1',
					topic: 'lobby/ZZZZZ/metadata',
					action: 'subscribe',
				})
				expect(result.result).toBe('deny')
			})

			it('denies if player is not in the lobby', async () => {
				setupLobbyWithPlayer('ABCDE', 'host1')
				createSession('Outsider', { id: 'outsider' })

				const result = await authorizeAction({
					...base,
					clientid: 'outsider',
					topic: 'lobby/ABCDE/metadata',
					action: 'subscribe',
				})
				expect(result.result).toBe('deny')
			})
		})

		describe('metadata topic', () => {
			it('allows any member to subscribe', async () => {
				setupLobbyWithPlayer('ABCDE', 'host1', 'guest1')

				const result = await authorizeAction({
					...base,
					clientid: 'guest1',
					topic: 'lobby/ABCDE/metadata',
					action: 'subscribe',
				})
				expect(result.result).toBe('allow')
			})

			it('allows host to publish', async () => {
				setupLobbyWithPlayer('ABCDE', 'host1')

				const result = await authorizeAction({
					...base,
					clientid: 'host1',
					topic: 'lobby/ABCDE/metadata',
					action: 'publish',
				})
				expect(result.result).toBe('allow')
			})

			it('denies non-host from publishing', async () => {
				setupLobbyWithPlayer('ABCDE', 'host1', 'guest1')

				const result = await authorizeAction({
					...base,
					clientid: 'guest1',
					topic: 'lobby/ABCDE/metadata',
					action: 'publish',
				})
				expect(result.result).toBe('deny')
			})
		})

		describe('events topic', () => {
			it('allows any member to subscribe', async () => {
				setupLobbyWithPlayer('ABCDE', 'host1', 'guest1')

				const result = await authorizeAction({
					...base,
					clientid: 'guest1',
					topic: 'lobby/ABCDE/events',
					action: 'subscribe',
				})
				expect(result.result).toBe('allow')
			})

			it('denies any client from publishing', async () => {
				setupLobbyWithPlayer('ABCDE', 'host1')

				const result = await authorizeAction({
					...base,
					clientid: 'host1',
					topic: 'lobby/ABCDE/events',
					action: 'publish',
				})
				expect(result.result).toBe('deny')
			})
		})

		describe('player state topic', () => {
			it('allows a player to subscribe to their own state', async () => {
				setupLobbyWithPlayer('ABCDE', 'host1', 'guest1')

				const result = await authorizeAction({
					...base,
					clientid: 'guest1',
					topic: 'lobby/ABCDE/players/guest1/state',
					action: 'subscribe',
				})
				expect(result.result).toBe('allow')
			})

			it('denies subscribing to another player state', async () => {
				setupLobbyWithPlayer('ABCDE', 'host1', 'guest1')

				const result = await authorizeAction({
					...base,
					clientid: 'guest1',
					topic: 'lobby/ABCDE/players/host1/state',
					action: 'subscribe',
				})
				expect(result.result).toBe('deny')
			})

			it('denies wildcard subscribe to all player states', async () => {
				setupLobbyWithPlayer('ABCDE', 'host1', 'guest1')

				const result = await authorizeAction({
					...base,
					clientid: 'guest1',
					topic: 'lobby/ABCDE/players/+/state',
					action: 'subscribe',
				})
				expect(result.result).toBe('deny')
			})

			it('allows a player to publish their own state', async () => {
				setupLobbyWithPlayer('ABCDE', 'host1')

				const result = await authorizeAction({
					...base,
					clientid: 'host1',
					topic: 'lobby/ABCDE/players/host1/state',
					action: 'publish',
				})
				expect(result.result).toBe('allow')
			})

			it('denies publishing to another player state', async () => {
				setupLobbyWithPlayer('ABCDE', 'host1', 'guest1')

				const result = await authorizeAction({
					...base,
					clientid: 'guest1',
					topic: 'lobby/ABCDE/players/host1/state',
					action: 'publish',
				})
				expect(result.result).toBe('deny')
			})

			it('denies malformed player state topic', async () => {
				setupLobbyWithPlayer('ABCDE', 'host1')

				const result = await authorizeAction({
					...base,
					clientid: 'host1',
					topic: 'lobby/ABCDE/players/host1/badkey',
					action: 'subscribe',
				})
				expect(result.result).toBe('deny')
			})
		})

		describe('actions topic', () => {
			it('allows a player to subscribe to their own actions', async () => {
				setupLobbyWithPlayer('ABCDE', 'host1')

				const result = await authorizeAction({
					...base,
					clientid: 'host1',
					topic: 'lobby/ABCDE/actions/host1',
					action: 'subscribe',
				})
				expect(result.result).toBe('allow')
			})

			it('denies subscribing to another player actions', async () => {
				setupLobbyWithPlayer('ABCDE', 'host1', 'guest1')

				const result = await authorizeAction({
					...base,
					clientid: 'guest1',
					topic: 'lobby/ABCDE/actions/host1',
					action: 'subscribe',
				})
				expect(result.result).toBe('deny')
			})

			it('allows any member to publish actions to any target', async () => {
				setupLobbyWithPlayer('ABCDE', 'host1', 'guest1')

				const result = await authorizeAction({
					...base,
					clientid: 'guest1',
					topic: 'lobby/ABCDE/actions/host1',
					action: 'publish',
				})
				expect(result.result).toBe('allow')
			})
		})

		describe('chat topic', () => {
			it('allows any member to subscribe to any chat', async () => {
				setupLobbyWithPlayer('ABCDE', 'host1', 'guest1')

				const result = await authorizeAction({
					...base,
					clientid: 'guest1',
					topic: 'lobby/ABCDE/chat/host1',
					action: 'subscribe',
				})
				expect(result.result).toBe('allow')
			})

			it('allows a player to publish to their own chat', async () => {
				setupLobbyWithPlayer('ABCDE', 'host1')

				const result = await authorizeAction({
					...base,
					clientid: 'host1',
					topic: 'lobby/ABCDE/chat/host1',
					action: 'publish',
				})
				expect(result.result).toBe('allow')
			})

			it('denies publishing to another player chat', async () => {
				setupLobbyWithPlayer('ABCDE', 'host1', 'guest1')

				const result = await authorizeAction({
					...base,
					clientid: 'guest1',
					topic: 'lobby/ABCDE/chat/host1',
					action: 'publish',
				})
				expect(result.result).toBe('deny')
			})

			it('rate limits chat after 5 messages in 5 seconds', async () => {
				setupLobbyWithPlayer('ABCDE', 'host1')

				const req = {
					...base,
					clientid: 'host1',
					topic: 'lobby/ABCDE/chat/host1',
					action: 'publish' as const,
				}

				// First 5 should be allowed
				for (let i = 0; i < 5; i++) {
					const result = await authorizeAction(req)
					expect(result.result).toBe('allow')
				}

				// 6th should be denied
				const result = await authorizeAction(req)
				expect(result.result).toBe('deny')
			})

			it('allows chat again after rate limit window passes', async () => {
				setupLobbyWithPlayer('ABCDE', 'host1')

				const req = {
					...base,
					clientid: 'host1',
					topic: 'lobby/ABCDE/chat/host1',
					action: 'publish' as const,
				}

				// Fill up the rate limit
				for (let i = 0; i < 5; i++) {
					await authorizeAction(req)
				}

				// Manually expire the timestamps
				const timestamps = chatTimestamps.get('host1')!
				const past = Date.now() - 6000
				for (let i = 0; i < timestamps.length; i++) {
					timestamps[i] = past
				}

				// Should be allowed again
				const result = await authorizeAction(req)
				expect(result.result).toBe('allow')
			})
		})

		describe('unknown topic type', () => {
			it('denies unknown topic types', async () => {
				setupLobbyWithPlayer('ABCDE', 'host1')

				const result = await authorizeAction({
					...base,
					clientid: 'host1',
					topic: 'lobby/ABCDE/something_else',
					action: 'subscribe',
				})
				expect(result.result).toBe('deny')
			})
		})
	})
})
