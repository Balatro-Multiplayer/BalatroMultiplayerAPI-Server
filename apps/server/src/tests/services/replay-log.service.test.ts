import { describe, expect, it, vi } from 'vitest'
import type { IReplayLogRepository } from '../../contracts/IReplayLogRepository.js'
import { createReplayLogService } from '../../features/replay-log/replay-log.service.js'
import { lobbies } from '../../state/index.js'
import { Lobby } from '../../state/lobby.js'

function makeMockRepository(): IReplayLogRepository {
	return {
		insertRun: vi.fn().mockResolvedValue('run-1'),
		upsertPlayerLog: vi.fn().mockResolvedValue(undefined),
		updateRunStatus: vi.fn().mockResolvedValue(undefined),
		purgeExpiredRunLogs: vi.fn().mockResolvedValue(0),
	}
}

function putLobby(code: string, type: 'public' | 'private' = 'private') {
	const lobby = new Lobby(code, 'mod1', 'host1', 16, type)
	lobbies.set(code, lobby)
	return lobby
}

describe('replay-log.service', () => {
	describe('handleActionLogEvent', () => {
		it('ignores events for a lobby that no longer exists', async () => {
			const repository = makeMockRepository()
			const service = createReplayLogService({ repository })

			await service.handleActionLogEvent('GHOST', 'p1', {
				t: 0,
				opcode: 'manifest',
				args: {},
			})

			expect(repository.insertRun).not.toHaveBeenCalled()
			expect(service.hasBufferedRun('GHOST')).toBe(false)
		})

		it('creates a run on the first event, keyed off the live lobby', async () => {
			const repository = makeMockRepository()
			const service = createReplayLogService({ repository })
			putLobby('ABCDE', 'public')

			await service.handleActionLogEvent('ABCDE', 'p1', {
				t: 0,
				opcode: 'manifest',
				args: { seed: 'S' },
			})

			expect(repository.insertRun).toHaveBeenCalledWith({
				lobbyCode: 'ABCDE',
				modId: 'mod1',
				lobbyType: 'public',
				matchmakingMatchId: null,
			})
			expect(service.hasBufferedRun('ABCDE')).toBe(true)
			lobbies.delete('ABCDE')
		})

		it('only inserts the run once across multiple events/players in the same lobby', async () => {
			const repository = makeMockRepository()
			const service = createReplayLogService({ repository })
			putLobby('FGHIJ')

			await service.handleActionLogEvent('FGHIJ', 'p1', {
				t: 0,
				opcode: 'manifest',
				args: {},
			})
			await service.handleActionLogEvent('FGHIJ', 'p1', {
				t: 10,
				opcode: 'buy',
				args: [1, 2],
			})
			await service.handleActionLogEvent('FGHIJ', 'p2', {
				t: 12,
				opcode: 'select_blind',
				args: 0,
			})

			expect(repository.insertRun).toHaveBeenCalledTimes(1)
			lobbies.delete('FGHIJ')
		})

		it('ignores malformed events missing t or opcode', async () => {
			const repository = makeMockRepository()
			const service = createReplayLogService({ repository })
			putLobby('KLMNO')

			await service.handleActionLogEvent('KLMNO', 'p1', { opcode: 'buy' })
			await service.handleActionLogEvent('KLMNO', 'p1', { t: 5 })

			expect(repository.insertRun).not.toHaveBeenCalled()
			lobbies.delete('KLMNO')
		})

		it('captures the client-computed CHK carbon hash for the finalize step', async () => {
			const repository = makeMockRepository()
			const service = createReplayLogService({ repository })
			putLobby('PQRST')

			await service.handleActionLogEvent('PQRST', 'p1', {
				t: 0,
				opcode: 'manifest',
				args: {},
			})
			await service.handleActionLogEvent('PQRST', 'p1', {
				t: 100,
				opcode: 'chk',
				args: { carbon: 'deadbeef', human: 'cafef00d' },
			})
			await service.finalizeRun('PQRST', 'completed')

			expect(repository.upsertPlayerLog).toHaveBeenCalledWith(
				expect.objectContaining({
					playerId: 'p1',
					carbonHash: 'deadbeef',
					eventCount: 2,
				}),
			)
			lobbies.delete('PQRST')
		})
	})

	describe('finalizeRun', () => {
		it('is a no-op when nothing was buffered for the lobby', async () => {
			const repository = makeMockRepository()
			const service = createReplayLogService({ repository })

			await service.finalizeRun('NEVERSTARTED', 'abandoned')

			expect(repository.upsertPlayerLog).not.toHaveBeenCalled()
			expect(repository.updateRunStatus).not.toHaveBeenCalled()
		})

		it('flushes one upsert per buffered player and marks the run status', async () => {
			const repository = makeMockRepository()
			const service = createReplayLogService({ repository })
			putLobby('UVWXY')

			await service.handleActionLogEvent('UVWXY', 'p1', {
				t: 0,
				opcode: 'select_blind',
				args: 0,
			})
			await service.handleActionLogEvent('UVWXY', 'p2', {
				t: 0,
				opcode: 'select_blind',
				args: 0,
			})
			await service.finalizeRun('UVWXY', 'abandoned')

			expect(repository.upsertPlayerLog).toHaveBeenCalledTimes(2)
			expect(repository.upsertPlayerLog).toHaveBeenCalledWith(
				expect.objectContaining({
					runId: 'run-1',
					playerId: 'p1',
					status: 'partial',
				}),
			)
			expect(repository.updateRunStatus).toHaveBeenCalledWith(
				'run-1',
				'abandoned',
			)
			lobbies.delete('UVWXY')
		})

		it('marks player logs complete only when the run status is completed', async () => {
			const repository = makeMockRepository()
			const service = createReplayLogService({ repository })
			putLobby('ZABCD')

			await service.handleActionLogEvent('ZABCD', 'p1', {
				t: 0,
				opcode: 'select_blind',
				args: 0,
			})
			await service.finalizeRun('ZABCD', 'completed')

			expect(repository.upsertPlayerLog).toHaveBeenCalledWith(
				expect.objectContaining({ status: 'complete' }),
			)
			lobbies.delete('ZABCD')
		})

		it('clears the buffer so a second finalize call is a no-op', async () => {
			const repository = makeMockRepository()
			const service = createReplayLogService({ repository })
			putLobby('EFGHI')

			await service.handleActionLogEvent('EFGHI', 'p1', {
				t: 0,
				opcode: 'select_blind',
				args: 0,
			})
			await service.finalizeRun('EFGHI', 'completed')
			await service.finalizeRun('EFGHI', 'abandoned')

			expect(repository.upsertPlayerLog).toHaveBeenCalledTimes(1)
			expect(repository.updateRunStatus).toHaveBeenCalledTimes(1)
			lobbies.delete('EFGHI')
		})

		it('compresses the buffered events into a base64 gzip block that round-trips', async () => {
			const repository = makeMockRepository()
			const service = createReplayLogService({ repository })
			putLobby('JKLMN')

			await service.handleActionLogEvent('JKLMN', 'p1', {
				t: 5,
				opcode: 'play',
				args: [[1, 3, 5]],
			})
			await service.finalizeRun('JKLMN', 'completed')

			const call = vi.mocked(repository.upsertPlayerLog).mock.calls[0][0]
			const { decompressFromBase64 } = await import(
				'../../shared/utils/compression.js'
			)
			const events = JSON.parse(decompressFromBase64(call.compressedEvents))
			expect(events).toEqual([{ t: 5, opcode: 'play', args: [[1, 3, 5]] }])
			lobbies.delete('JKLMN')
		})
	})
})
