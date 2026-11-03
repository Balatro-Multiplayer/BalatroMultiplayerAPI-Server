import { describe, expect, it, vi } from 'vitest'
import type { IReplayLogRepository } from '../../contracts/IReplayLogRepository.js'
import { createReplayLogService } from '../../features/replay-log/replay-log.service.js'
import {
	compressToBase64,
	decompressFromBase64,
} from '../../shared/utils/compression.js'

function makeMockRepository(): IReplayLogRepository {
	return {
		getRunWithLogs: vi.fn().mockResolvedValue(undefined),
		getRunsForPlayer: vi.fn().mockResolvedValue({ runs: [], total: 0 }),
		getRunIdsForMatchIds: vi.fn().mockResolvedValue(new Map()),
		setShared: vi.fn().mockResolvedValue(true),
		getDisplayNames: vi.fn().mockResolvedValue(new Map()),
	}
}

describe('replay-log.service', () => {
	describe('listMyRuns', () => {
		it('delegates to the repository with the requesting player id and a default limit', async () => {
			const repository = makeMockRepository()
			const runs = [
				{
					id: 'run-1',
					lobbyCode: 'ABCDEF',
					modId: 'mod1',
					lobbyType: 'public',
					status: 'completed' as const,
					startedAt: new Date(),
					finalizedAt: new Date(),
				},
			]
			repository.getRunsForPlayer = vi
				.fn()
				.mockResolvedValue({ runs, total: 1 })
			const service = createReplayLogService({ repository })

			const result = await service.listMyRuns('p1')

			expect(repository.getRunsForPlayer).toHaveBeenCalledWith('p1', 1, 20)
			expect(result).toEqual({ runs, total: 1, page: 1, pageSize: 20 })
		})

		it('returns an empty list when the player has no runs', async () => {
			const repository = makeMockRepository()
			const service = createReplayLogService({ repository })

			const result = await service.listMyRuns('p1')

			expect(result).toEqual({ runs: [], total: 0, page: 1, pageSize: 20 })
		})
	})

	describe('getReplay', () => {
		const run = {
			id: 'run-1',
			lobbyCode: 'ABCDE',
			modId: 'mod1',
			lobbyType: 'public',
			status: 'completed' as const,
			startedAt: new Date(),
			finalizedAt: new Date(),
		}
		const events = [
			[1, 'select_blind', [0, 'bl_small']],
			[2, 'buy', [1, 2, 3]],
			[3, 'end', { result: 'win', secret: 1 }],
		]
		const fullBlock = compressToBase64(JSON.stringify(events))
		const log = (playerId: string, sharedAt: Date | null) => ({
			playerId,
			compressedEvents: fullBlock,
			carbonHash: 'hash',
			eventCount: 3,
			status: 'complete' as const,
			flagReason: null,
			sharedAt,
		})
		const names = new Map([
			['p1', 'Alice'],
			['p2', 'Bob'],
		])
		const eventsOf = (block: string) => JSON.parse(decompressFromBase64(block))

		function setup(sharedAt: { p1: Date | null; p2: Date | null }) {
			const repository = makeMockRepository()
			vi.mocked(repository.getRunWithLogs).mockResolvedValue({
				run,
				logs: [log('p1', sharedAt.p1), log('p2', sharedAt.p2)],
			})
			vi.mocked(repository.getDisplayNames).mockResolvedValue(names)
			return {
				repository,
				service: createReplayLogService({ repository }),
			}
		}

		it('throws 404 when the run does not exist', async () => {
			const repository = makeMockRepository()
			const service = createReplayLogService({ repository })

			await expect(
				service.getReplay('missing-run', {
					playerId: 'p1',
					isModerator: false,
				}),
			).rejects.toThrow('Run not found')
		})

		it('gives a participant every side in full, with names and flags', async () => {
			const { service } = setup({ p1: new Date(), p2: null })

			const result = await service.getReplay('run-1', {
				playerId: 'p2',
				isModerator: false,
			})

			expect(result.viewer).toEqual({ role: 'participant', playerId: 'p2' })
			expect(
				result.logs.map((l) => [l.playerId, l.displayName, l.shared, l.hidden]),
			).toEqual([
				['p1', 'Alice', true, false],
				['p2', 'Bob', false, false],
			])
			expect(result.logs.every((l) => l.compressedEvents === fullBlock)).toBe(
				true,
			)
			expect(result.logs[0]).not.toHaveProperty('sharedAt')
		})

		it('gives a moderator every side in full', async () => {
			const { service } = setup({ p1: null, p2: null })

			const result = await service.getReplay('run-1', {
				playerId: 'mod',
				isModerator: true,
			})

			expect(result.viewer).toEqual({ role: 'moderator', playerId: 'mod' })
			expect(
				result.logs.every((l) => !l.hidden && l.compressedEvents === fullBlock),
			).toBe(true)
		})

		it('answers 404 to a public viewer when no side is shared', async () => {
			const { service } = setup({ p1: null, p2: null })

			await expect(
				service.getReplay('run-1', { playerId: null, isModerator: false }),
			).rejects.toThrow('Run not found')
			await expect(
				service.getReplay('run-1', {
					playerId: 'stranger',
					isModerator: false,
				}),
			).rejects.toThrow('Run not found')
		})

		it('shows a public viewer shared sides in full and the others reduced', async () => {
			const { service } = setup({ p1: new Date(), p2: null })

			const result = await service.getReplay('run-1', {
				playerId: null,
				isModerator: false,
			})

			expect(result.viewer).toEqual({ role: 'public' })
			const [shared, hidden] = result.logs
			expect(shared).toMatchObject({
				playerId: 'p1',
				shared: true,
				hidden: false,
			})
			expect(shared?.compressedEvents).toBe(fullBlock)
			expect(hidden).toMatchObject({
				playerId: 'p2',
				displayName: 'Bob',
				shared: false,
				hidden: true,
			})
			expect(eventsOf(hidden?.compressedEvents ?? '')).toEqual([
				[1, 'select_blind', [null, 'bl_small']],
				[3, 'end', { result: 'win' }],
			])
			expect(hidden?.eventCount).toBe(2)
		})

		it('hides anti-cheat flags and hashes from a public viewer', async () => {
			const { service, repository } = setup({ p1: new Date(), p2: null })
			vi.mocked(repository.getRunWithLogs).mockResolvedValue({
				run,
				logs: [
					{ ...log('p1', new Date()), flagReason: 'hash_mismatch' },
					log('p2', null),
				],
			})

			const result = await service.getReplay('run-1', {
				playerId: 'stranger',
				isModerator: false,
			})

			expect(result.viewer).toEqual({ role: 'public', playerId: 'stranger' })
			expect(
				result.logs.every(
					(l) => l.flagReason === null && l.carbonHash === null,
				),
			).toBe(true)
		})
	})

	describe('setShared', () => {
		it('sets the flag on the caller own row', async () => {
			const repository = makeMockRepository()
			const service = createReplayLogService({ repository })

			await service.setShared('run-1', 'p1', true)

			expect(repository.setShared).toHaveBeenCalledWith('run-1', 'p1', true)
		})

		it('throws 404 when the caller has no row in the run', async () => {
			const repository = makeMockRepository()
			vi.mocked(repository.setShared).mockResolvedValue(false)
			const service = createReplayLogService({ repository })

			await expect(service.setShared('run-1', 'p1', false)).rejects.toThrow(
				'Run not found',
			)
		})
	})
})
