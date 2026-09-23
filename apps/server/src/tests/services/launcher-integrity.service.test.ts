import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// kickClient does a real fetch to EMQX's management API -- mocked so tests
// stay unit-level (asserting it was/wasn't called) instead of hitting a
// broker that doesn't exist in this environment.
vi.mock('../../infrastructure/emqx/emqx-admin.service.js', () => ({
	kickClient: vi.fn().mockResolvedValue(true),
}))

import type { ILauncherIntegrityRepository } from '../../contracts/ILauncherIntegrityRepository.js'
import type { IMessageBus } from '../../contracts/IMessageBus.js'
import { LOGIN_CHALLENGE_TIMEOUT_MS } from '../../features/launcher-integrity/launcher-integrity.config.js'
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
	}
}

function makeMockRepository(): ILauncherIntegrityRepository {
	return {
		insertEvent: vi.fn().mockResolvedValue(undefined),
	}
}

// A strategy whose verify() outcome is controlled per-test via `answerIsCorrect`.
// Used by every test that only cares about the pass/fail/timeout state
// machine, not the actual shape of `response` -- see makeHmacStrategy below
// for the tests that do care.
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

function hmacHex(secret: string, data: string): string {
	return createHmac('sha256', secret).update(data).digest('hex')
}

// A strategy that does real HMAC verification of a bare nonce:playerId
// signature, standing in for the private bet-launcher-integrity-private
// package's real ChallengeStrategy -- this is the seam that validates the
// public-repo side of the contract without that repo existing here. Any
// non-string response is rejected.
function makeHmacStrategy(secret: string): ChallengeStrategy {
	return {
		async issue(): Promise<ChallengeIssuance> {
			return {
				nonce: 'fixed-test-nonce',
				expiresAt: new Date(Date.now() + 60_000).toISOString(),
			}
		},
		async verify(playerId, issuance, response): Promise<boolean> {
			return (
				typeof response === 'string' &&
				response === hmacHex(secret, `${issuance.nonce}:${playerId}`)
			)
		},
	}
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

		it('publishes a verified acknowledgement on a correct response', async () => {
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

			expect(messageBus.publishToPlayer).toHaveBeenCalledWith(
				'player1',
				'challenge',
				expect.objectContaining({ type: 'verified', challengeId, kind: 'login' }),
			)
		})

		it('does not publish a verified acknowledgement on a wrong response', async () => {
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

			expect(messageBus.publishToPlayer).not.toHaveBeenCalledWith(
				'player1',
				'challenge',
				expect.objectContaining({ type: 'verified' }),
			)
		})

		it('unverifies the player on a wrong response without disconnecting, even before ever passing', async () => {
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

		it('unverifies on an explicit login refusal, with a forewarning message, without disconnecting', async () => {
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
			expect(messageBus.publishToPlayer).toHaveBeenCalledWith(
				'player1',
				'challenge',
				expect.objectContaining({ type: 'failed', reason: 'refused' }),
			)
		})

		it('unverifies on an unanswered (timed-out) login challenge without disconnecting', async () => {
			vi.useFakeTimers()
			const messageBus = makeMockMessageBus()
			const repository = makeMockRepository()
			const service = createLauncherIntegrityService({ messageBus, repository })
			service.setChallengeStrategy(makeFakeStrategy())

			await service.handleClientConnected('player1')
			await vi.advanceTimersByTimeAsync(LOGIN_CHALLENGE_TIMEOUT_MS + 100)

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
		it('revokes verification on a failed periodic challenge without disconnecting', async () => {
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
			expect(kickClient).not.toHaveBeenCalled()
			expect(repository.insertEvent).toHaveBeenCalledWith(
				'player1',
				'periodic',
				'wrong_response',
			)
			expect(messageBus.publishToPlayer).toHaveBeenCalledWith(
				'player1',
				'challenge',
				expect.objectContaining({ type: 'failed', reason: 'wrong_response' }),
			)
		})
	})

	describe('real HMAC login signature', () => {
		const secret = 'test-login-secret'

		it('verifies a bare nonce:playerId signature', async () => {
			const messageBus = makeMockMessageBus()
			const repository = makeMockRepository()
			const service = createLauncherIntegrityService({ messageBus, repository })
			service.setChallengeStrategy(makeHmacStrategy(secret))

			await service.handleClientConnected('player1')
			const challengeId = await getIssuedChallengeId(messageBus)
			await service.handleChallengeResponse('player1', {
				challengeId,
				response: hmacHex(secret, 'fixed-test-nonce:player1'),
			})

			expect(service.isLauncherVerified('player1')).toBe(true)
		})

		it('rejects a signature-object response', async () => {
			const messageBus = makeMockMessageBus()
			const repository = makeMockRepository()
			const service = createLauncherIntegrityService({ messageBus, repository })
			service.setChallengeStrategy(makeHmacStrategy(secret))

			await service.handleClientConnected('player1')
			const challengeId = await getIssuedChallengeId(messageBus)
			await service.handleChallengeResponse('player1', {
				challengeId,
				response: { signature: hmacHex(secret, 'fixed-test-nonce:player1') },
			})

			expect(service.isLauncherVerified('player1')).toBe(false)
		})
	})

	describe('ranked_readiness challenge', () => {
		it('issues a ranked_readiness challenge on demand', async () => {
			const messageBus = makeMockMessageBus()
			const service = createLauncherIntegrityService({
				messageBus,
				repository: makeMockRepository(),
			})
			service.setChallengeStrategy(makeFakeStrategy())

			await service.issueRankedReadinessChallenge('player1')

			expect(messageBus.publishToPlayer).toHaveBeenCalledWith(
				'player1',
				'challenge',
				expect.objectContaining({ type: 'issued', kind: 'ranked_readiness' }),
			)
		})

		it('does not touch isLauncherVerified or publish anything when both are current', async () => {
			const messageBus = makeMockMessageBus()
			const service = createLauncherIntegrityService({
				messageBus,
				repository: makeMockRepository(),
			})
			service.setChallengeStrategy(makeFakeStrategy())
			const onFailed = vi.fn()
			service.onRankedReadinessFailed(onFailed)

			await service.issueRankedReadinessChallenge('player1')
			const challengeId = await getIssuedChallengeId(messageBus)
			await service.handleChallengeResponse('player1', {
				challengeId,
				response: { signature: 'sig', launcherCurrent: true, modsCurrent: true },
			})

			expect(onFailed).not.toHaveBeenCalled()
			expect(service.isLauncherVerified('player1')).toBe(false)
			expect(messageBus.publishToPlayer).not.toHaveBeenCalledWith(
				'player1',
				'challenge',
				expect.objectContaining({ type: 'verified' }),
			)
		})

		it('reports launcher_outdated when the verdict says the launcher itself is stale', async () => {
			const messageBus = makeMockMessageBus()
			const service = createLauncherIntegrityService({
				messageBus,
				repository: makeMockRepository(),
			})
			service.setChallengeStrategy(makeFakeStrategy())
			const onFailed = vi.fn()
			service.onRankedReadinessFailed(onFailed)

			await service.issueRankedReadinessChallenge('player1')
			const challengeId = await getIssuedChallengeId(messageBus)
			await service.handleChallengeResponse('player1', {
				challengeId,
				response: { signature: 'sig', launcherCurrent: false, modsCurrent: true },
			})

			expect(onFailed).toHaveBeenCalledWith('player1', 'launcher_outdated')
		})

		it('reports mods_outdated when only the mods are stale', async () => {
			const messageBus = makeMockMessageBus()
			const service = createLauncherIntegrityService({
				messageBus,
				repository: makeMockRepository(),
			})
			service.setChallengeStrategy(makeFakeStrategy())
			const onFailed = vi.fn()
			service.onRankedReadinessFailed(onFailed)

			await service.issueRankedReadinessChallenge('player1')
			const challengeId = await getIssuedChallengeId(messageBus)
			await service.handleChallengeResponse('player1', {
				challengeId,
				response: { signature: 'sig', launcherCurrent: true, modsCurrent: false },
			})

			expect(onFailed).toHaveBeenCalledWith('player1', 'mods_outdated')
		})

		it('reports launcher_outdated on an explicit refusal', async () => {
			const messageBus = makeMockMessageBus()
			const service = createLauncherIntegrityService({
				messageBus,
				repository: makeMockRepository(),
			})
			service.setChallengeStrategy(makeFakeStrategy())
			const onFailed = vi.fn()
			service.onRankedReadinessFailed(onFailed)

			await service.issueRankedReadinessChallenge('player1')
			const challengeId = await getIssuedChallengeId(messageBus)
			await service.handleChallengeResponse('player1', {
				challengeId,
				refused: true,
			})

			expect(onFailed).toHaveBeenCalledWith('player1', 'launcher_outdated')
		})

		it('reports launcher_outdated when the base signature fails to verify', async () => {
			const messageBus = makeMockMessageBus()
			const service = createLauncherIntegrityService({
				messageBus,
				repository: makeMockRepository(),
			})
			const strategy = makeFakeStrategy()
			strategy.answerIsCorrect = false
			service.setChallengeStrategy(strategy)
			const onFailed = vi.fn()
			service.onRankedReadinessFailed(onFailed)

			await service.issueRankedReadinessChallenge('player1')
			const challengeId = await getIssuedChallengeId(messageBus)
			await service.handleChallengeResponse('player1', {
				challengeId,
				response: { signature: 'wrong', launcherCurrent: true, modsCurrent: true },
			})

			expect(onFailed).toHaveBeenCalledWith('player1', 'launcher_outdated')
		})

		it('reports launcher_outdated on timeout, without disconnecting or touching launcherVerified', async () => {
			vi.useFakeTimers()
			const messageBus = makeMockMessageBus()
			const repository = makeMockRepository()
			const service = createLauncherIntegrityService({ messageBus, repository })
			service.setChallengeStrategy(makeFakeStrategy())
			const onFailed = vi.fn()
			service.onRankedReadinessFailed(onFailed)

			await service.issueRankedReadinessChallenge('player1')
			await vi.advanceTimersByTimeAsync(60_000)

			expect(onFailed).toHaveBeenCalledWith('player1', 'launcher_outdated')
			expect(kickClient).not.toHaveBeenCalled()
			expect(service.isLauncherVerified('player1')).toBe(false)
		})

		it('does not affect a separately-verified login session', async () => {
			const messageBus = makeMockMessageBus()
			const service = createLauncherIntegrityService({
				messageBus,
				repository: makeMockRepository(),
			})
			service.setChallengeStrategy(makeFakeStrategy())
			const onFailed = vi.fn()
			service.onRankedReadinessFailed(onFailed)

			// Pass login first.
			await service.handleClientConnected('player1')
			const loginChallengeId = await getIssuedChallengeId(messageBus)
			await service.handleChallengeResponse('player1', {
				challengeId: loginChallengeId,
				response: 'ok',
			})
			expect(service.isLauncherVerified('player1')).toBe(true)

			// A ranked_readiness challenge reporting stale mods must not flip
			// the unrelated login-verified flag - see
			// handleRankedReadinessResponse's own comment on why.
			// getIssuedChallengeId finds the *first* 'issued' publish, which
			// by now is the login one from above - find the readiness one
			// specifically instead.
			await service.issueRankedReadinessChallenge('player1')
			const readinessCall = (
				messageBus.publishToPlayer as ReturnType<typeof vi.fn>
			).mock.calls.find(
				([, subtopic, payload]) =>
					subtopic === 'challenge' &&
					payload.type === 'issued' &&
					payload.kind === 'ranked_readiness',
			)
			const readinessChallengeId = readinessCall![2].challengeId as string
			await service.handleChallengeResponse('player1', {
				challengeId: readinessChallengeId,
				response: { signature: 'sig', launcherCurrent: true, modsCurrent: false },
			})

			expect(onFailed).toHaveBeenCalledWith('player1', 'mods_outdated')
			expect(service.isLauncherVerified('player1')).toBe(true)
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
