import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// kickClient does a real fetch to EMQX's management API -- mocked so tests
// stay unit-level (asserting it was/wasn't called) instead of hitting a
// broker that doesn't exist in this environment.
vi.mock('../../infrastructure/emqx/emqx-admin.service.js', () => ({
	kickClient: vi.fn().mockResolvedValue(true),
}))

import type { ILauncherIntegrityRepository } from '../../contracts/ILauncherIntegrityRepository.js'
import type { IMessageBus } from '../../contracts/IMessageBus.js'
import { CHALLENGE_TIMEOUT_MS } from '../../features/launcher-integrity/launcher-integrity.config.js'
import { createLauncherIntegrityService } from '../../features/launcher-integrity/launcher-integrity.service.js'
import { kickClient } from '../../infrastructure/emqx/emqx-admin.service.js'
import type {
	ChallengeIssuance,
	ChallengeStrategy,
} from '../../shared/types/index.js'
import { integritySessions } from '../../state/launcher-integrity.js'

function makeMockMessageBus(): IMessageBus {
	return {
		publishEvent: vi.fn().mockResolvedValue(undefined),
		publishMetadata: vi.fn().mockResolvedValue(undefined),
		publishPlayerInfo: vi.fn().mockResolvedValue(undefined),
		publishToPlayer: vi.fn().mockResolvedValue(undefined),
		clearPlayerInfo: vi.fn().mockResolvedValue(undefined),
		cleanupLobbyTopics: vi.fn().mockResolvedValue(undefined),
		cleanupPlayerState: vi.fn().mockResolvedValue(undefined),
		publishChatMessage: vi.fn().mockResolvedValue(undefined),
		publishModUpdate: vi.fn().mockResolvedValue(undefined),
	}
}

function makeMockRepository(): ILauncherIntegrityRepository {
	return { insertEvent: vi.fn().mockResolvedValue(undefined) }
}

// A strategy whose verify() outcome is controlled per-test via `answerIsCorrect`.
function makeFakeStrategy(): ChallengeStrategy & { answerIsCorrect: boolean } {
	const strategy = {
		answerIsCorrect: true,
		async issue(): Promise<ChallengeIssuance> {
			return {
				nonce: 'test-nonce',
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
			}
		},
		async verify(): Promise<boolean> {
			return strategy.answerIsCorrect
		},
	}
	return strategy
}

async function getIssuedChallengeId(messageBus: IMessageBus): Promise<string> {
	const call = (
		messageBus.publishToPlayer as ReturnType<typeof vi.fn>
	).mock.calls.find(
		([, subtopic, payload]) =>
			subtopic === 'challenge' && payload.type === 'issued',
	)
	return call![2].challengeId as string
}

afterEach(() => {
	integritySessions.clear()
	vi.useRealTimers()
})

describe('launcher-integrity.service', () => {
	describe('when no ChallengeStrategy is registered', () => {
		it('is disabled and never issues a challenge', async () => {
			const messageBus = makeMockMessageBus()
			const service = createLauncherIntegrityService({
				messageBus,
				repository: makeMockRepository(),
			})

			expect(service.isEnabled()).toBe(false)

			await service.handleClientConnected('player1')

			expect(messageBus.publishToPlayer).not.toHaveBeenCalled()
			expect(service.isLauncherVerified('player1')).toBe(false)
		})
	})

	describe('login challenge', () => {
		it('issues a login challenge once a ChallengeStrategy is set', async () => {
			const messageBus = makeMockMessageBus()
			const service = createLauncherIntegrityService({
				messageBus,
				repository: makeMockRepository(),
			})
			service.setChallengeStrategy(makeFakeStrategy())

			await service.handleClientConnected('player1')

			expect(messageBus.publishToPlayer).toHaveBeenCalledWith(
				'player1',
				'challenge',
				expect.objectContaining({ type: 'issued', kind: 'login' }),
			)
		})

		it('marks the session verified on a correct response and does not disconnect', async () => {
			const messageBus = makeMockMessageBus()
			const repository = makeMockRepository()
			const service = createLauncherIntegrityService({ messageBus, repository })
			service.setChallengeStrategy(makeFakeStrategy())

			await service.handleClientConnected('player1')
			const challengeId = await getIssuedChallengeId(messageBus)
			await service.handleChallengeResponse('player1', {
				challengeId,
				response: 'anything',
			})

			expect(service.isLauncherVerified('player1')).toBe(true)
			expect(kickClient).not.toHaveBeenCalled()
		})

		it('leaves the session unverified (not disconnected) on a wrong response before ever passing', async () => {
			const messageBus = makeMockMessageBus()
			const repository = makeMockRepository()
			const service = createLauncherIntegrityService({ messageBus, repository })
			const strategy = makeFakeStrategy()
			strategy.answerIsCorrect = false
			service.setChallengeStrategy(strategy)

			await service.handleClientConnected('player1')
			const challengeId = await getIssuedChallengeId(messageBus)
			await service.handleChallengeResponse('player1', {
				challengeId,
				response: 'wrong',
			})

			expect(service.isLauncherVerified('player1')).toBe(false)
			expect(kickClient).not.toHaveBeenCalled()
			expect(repository.insertEvent).toHaveBeenCalledWith(
				'player1',
				'login',
				'wrong_response',
			)
		})

		it('records an explicit refusal without disconnecting, and does not re-ask this session', async () => {
			const messageBus = makeMockMessageBus()
			const repository = makeMockRepository()
			const service = createLauncherIntegrityService({ messageBus, repository })
			service.setChallengeStrategy(makeFakeStrategy())

			await service.handleClientConnected('player1')
			const challengeId = await getIssuedChallengeId(messageBus)
			await service.handleChallengeResponse('player1', {
				challengeId,
				refused: true,
			})

			expect(service.isLauncherVerified('player1')).toBe(false)
			expect(kickClient).not.toHaveBeenCalled()
			expect(repository.insertEvent).toHaveBeenCalledWith(
				'player1',
				'login',
				'refused',
			)
		})

		it('treats an unanswered login challenge as an implicit refusal on timeout, without disconnecting', async () => {
			vi.useFakeTimers()
			const messageBus = makeMockMessageBus()
			const repository = makeMockRepository()
			const service = createLauncherIntegrityService({ messageBus, repository })
			service.setChallengeStrategy(makeFakeStrategy())

			await service.handleClientConnected('player1')
			await vi.advanceTimersByTimeAsync(CHALLENGE_TIMEOUT_MS + 100)

			expect(service.isLauncherVerified('player1')).toBe(false)
			expect(kickClient).not.toHaveBeenCalled()
			expect(repository.insertEvent).toHaveBeenCalledWith(
				'player1',
				'login',
				'timeout',
			)
		})
	})

	describe('periodic challenge failure after an earlier pass', () => {
		it('force-disconnects the player and does not just leave them unverified', async () => {
			const messageBus = makeMockMessageBus()
			const repository = makeMockRepository()
			const service = createLauncherIntegrityService({ messageBus, repository })
			const strategy = makeFakeStrategy()
			service.setChallengeStrategy(strategy)

			// Pass the login challenge first.
			await service.handleClientConnected('player1')
			const loginChallengeId = await getIssuedChallengeId(messageBus)
			await service.handleChallengeResponse('player1', {
				challengeId: loginChallengeId,
				response: 'ok',
			})
			expect(service.isLauncherVerified('player1')).toBe(true)

			// The randomized real-timer scheduling of *when* a periodic challenge
			// gets issued is not what's under test here -- seed one directly onto
			// the session, matching the shape issueChallenge itself would have set
			// up, and answer it wrong.
			const session = integritySessions.get('player1')!
			session.activeChallenge = {
				challengeId: 'periodic-1',
				kind: 'periodic',
				issuance: {
					nonce: 'n',
					expiresAt: new Date(Date.now() + 60_000).toISOString(),
				},
				timeoutTimer: setTimeout(() => {}, 60_000),
			}

			strategy.answerIsCorrect = false
			await service.handleChallengeResponse('player1', {
				challengeId: 'periodic-1',
				response: 'wrong',
			})

			expect(service.isLauncherVerified('player1')).toBe(false)
			expect(kickClient).toHaveBeenCalledWith('player1')
			expect(repository.insertEvent).toHaveBeenCalledWith(
				'player1',
				'periodic',
				'wrong_response',
			)
		})
	})

	describe('clearSession / clearAll', () => {
		it('clearSession removes all state for a player', async () => {
			const messageBus = makeMockMessageBus()
			const service = createLauncherIntegrityService({
				messageBus,
				repository: makeMockRepository(),
			})
			service.setChallengeStrategy(makeFakeStrategy())

			await service.handleClientConnected('player1')
			service.clearSession('player1')

			expect(integritySessions.has('player1')).toBe(false)
		})
	})
})
