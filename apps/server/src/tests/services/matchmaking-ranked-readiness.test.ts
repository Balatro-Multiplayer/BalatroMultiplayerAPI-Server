import { beforeEach, describe, expect, it, vi } from 'vitest'

// launcherIntegrityService is a real module-level singleton matchmaking.service.ts
// imports directly (not part of its injected deps) - mocked here, isolated to
// just this file (vitest gives each test file its own module registry), rather
// than touching the shared singleton the way matchmaking.service.test.ts's
// existing suite implicitly relies on staying disabled/untouched.
let capturedFailureHandler:
	| ((playerId: string, reason: 'launcher_outdated' | 'mods_outdated') => void)
	| null = null

vi.mock('../../features/launcher-integrity/launcher-integrity.service.js', () => ({
	launcherIntegrityService: {
		isEnabled: vi.fn().mockReturnValue(true),
		isLauncherVerified: vi.fn().mockReturnValue(true),
		issueRankedReadinessChallenge: vi.fn().mockResolvedValue(undefined),
		onRankedReadinessFailed: vi.fn((handler) => {
			capturedFailureHandler = handler
		}),
	},
}))

import { createSession } from '../../state/index.js'
import { playerQueues, queues } from '../../state/matchmaking.js'
import { mqttService } from '../../infrastructure/mqtt/mqtt.service.js'
import { createMatchmakingService } from '../../features/matchmaking/matchmaking.service.js'
import { launcherIntegrityService } from '../../features/launcher-integrity/launcher-integrity.service.js'
import type { IMatchRepository } from '../../contracts/IMatchRepository.js'
import type { IBanRepository } from '../../contracts/IBanRepository.js'

function makeSession(id: string, steamName: string) {
	return createSession(steamName, { id })
}

function makeMockMatchRepository(): IMatchRepository {
	return {
		insertMatch: vi.fn().mockResolvedValue(undefined),
		updateMatchLobbyState: vi.fn().mockResolvedValue(undefined),
		loadActiveMatches: vi.fn().mockResolvedValue([]),
		updateMatchStatus: vi.fn().mockResolvedValue(undefined),
		applyRatingTransaction: vi.fn().mockResolvedValue([]),
		getCurrentSeason: vi.fn().mockResolvedValue(null),
		getPlayerCurrentRating: vi.fn().mockResolvedValue(600),
		setMatchGameStarted: vi.fn().mockResolvedValue(undefined),
		recordMatchResult: vi.fn().mockResolvedValue(undefined),
		getResolvedMatchResult: vi.fn().mockResolvedValue(undefined),
	}
}

function makeMockBanRepository(): IBanRepository {
	return {
		hasActiveBan: vi.fn().mockResolvedValue(false),
	}
}

function makeService() {
	return createMatchmakingService({
		messageBus: mqttService,
		matchRepository: makeMockMatchRepository(),
		banRepository: makeMockBanRepository(),
	})
}

beforeEach(() => {
	capturedFailureHandler = null
	vi.mocked(launcherIntegrityService.isEnabled).mockReturnValue(true)
	vi.mocked(launcherIntegrityService.isLauncherVerified).mockReturnValue(true)
})

describe('matchmaking.service ranked_readiness wiring', () => {
	it('issues a ranked_readiness challenge on a successful Ranked queue join', async () => {
		const service = makeService()
		const session = makeSession('p1', 'Alice')

		await service.joinQueue(session, {
			modId: 'mod1',
			gameMode: 'ranked:1v1',
			minPlayers: 2,
			maxPlayers: 2,
		})

		expect(launcherIntegrityService.issueRankedReadinessChallenge).toHaveBeenCalledWith('p1')
	})

	it('does not issue a ranked_readiness challenge for a Casual queue join', async () => {
		const service = makeService()
		const session = makeSession('p1', 'Alice')

		await service.joinQueue(session, {
			modId: 'mod1',
			gameMode: 'mode1',
			minPlayers: 2,
			maxPlayers: 2,
		})

		expect(launcherIntegrityService.issueRankedReadinessChallenge).not.toHaveBeenCalled()
	})

	it('does not issue a ranked_readiness challenge when the subsystem is disabled', async () => {
		vi.mocked(launcherIntegrityService.isEnabled).mockReturnValue(false)
		// isLauncherVerified() is irrelevant once isEnabled() is false - the
		// existing synchronous gate skips it entirely (see joinQueue).
		const service = makeService()
		const session = makeSession('p1', 'Alice')

		await service.joinQueue(session, {
			modId: 'mod1',
			gameMode: 'ranked:1v1',
			minPlayers: 2,
			maxPlayers: 2,
		})

		expect(launcherIntegrityService.issueRankedReadinessChallenge).not.toHaveBeenCalled()
	})

	it('registers an onRankedReadinessFailed handler that dequeues and publishes queue_cancelled', async () => {
		const service = makeService()
		expect(capturedFailureHandler).not.toBeNull()

		const session = makeSession('p1', 'Alice')
		await service.joinQueue(session, {
			modId: 'mod1',
			gameMode: 'ranked:1v1',
			minPlayers: 2,
			maxPlayers: 2,
		})
		expect(queues.get('mod1:ranked:1v1')).toHaveLength(1)

		capturedFailureHandler!('p1', 'mods_outdated')

		expect(queues.has('mod1:ranked:1v1')).toBe(false)
		expect(playerQueues.has('p1')).toBe(false)
		expect(mqttService.publishToPlayer).toHaveBeenCalledWith(
			'p1',
			'matchmaking',
			expect.objectContaining({
				type: 'queue_cancelled',
				modId: 'mod1',
				gameMode: 'ranked:1v1',
				reason: 'mods_outdated',
			}),
		)
	})

	it('is a no-op when the player already left the queue on their own before the challenge resolved', async () => {
		makeService()
		expect(capturedFailureHandler).not.toBeNull()

		// Never joined any queue - findActiveRankedQueueEntry finds nothing.
		expect(() => capturedFailureHandler!('nobody', 'launcher_outdated')).not.toThrow()
		expect(mqttService.publishToPlayer).not.toHaveBeenCalledWith(
			'nobody',
			'matchmaking',
			expect.objectContaining({ type: 'queue_cancelled' }),
		)
	})
})
