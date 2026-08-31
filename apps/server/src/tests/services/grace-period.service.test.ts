import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mqttService } from '../../infrastructure/mqtt/mqtt.service.js'

// The ranked-forfeit branch dynamically imports routes/index.js (the
// composition root) to reach the fully-wired matchmakingService singleton --
// see grace-period.service.ts's expireGracePeriod for why (routes/index.ts
// already statically imports this module, so a static import back would be a
// real cycle). Mocked here so this stays a unit test against the contract
// (autoForfeitMatch gets called with the right args) rather than exercising
// the real matchmaking gateway stack against setup.ts's minimal db mock.
vi.mock('../../routes/index.js', () => ({
	matchmakingService: {
		autoForfeitMatch: vi.fn().mockResolvedValue(undefined),
	},
}))

import {
	cancelGracePeriod,
	cancelGracePeriodSilently,
	checkForWrongfulForfeit,
	clearAllGracePeriods,
	expireGracePeriod,
	gracePeriods,
	isInGracePeriod,
	restoreGracePeriodsFromDb,
	startGracePeriod,
} from '../../infrastructure/mqtt/grace-period.service.js'
import { replayLogService } from '../../features/replay-log/replay-log.service.js'
import { db } from '../../infrastructure/db/index.js'
import { matchmakingService } from '../../routes/index.js'
import { createSession, getLobby, lobbies } from '../../state/index.js'
import { Lobby } from '../../state/lobby.js'
import { matchByLobby } from '../../state/matchmaking.js'
import type { Match } from '../../shared/types/index.js'

function mockInsertReturningChain(row: { id: string }) {
	return vi.fn().mockReturnValue({
		values: vi.fn().mockReturnValue({
			returning: vi.fn().mockResolvedValue([row]),
		}),
	})
}

function setupLobbyWithPlayers(
	...players: { id: string; steamName: string }[]
): Lobby {
	const [host, ...guests] = players
	const sessions = players.map((p) => createSession(p.steamName, { id: p.id }))

	const lobby = new Lobby('TESTLB', 'test-mod', host.id)
	for (const session of sessions) {
		lobby.addPlayer(session)
	}
	lobbies.set('TESTLB', lobby)

	return lobby
}

afterEach(() => {
	clearAllGracePeriods()
})

describe('grace-period.service', () => {
	describe('startGracePeriod', () => {
		it('publishes player_disconnected event', async () => {
			setupLobbyWithPlayers(
				{ id: 'host1', steamName: 'Alice' },
				{ id: 'player1', steamName: 'Bob' },
			)

			await startGracePeriod('player1')

			expect(mqttService.publishEvent).toHaveBeenCalledWith(
				'TESTLB',
				expect.objectContaining({
					type: 'player_disconnected',
					playerId: 'player1',
					displayName: 'Bob',
				}),
			)
			expect(isInGracePeriod('player1')).toBe(true)
		})

		it('does nothing for sessions without lobbyCode', async () => {
			createSession('Alice', { id: 'solo1' })

			await startGracePeriod('solo1')

			expect(mqttService.publishEvent).not.toHaveBeenCalled()
			expect(isInGracePeriod('solo1')).toBe(false)
		})

		it('does nothing for non-existent sessions', async () => {
			await startGracePeriod('nonexistent')

			expect(mqttService.publishEvent).not.toHaveBeenCalled()
		})

		it('is idempotent — starting twice does not duplicate', async () => {
			setupLobbyWithPlayers(
				{ id: 'host1', steamName: 'Alice' },
				{ id: 'player1', steamName: 'Bob' },
			)

			await startGracePeriod('player1')
			await startGracePeriod('player1')

			expect(mqttService.publishEvent).toHaveBeenCalledTimes(1)
		})

		it('transfers host immediately when host disconnects', async () => {
			setupLobbyWithPlayers(
				{ id: 'host1', steamName: 'Alice' },
				{ id: 'player1', steamName: 'Bob' },
			)

			await startGracePeriod('host1')

			const lobby = getLobby('TESTLB')!
			expect(lobby.hostId).toBe('player1')

			expect(mqttService.publishEvent).toHaveBeenCalledWith(
				'TESTLB',
				expect.objectContaining({
					type: 'host_changed',
					playerId: 'player1',
				}),
			)
			expect(mqttService.publishEvent).toHaveBeenCalledWith(
				'TESTLB',
				expect.objectContaining({
					type: 'player_disconnected',
					playerId: 'host1',
				}),
			)
		})

		// §7.8: previously a solo lobby's last occupant disconnecting just sat
		// through the full 2-minute grace period like anyone else before the
		// lobby was torn down. Now it closes immediately, since there is no one
		// left to reconnect to.
		it('tears down the lobby immediately when the last connected player disconnects', async () => {
			setupLobbyWithPlayers({ id: 'host1', steamName: 'Alice' })

			await startGracePeriod('host1')

			expect(lobbies.has('TESTLB')).toBe(false)
			expect(isInGracePeriod('host1')).toBe(false)
			expect(mqttService.publishEvent).toHaveBeenCalledWith(
				'TESTLB',
				expect.objectContaining({ type: 'lobby_closed' }),
			)
			expect(mqttService.cleanupLobbyTopics).toHaveBeenCalledWith('TESTLB')
		})

		it('does NOT tear down immediately while at least one player is still connected', async () => {
			setupLobbyWithPlayers(
				{ id: 'host1', steamName: 'Alice' },
				{ id: 'player1', steamName: 'Bob' },
			)

			await startGracePeriod('player1')

			expect(lobbies.has('TESTLB')).toBe(true)
			expect(isInGracePeriod('player1')).toBe(true)
		})

		it('tears down immediately once the SECOND (and last) player also disconnects', async () => {
			setupLobbyWithPlayers(
				{ id: 'host1', steamName: 'Alice' },
				{ id: 'player1', steamName: 'Bob' },
			)

			await startGracePeriod('player1')
			await startGracePeriod('host1')

			expect(lobbies.has('TESTLB')).toBe(false)
			expect(mqttService.publishEvent).toHaveBeenCalledWith(
				'TESTLB',
				expect.objectContaining({ type: 'lobby_closed' }),
			)
		})

		it('skips away players when finding next host', async () => {
			setupLobbyWithPlayers(
				{ id: 'host1', steamName: 'Alice' },
				{ id: 'player1', steamName: 'Bob' },
				{ id: 'player2', steamName: 'Charlie' },
			)

			// Put player1 in grace period first
			await startGracePeriod('player1')
			vi.mocked(mqttService.publishEvent).mockClear()

			// Now host disconnects — should skip player1 (away), pick player2
			await startGracePeriod('host1')

			const lobby = getLobby('TESTLB')!
			expect(lobby.hostId).toBe('player2')
		})
	})

	describe('cancelGracePeriod', () => {
		it('publishes player_reconnected event', async () => {
			setupLobbyWithPlayers(
				{ id: 'host1', steamName: 'Alice' },
				{ id: 'player1', steamName: 'Bob' },
			)

			await startGracePeriod('player1')
			vi.mocked(mqttService.publishEvent).mockClear()

			const result = await cancelGracePeriod('player1')

			expect(result).toBe(true)
			expect(isInGracePeriod('player1')).toBe(false)
			expect(mqttService.publishEvent).toHaveBeenCalledWith(
				'TESTLB',
				expect.objectContaining({
					type: 'player_reconnected',
					playerId: 'player1',
					displayName: 'Bob',
				}),
			)
		})

		it('returns false if not in grace period', async () => {
			const result = await cancelGracePeriod('nobody')
			expect(result).toBe(false)
		})

		// §22.5: the reconnecting client catches up over MQTT -- a push, not a
		// REST pull -- the moment the server detects they're back. Each test
		// uses its own lobby code (replayLogService's run buffer is
		// process-global, not reset between tests) and restores db.insert
		// afterward, since it overrides the shape other describe blocks in
		// this file rely on for their own (unrelated) finalizeRun calls.
		describe('§22.5 replay-tail catch-up', () => {
			function setupLobbyWithPlayersAt(code: string, ...players: { id: string; steamName: string }[]) {
				const [host, ...rest] = players
				const sessions = players.map((p) => createSession(p.steamName, { id: p.id }))
				const lobby = new Lobby(code, 'test-mod', host.id)
				for (const session of sessions) lobby.addPlayer(session)
				lobbies.set(code, lobby)
				return lobby
			}

			it('pushes every other player\'s buffered tail to the reconnecting player', async () => {
				setupLobbyWithPlayersAt(
					'RECONN1',
					{ id: 'host1', steamName: 'Alice' },
					{ id: 'player1', steamName: 'Bob' },
				)
				const origInsert = (db as any).insert
				;(db as any).insert = mockInsertReturningChain({ id: 'run-reconnect-1' })
				await replayLogService.handleActionLogEvent('RECONN1', 'host1', {
					t: 10, opcode: 'hand_result', args: ['1234', 3],
				})
				;(db as any).insert = origInsert

				await startGracePeriod('player1')
				vi.mocked(mqttService.publishToPlayer).mockClear()

				await cancelGracePeriod('player1')

				expect(mqttService.publishToPlayer).toHaveBeenCalledWith(
					'player1',
					'replay-tail',
					expect.objectContaining({
						type: 'replay_tail',
						tails: [
							{ playerId: 'host1', events: [{ t: 10, opcode: 'hand_result', args: ['1234', 3] }] },
						],
					}),
				)
			})

			it('does not push when no other player has any buffered events', async () => {
				setupLobbyWithPlayersAt(
					'RECONN2',
					{ id: 'host1', steamName: 'Alice' },
					{ id: 'player1', steamName: 'Bob' },
				)

				await startGracePeriod('player1')
				vi.mocked(mqttService.publishToPlayer).mockClear()

				await cancelGracePeriod('player1')

				expect(mqttService.publishToPlayer).not.toHaveBeenCalled()
			})

			it('never includes the reconnecting player\'s own buffered events', async () => {
				setupLobbyWithPlayersAt(
					'RECONN3',
					{ id: 'host1', steamName: 'Alice' },
					{ id: 'player1', steamName: 'Bob' },
				)
				const origInsert = (db as any).insert
				;(db as any).insert = mockInsertReturningChain({ id: 'run-reconnect-2' })
				await replayLogService.handleActionLogEvent('RECONN3', 'player1', {
					t: 5, opcode: 'select_blind', args: [0],
				})
				;(db as any).insert = origInsert

				await startGracePeriod('player1')
				vi.mocked(mqttService.publishToPlayer).mockClear()

				await cancelGracePeriod('player1')

				expect(mqttService.publishToPlayer).not.toHaveBeenCalled()
			})
		})
	})

	describe('expireGracePeriod', () => {
		it('removes player from lobby and publishes player_left', async () => {
			setupLobbyWithPlayers(
				{ id: 'host1', steamName: 'Alice' },
				{ id: 'player1', steamName: 'Bob' },
			)

			await startGracePeriod('player1')
			vi.mocked(mqttService.publishEvent).mockClear()

			await expireGracePeriod('player1')

			const lobby = getLobby('TESTLB')!
			expect(lobby.hasPlayer('player1')).toBe(false)
			expect(isInGracePeriod('player1')).toBe(false)

			expect(mqttService.publishEvent).toHaveBeenCalledWith(
				'TESTLB',
				expect.objectContaining({
					type: 'player_left',
					playerId: 'player1',
				}),
			)
			expect(mqttService.cleanupPlayerState).toHaveBeenCalledWith(
				'TESTLB',
				'player1',
			)
		})

		it('closes lobby when the last grace period expires', async () => {
			setupLobbyWithPlayers({ id: 'host1', steamName: 'Alice' })

			// Seed the grace-period entry directly rather than via
			// startGracePeriod, so this test exercises expireGracePeriod's own
			// lobby-closing logic in isolation from §7.8's immediate-teardown
			// check (startGracePeriod would close this solo lobby itself before
			// this test ever gets to call expireGracePeriod explicitly).
			gracePeriods.set('host1', {
				playerId: 'host1',
				lobbyCode: 'TESTLB',
				displayName: 'Alice',
				disconnectedAt: new Date(),
				timer: setTimeout(() => {}, 999999),
			})
			vi.mocked(mqttService.publishEvent).mockClear()

			await expireGracePeriod('host1')

			expect(lobbies.has('TESTLB')).toBe(false)
			expect(mqttService.publishEvent).toHaveBeenCalledWith(
				'TESTLB',
				expect.objectContaining({ type: 'player_left' }),
			)
			expect(mqttService.publishEvent).toHaveBeenCalledWith(
				'TESTLB',
				expect.objectContaining({ type: 'lobby_closed' }),
			)
			expect(mqttService.cleanupLobbyTopics).toHaveBeenCalledWith('TESTLB')
		})

		it('transfers host if expired player was still host', async () => {
			setupLobbyWithPlayers(
				{ id: 'host1', steamName: 'Alice' },
				{ id: 'player1', steamName: 'Bob' },
				{ id: 'player2', steamName: 'Charlie' },
			)

			// Both disconnect, host first
			await startGracePeriod('player1')
			await startGracePeriod('host1')
			vi.mocked(mqttService.publishEvent).mockClear()

			// player1 expires first — not the host, so no transfer needed
			await expireGracePeriod('player1')

			const lobby = getLobby('TESTLB')!
			expect(lobby.hasPlayer('player1')).toBe(false)

			// host1 expires — was still host (since findNextHost found player2 but
			// host1 was the one who disconnected, host was transferred to player2 already)
			// Actually host was transferred to player2 during startGracePeriod
			expect(lobby.hostId).toBe('player2')
		})

		describe('ranked auto-forfeit (Phase 8.4)', () => {
			function setupRankedMatch(matchId: string, lobbyCode: string, hostId: string, guestId: string): Match {
				const match: Match = {
					matchId,
					lobbyCode,
					modId: 'mod1',
					gameMode: 'ranked:1v1',
					playerIds: [hostId, guestId],
					createdAt: new Date(),
				}
				matchByLobby.set(lobbyCode, match)
				return match
			}

			it('calls autoForfeitMatch with the remaining connected player when one player disconnects', async () => {
				setupLobbyWithPlayers(
					{ id: 'host1', steamName: 'Alice' },
					{ id: 'player1', steamName: 'Bob' },
				)
				setupRankedMatch('m1', 'TESTLB', 'host1', 'player1')

				await startGracePeriod('player1')
				await expireGracePeriod('player1')

				expect(matchmakingService.autoForfeitMatch).toHaveBeenCalledWith('m1', 'player1', ['host1'])
			})

			it('calls autoForfeitMatch with no remaining players when both are in grace', async () => {
				setupLobbyWithPlayers(
					{ id: 'host1', steamName: 'Alice' },
					{ id: 'player1', steamName: 'Bob' },
				)
				setupRankedMatch('m2', 'TESTLB', 'host1', 'player1')

				await startGracePeriod('player1')
				await startGracePeriod('host1')
				await expireGracePeriod('player1')

				expect(matchmakingService.autoForfeitMatch).toHaveBeenCalledWith('m2', 'player1', [])
			})

			it('calls autoForfeitMatch for a non-ranked (casual) match too -- casual has no separate reconnect grace of its own', async () => {
				setupLobbyWithPlayers(
					{ id: 'host1', steamName: 'Alice' },
					{ id: 'player1', steamName: 'Bob' },
				)
				matchByLobby.set('TESTLB', {
					matchId: 'm3',
					lobbyCode: 'TESTLB',
					modId: 'mod1',
					gameMode: 'casual:1v1',
					playerIds: ['host1', 'player1'],
					createdAt: new Date(),
				})

				await startGracePeriod('player1')
				await expireGracePeriod('player1')

				expect(matchmakingService.autoForfeitMatch).toHaveBeenCalledWith('m3', 'player1', ['host1'])
			})

			it('does not call autoForfeitMatch when the lobby has no associated match (private/practice)', async () => {
				setupLobbyWithPlayers(
					{ id: 'host1', steamName: 'Alice' },
					{ id: 'player1', steamName: 'Bob' },
				)

				await startGracePeriod('player1')
				await expireGracePeriod('player1')

				expect(matchmakingService.autoForfeitMatch).not.toHaveBeenCalled()
			})
		})
	})

	describe('cancelGracePeriodSilently', () => {
		it('clears timer without publishing events', async () => {
			setupLobbyWithPlayers(
				{ id: 'host1', steamName: 'Alice' },
				{ id: 'player1', steamName: 'Bob' },
			)

			await startGracePeriod('player1')
			vi.mocked(mqttService.publishEvent).mockClear()

			cancelGracePeriodSilently('player1')

			expect(isInGracePeriod('player1')).toBe(false)
			expect(mqttService.publishEvent).not.toHaveBeenCalled()
		})

		it('does nothing if not in grace period', () => {
			cancelGracePeriodSilently('nobody')
			// Should not throw
		})
	})

	describe('restoreGracePeriodsFromDb', () => {
		function mockGracePeriodSelectChain(rows: unknown[]) {
			const chain: any = {}
			chain.from = vi.fn().mockResolvedValue(rows)
			return chain
		}

		beforeEach(() => {
			vi.useFakeTimers()
		})

		afterEach(() => {
			vi.useRealTimers()
			vi.mocked(db.select).mockReset()
		})

		it('re-arms a future-expiry row for the remaining duration, not inline', async () => {
			setupLobbyWithPlayers(
				{ id: 'host1', steamName: 'Alice' },
				{ id: 'player1', steamName: 'Bob' },
			)
			const now = Date.now()
			vi.mocked(db.select).mockReturnValueOnce(
				mockGracePeriodSelectChain([
					{
						id: 'row1',
						playerId: 'player1',
						lobbyCode: 'TESTLB',
						displayName: 'Bob',
						disconnectedAt: new Date(now - 10_000),
						expiresAt: new Date(now + 90_000), // 90s still remaining
						createdAt: new Date(now - 10_000),
					},
				]),
			)

			await restoreGracePeriodsFromDb()

			expect(isInGracePeriod('player1')).toBe(true)
			expect(matchmakingService.autoForfeitMatch).not.toHaveBeenCalled()

			// Not yet at the remaining duration -- still armed, not fired.
			await vi.advanceTimersByTimeAsync(89_000)
			expect(isInGracePeriod('player1')).toBe(true)

			// Past the remaining duration -- fires now.
			await vi.advanceTimersByTimeAsync(2_000)
			expect(isInGracePeriod('player1')).toBe(false)
		})

		it('waits at least the minimum re-arm buffer for an already-elapsed row instead of firing inline', async () => {
			setupLobbyWithPlayers(
				{ id: 'host1', steamName: 'Alice' },
				{ id: 'player1', steamName: 'Bob' },
			)
			const now = Date.now()
			vi.mocked(db.select).mockReturnValueOnce(
				mockGracePeriodSelectChain([
					{
						id: 'row1',
						playerId: 'player1',
						lobbyCode: 'TESTLB',
						displayName: 'Bob',
						disconnectedAt: new Date(now - 200_000),
						expiresAt: new Date(now - 80_000), // already well past due
						createdAt: new Date(now - 200_000),
					},
				]),
			)

			await restoreGracePeriodsFromDb()

			// Never fires synchronously/inline within restoreGracePeriodsFromDb
			// itself -- lobby.players is still empty at boot until a real
			// reconnect lands (see MIN_REARM_BUFFER_MS's doc comment).
			expect(isInGracePeriod('player1')).toBe(true)
			expect(matchmakingService.autoForfeitMatch).not.toHaveBeenCalled()

			// Still within the minimum buffer -- not fired yet.
			await vi.advanceTimersByTimeAsync(9_000)
			expect(isInGracePeriod('player1')).toBe(true)

			// Past the minimum buffer -- fires now.
			await vi.advanceTimersByTimeAsync(2_000)
			expect(isInGracePeriod('player1')).toBe(false)
		})

		it('skips a row for a player already in an active in-memory grace period', async () => {
			setupLobbyWithPlayers(
				{ id: 'host1', steamName: 'Alice' },
				{ id: 'player1', steamName: 'Bob' },
			)
			await startGracePeriod('player1')
			const liveEntry = gracePeriods.get('player1')

			vi.mocked(db.select).mockReturnValueOnce(
				mockGracePeriodSelectChain([
					{
						id: 'row1',
						playerId: 'player1',
						lobbyCode: 'TESTLB',
						displayName: 'Bob',
						disconnectedAt: new Date(),
						expiresAt: new Date(Date.now() + 60_000),
						createdAt: new Date(),
					},
				]),
			)

			await restoreGracePeriodsFromDb()

			expect(gracePeriods.get('player1')).toBe(liveEntry)
		})
	})

	describe('checkForWrongfulForfeit', () => {
		function mockSelectChain(rows: unknown[]) {
			const chain: any = {}
			for (const method of ['from', 'where', 'orderBy', 'limit', 'offset']) {
				chain[method] = vi.fn(() => chain)
			}
			chain.then = (resolve: (r: unknown[]) => void) => resolve(rows)
			return chain
		}

		afterEach(() => {
			vi.mocked(db.select).mockReset()
			vi.mocked(db.insert).mockClear()
		})

		it('flags a match that resolved via system forfeit shortly before this reconnect', async () => {
			const forfeitedAt = new Date()
			vi.mocked(db.select)
				// 1st call: candidate system-forfeited matches for this player
				.mockReturnValueOnce(
					mockSelectChain([
						{ matchId: 'm-wrongful', lobbyCode: 'KVV3A', resultReportedAt: forfeitedAt },
					]) as any,
				)
				// 2nd call: hasOpenForfeitReconciliationFlag's dedup check -- none yet
				.mockReturnValueOnce(mockSelectChain([]) as any)
			;(db as any).insert = mockInsertReturningChain({ id: 'flag-1' })

			await checkForWrongfulForfeit('mchatlak1')

			expect(db.insert).toHaveBeenCalledTimes(1)
			const insertedValues = vi.mocked(db.insert).mock.results[0].value.values.mock.calls[0][0]
			expect(insertedValues).toMatchObject({
				matchId: 'm-wrongful',
				lobbyCode: 'KVV3A',
				playerId: 'mchatlak1',
				forfeitedAt,
			})
		})

		it('does not flag anything when no recent system forfeit matches this player', async () => {
			vi.mocked(db.select).mockReturnValue(mockSelectChain([]) as any)

			await checkForWrongfulForfeit('someone-else')

			expect(db.insert).not.toHaveBeenCalled()
		})

		it('does not double-flag an already-open flag for the same match', async () => {
			const forfeitedAt = new Date()
			vi.mocked(db.select)
				.mockReturnValueOnce(
					mockSelectChain([
						{ matchId: 'm-wrongful', lobbyCode: 'KVV3A', resultReportedAt: forfeitedAt },
					]) as any,
				)
				// hasOpenForfeitReconciliationFlag finds an existing open row
				.mockReturnValueOnce(mockSelectChain([{ id: 1 }]) as any)

			await checkForWrongfulForfeit('mchatlak1')

			expect(db.insert).not.toHaveBeenCalled()
		})
	})

	describe('clearAllGracePeriods', () => {
		it('clears all active grace periods', async () => {
			setupLobbyWithPlayers(
				{ id: 'host1', steamName: 'Alice' },
				{ id: 'player1', steamName: 'Bob' },
				{ id: 'player2', steamName: 'Charlie' },
			)

			await startGracePeriod('player1')
			await startGracePeriod('player2')

			expect(gracePeriods.size).toBe(2)

			clearAllGracePeriods()

			expect(gracePeriods.size).toBe(0)
			expect(isInGracePeriod('player1')).toBe(false)
			expect(isInGracePeriod('player2')).toBe(false)
		})
	})
})
