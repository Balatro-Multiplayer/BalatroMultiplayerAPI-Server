import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticateClient } from '../../features/emqx/emqx-auth.service.js'
import { joinQueue } from '../../features/matchmaking/matchmaking.service.js'
import { signJwt } from '../../features/auth/auth.service.js'
import { createSession } from '../../state/index.js'
import { hasActiveBan } from '../../infrastructure/gateways/ban.gateway.js'

const mockHasActiveBan = vi.mocked(hasActiveBan)

function token(playerId: string) {
	return signJwt({ playerId, steamName: 'Test' })
}

describe('ban enforcement', () => {
	beforeEach(() => {
		mockHasActiveBan.mockResolvedValue(false)
	})

	describe('account ban — MQTT CONNECT', () => {
		it('denies CONNECT when the player has an active account ban', async () => {
			createSession('Banned', { id: 'p1', tosAcceptedVersion: 1 })
			mockHasActiveBan.mockImplementation(
				async (_pid, type) => type === 'account',
			)

			const result = await authenticateClient({
				clientid: 'p1',
				username: 'p1',
				password: token('p1'),
				peerhost: '127.0.0.1',
			})

			expect(result.result).toBe('deny')
		})

		it('allows CONNECT when the player has no account ban', async () => {
			createSession('Clean', { id: 'p2', tosAcceptedVersion: 1 })

			const result = await authenticateClient({
				clientid: 'p2',
				username: 'p2',
				password: token('p2'),
				peerhost: '127.0.0.1',
			})

			expect(result.result).toBe('allow')
		})
	})

	describe('queue ban — joinQueue', () => {
		it('rejects queueing when the player has an active queue ban', async () => {
			const session = createSession('QueueBanned', { id: 'p3' })
			mockHasActiveBan.mockImplementation(
				async (_pid, type) => type === 'queue',
			)

			await expect(
				joinQueue(session, {
					modId: 'MultiplayerSpeedrunning',
					gameMode: 'ranked:spdrn_gold_stake_single',
					minPlayers: 2,
					maxPlayers: 2,
				}),
			).rejects.toThrow(/banned from matchmaking/i)
		})
	})
})
