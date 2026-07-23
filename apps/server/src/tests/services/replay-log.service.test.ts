import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { IReplayLogRepository } from '../../contracts/IReplayLogRepository.js'
import { createReplayLogService } from '../../features/replay-log/replay-log.service.js'
import { lobbies } from '../../state/index.js'
import { Lobby } from '../../state/lobby.js'

// Mirrors replay-log.service.ts's private canonicalHashInput -- gameplay
// events only (framing opcodes excluded), encoded as [t, opcode, args]
// positional tuples. Duplicated here the same way the PvP-side Lua tests
// mirror lib/replay_log.lua's canonical_hash_input, since the function itself
// isn't exported (it's an implementation detail of verifyPlayerHash).
function expectedCarbonHash(events: { t: number; opcode: string; args?: unknown }[]) {
	const tuples = events
		.filter((e) => !['manifest', 'end', 'chk'].includes(e.opcode))
		.map((e) => [e.t, e.opcode, e.args ?? null])
	return createHash('sha256').update(JSON.stringify(tuples)).digest('hex')
}

function makeMockRepository(): IReplayLogRepository {
	return {
		insertRun: vi.fn().mockResolvedValue('run-1'),
		upsertPlayerLog: vi.fn().mockResolvedValue(undefined),
		updateRunStatus: vi.fn().mockResolvedValue(undefined),
		purgeExpiredRunLogs: vi.fn().mockResolvedValue(0),
		getRunWithLogs: vi.fn().mockResolvedValue(undefined),
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

		it('only inserts one run when host and guest both broadcast their first event concurrently', async () => {
			const repository = makeMockRepository()
			repository.insertRun = vi.fn(
				() => new Promise((resolve) => setTimeout(() => resolve('run-1'), 5)),
			)
			const service = createReplayLogService({ repository })
			putLobby('KLMNO')

			await Promise.all([
				service.handleActionLogEvent('KLMNO', 'p1', {
					t: 0,
					opcode: 'manifest',
					args: {},
				}),
				service.handleActionLogEvent('KLMNO', 'p2', {
					t: 0,
					opcode: 'manifest',
					args: {},
				}),
			])

			expect(repository.insertRun).toHaveBeenCalledTimes(1)
			lobbies.delete('KLMNO')
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

	describe('getReplay', () => {
		it('throws 404 when the run does not exist', async () => {
			const repository = makeMockRepository()
			const service = createReplayLogService({ repository })

			await expect(service.getReplay('missing-run', 'p1')).rejects.toThrow(
				'Run not found',
			)
		})

		it('throws 403 when the requester was not a participant', async () => {
			const repository = makeMockRepository()
			vi.mocked(repository.getRunWithLogs).mockResolvedValue({
				run: {
					id: 'run-1',
					lobbyCode: 'ABCDE',
					modId: 'mod1',
					lobbyType: 'public',
					status: 'completed',
					startedAt: new Date(),
					finalizedAt: new Date(),
				},
				logs: [
					{
						playerId: 'p1',
						compressedEvents: 'x',
						carbonHash: null,
						eventCount: 1,
						status: 'complete',
						flagReason: null,
					},
				],
			})
			const service = createReplayLogService({ repository })

			await expect(service.getReplay('run-1', 'someone-else')).rejects.toThrow(
				'Not a participant in this run',
			)
		})

		it('a moderator bypasses the participant check', async () => {
			const repository = makeMockRepository()
			const runWithLogs = {
				run: {
					id: 'run-1',
					lobbyCode: 'ABCDE',
					modId: 'mod1',
					lobbyType: 'public',
					status: 'completed' as const,
					startedAt: new Date(),
					finalizedAt: new Date(),
				},
				logs: [
					{
						playerId: 'p1',
						compressedEvents: 'x',
						carbonHash: null,
						eventCount: 1,
						status: 'complete' as const,
					},
				],
			}
			vi.mocked(repository.getRunWithLogs).mockResolvedValue(runWithLogs)
			const service = createReplayLogService({ repository })

			await expect(
				service.getReplay('run-1', 'someone-else', true),
			).resolves.toEqual(runWithLogs)
		})

		it('returns the run for a participant', async () => {
			const repository = makeMockRepository()
			const runWithLogs = {
				run: {
					id: 'run-1',
					lobbyCode: 'ABCDE',
					modId: 'mod1',
					lobbyType: 'public',
					status: 'completed' as const,
					startedAt: new Date(),
					finalizedAt: new Date(),
				},
				logs: [
					{
						playerId: 'p1',
						compressedEvents: 'x',
						carbonHash: null,
						eventCount: 1,
						status: 'complete' as const,
					},
				],
			}
			vi.mocked(repository.getRunWithLogs).mockResolvedValue(runWithLogs)
			const service = createReplayLogService({ repository })

			await expect(service.getReplay('run-1', 'p1')).resolves.toEqual(
				runWithLogs,
			)
		})
	})

	describe('getSpectatorSnapshot', () => {
		it('returns an empty array when nothing is buffered for the lobby', () => {
			const repository = makeMockRepository()
			const service = createReplayLogService({ repository })

			expect(service.getSpectatorSnapshot('GHOST')).toEqual([])
		})

		it('derives the latest ante marker and hand result per player', async () => {
			const repository = makeMockRepository()
			const service = createReplayLogService({ repository })
			putLobby('ABCDE')

			await service.handleActionLogEvent('ABCDE', 'p1', {
				t: 0,
				opcode: 'set_ante_key',
				args: ['bl_small'],
			})
			await service.handleActionLogEvent('ABCDE', 'p1', {
				t: 10,
				opcode: 'hand_result',
				args: ['12345', 3],
			})
			await service.handleActionLogEvent('ABCDE', 'p1', {
				t: 20,
				opcode: 'set_ante_key',
				args: ['bl_big'],
			})
			await service.handleActionLogEvent('ABCDE', 'p1', {
				t: 30,
				opcode: 'hand_result',
				args: ['67890', 2],
			})

			expect(service.getSpectatorSnapshot('ABCDE')).toEqual([
				{ playerId: 'p1', ante: 'bl_big', score: '67890', handsRemaining: 2 },
			])
			lobbies.delete('ABCDE')
		})
	})

	describe('verifyPlayerHash', () => {
		it('returns unavailable when nothing is buffered for the lobby', () => {
			const repository = makeMockRepository()
			const service = createReplayLogService({ repository })

			expect(service.verifyPlayerHash('GHOST', 'p1')).toBe('unavailable')
		})

		it('returns unavailable when the player never reached a chk event', async () => {
			const repository = makeMockRepository()
			const service = createReplayLogService({ repository })
			putLobby('ABCDE')

			await service.handleActionLogEvent('ABCDE', 'p1', {
				t: 0,
				opcode: 'select_blind',
				args: [0],
			})

			expect(service.verifyPlayerHash('ABCDE', 'p1')).toBe('unavailable')
			lobbies.delete('ABCDE')
		})

		it('returns match when the recomputed hash equals the client-submitted chk carbon hash', async () => {
			const repository = makeMockRepository()
			const service = createReplayLogService({ repository })
			putLobby('FGHIJ')

			const events = [
				{ t: 0, opcode: 'select_blind', args: [0] },
				{ t: 10, opcode: 'buy', args: [1, 2] },
			]
			for (const ev of events) {
				await service.handleActionLogEvent('FGHIJ', 'p1', ev)
			}
			await service.handleActionLogEvent('FGHIJ', 'p1', {
				t: 20,
				opcode: 'chk',
				args: { carbon: expectedCarbonHash(events), human: 'x' },
			})

			expect(service.verifyPlayerHash('FGHIJ', 'p1')).toBe('match')
			lobbies.delete('FGHIJ')
		})

		it('returns mismatch when the submitted hash does not match the buffered events', async () => {
			const repository = makeMockRepository()
			const service = createReplayLogService({ repository })
			putLobby('KLMNO')

			await service.handleActionLogEvent('KLMNO', 'p1', {
				t: 0,
				opcode: 'select_blind',
				args: [0],
			})
			await service.handleActionLogEvent('KLMNO', 'p1', {
				t: 20,
				opcode: 'chk',
				args: { carbon: 'not-the-real-hash', human: 'x' },
			})

			expect(service.verifyPlayerHash('KLMNO', 'p1')).toBe('mismatch')
			lobbies.delete('KLMNO')
		})
	})

	describe('countHandResultEvents', () => {
		it('returns 0 when nothing is buffered for the lobby', () => {
			const repository = makeMockRepository()
			const service = createReplayLogService({ repository })

			expect(service.countHandResultEvents('GHOST', 'p1')).toBe(0)
		})

		it('counts only the given player\'s hand_result events', async () => {
			const repository = makeMockRepository()
			const service = createReplayLogService({ repository })
			putLobby('PQRST')

			await service.handleActionLogEvent('PQRST', 'p1', { t: 0, opcode: 'hand_result', args: ['1', 3] })
			await service.handleActionLogEvent('PQRST', 'p1', { t: 1, opcode: 'select_blind', args: [0] })
			await service.handleActionLogEvent('PQRST', 'p1', { t: 2, opcode: 'hand_result', args: ['2', 2] })
			await service.handleActionLogEvent('PQRST', 'p2', { t: 0, opcode: 'hand_result', args: ['9', 3] })

			expect(service.countHandResultEvents('PQRST', 'p1')).toBe(2)
			expect(service.countHandResultEvents('PQRST', 'p2')).toBe(1)
			lobbies.delete('PQRST')
		})
	})

	describe('finalizeRun with flags', () => {
		it('forces expiresAt to null and records flagReason for a flagged player, leaves others on the normal TTL', async () => {
			const repository = makeMockRepository()
			const service = createReplayLogService({ repository })
			putLobby('UVWXY')

			await service.handleActionLogEvent('UVWXY', 'p1', { t: 0, opcode: 'select_blind', args: [0] })
			await service.handleActionLogEvent('UVWXY', 'p2', { t: 0, opcode: 'select_blind', args: [0] })

			await service.finalizeRun('UVWXY', 'completed', new Map([['p1', 'hash_mismatch']]))

			expect(repository.upsertPlayerLog).toHaveBeenCalledWith(
				expect.objectContaining({ playerId: 'p1', flagReason: 'hash_mismatch', expiresAt: null }),
			)
			const p2Call = vi
				.mocked(repository.upsertPlayerLog)
				.mock.calls.find((call) => call[0].playerId === 'p2')
			expect(p2Call?.[0].flagReason).toBeNull()
			expect(p2Call?.[0].expiresAt).not.toBeNull()
			lobbies.delete('UVWXY')
		})

		it('defaults every player to flagReason null when no flags map is given', async () => {
			const repository = makeMockRepository()
			const service = createReplayLogService({ repository })
			putLobby('ZABCD')

			await service.handleActionLogEvent('ZABCD', 'p1', { t: 0, opcode: 'select_blind', args: [0] })
			await service.finalizeRun('ZABCD', 'completed')

			expect(repository.upsertPlayerLog).toHaveBeenCalledWith(
				expect.objectContaining({ flagReason: null }),
			)
			lobbies.delete('ZABCD')
		})
	})
})
