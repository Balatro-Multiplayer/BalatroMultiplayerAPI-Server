import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mqttService } from '../../infrastructure/mqtt/mqtt.service.js'
import { db } from '../../infrastructure/db/index.js'

// Anti-cheat (Phase 8) tests need verifyPlayerHash/countHandResultEvents to
// return controlled values -- the real singleton only derives those from a
// live in-memory buffer, which requires handleActionLogEvent to have
// succeeded against a real (unmocked) DB. Mocking the collaborator here tests
// the actual boundary this file owns: does resolveRankedResult call
// evaluateAntiCheat correctly and thread its result into finalizeRun --
// not replayLogService's own internals, already covered by
// replay-log.service.test.ts.
vi.mock('../../features/replay-log/replay-log.service.js', () => ({
	replayLogService: {
		handleActionLogEvent: vi.fn().mockResolvedValue(undefined),
		finalizeRun: vi.fn().mockResolvedValue(undefined),
		hasBufferedRun: vi.fn().mockReturnValue(false),
		getReplay: vi.fn(),
		getSpectatorSnapshot: vi.fn().mockReturnValue([]),
		verifyPlayerHash: vi.fn().mockReturnValue('unavailable'),
		countHandResultEvents: vi.fn().mockReturnValue(0),
	},
}))

import {
	checkSeasonRollover,
	createMatchmakingService,
	getQueueStatus,
	leaveAllQueues,
	leaveQueue,
	runCasualQueue,
	runDecay,
	runRankedQueue,
} from '../../features/matchmaking/matchmaking.service.js'
import { replayLogService } from '../../features/replay-log/replay-log.service.js'
import { matches, matchByLobby, playerQueues, queues } from '../../state/matchmaking.js'
import { createSession, lobbies } from '../../state/index.js'
import { Lobby } from '../../state/lobby.js'
import type { SoloQueueEntry } from '../../shared/types/index.js'
import type { IMatchRepository } from '../../contracts/IMatchRepository.js'
import type { IBanRepository } from '../../contracts/IBanRepository.js'

function makeSession(id: string, steamName: string) {
	return createSession(steamName, { id })
}

function makeSoloEntry(playerId: string, overrides: Partial<SoloQueueEntry> = {}): SoloQueueEntry {
	return {
		type: 'solo',
		playerId,
		modId: 'mod1',
		gameMode: 'mode1',
		minPlayers: 2,
		maxPlayers: 4,
		rating: 600,
		queuedAt: new Date(),
		...overrides,
	}
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

function makeService(overrides?: { matchRepository?: IMatchRepository; banRepository?: IBanRepository }) {
	const matchRepository = overrides?.matchRepository ?? makeMockMatchRepository()
	const banRepository = overrides?.banRepository ?? makeMockBanRepository()
	const service = createMatchmakingService({ messageBus: mqttService, matchRepository, banRepository })
	return { service, matchRepository, banRepository }
}

describe('matchmaking.service', () => {
	describe('joinQueue', () => {
		it('adds a solo player and returns position 1', async () => {
			const { service } = makeService()
			const session = makeSession('p1', 'Alice')
			const result = await service.joinQueue(session, {
				modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4,
			})
			expect(result.position).toBe(1)
			expect(playerQueues.get('p1')?.size).toBe(1)
		})

		it('returns correct position for subsequent players', async () => {
			const { service } = makeService()
			await service.joinQueue(makeSession('p1', 'Alice'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			const result = await service.joinQueue(makeSession('p2', 'Bob'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			expect(result.position).toBe(2)
		})

		it('allows queuing for multiple modes simultaneously', async () => {
			const { service } = makeService()
			const session = makeSession('p1', 'Alice')
			await service.joinQueue(session, { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			const result = await service.joinQueue(session, { modId: 'mod1', gameMode: 'mode2', minPlayers: 2, maxPlayers: 4 })
			expect(result.position).toBe(1)
			expect(playerQueues.get('p1')?.size).toBe(2)
		})

		it('throws 409 when already queued for the same mode', async () => {
			const { service } = makeService()
			const session = makeSession('p1', 'Alice')
			await service.joinQueue(session, { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			await expect(
				service.joinQueue(session, { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 }),
			).rejects.toThrow('Already queued for this mode')
		})

		it('throws 409 when player is inside a matchmade (public) lobby', async () => {
			const { service } = makeService()
			const lobby = new Lobby('PUBLO', 'mod1', 'p1', 16, 'public')
			lobbies.set('PUBLO', lobby)
			const session = makeSession('p1', 'Alice')
			session.lobbyCode = 'PUBLO'
			await expect(
				service.joinQueue(session, { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 }),
			).rejects.toThrow('Cannot queue while in a matchmade lobby')
		})

		it('throws 409 when min/max mismatches the existing queue for that mode', async () => {
			const { service } = makeService()
			await service.joinQueue(makeSession('p1', 'Alice'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			await expect(
				service.joinQueue(makeSession('p2', 'Bob'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 8 }),
			).rejects.toThrow('minPlayers/maxPlayers must match')
		})

		it('throws 400 when minPlayers < 2', async () => {
			const { service } = makeService()
			await expect(
				service.joinQueue(makeSession('p1', 'Alice'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 1, maxPlayers: 4 }),
			).rejects.toThrow('minPlayers must be at least 2')
		})

		it('throws 400 when maxPlayers < minPlayers', async () => {
			const { service } = makeService()
			await expect(
				service.joinQueue(makeSession('p1', 'Alice'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 4, maxPlayers: 2 }),
			).rejects.toThrow('maxPlayers must be >= minPlayers')
		})

		describe('group queue (from a private lobby)', () => {
			function makeGroupLobby(code: string, hostId: string, guestId: string, maxPlayers = 16) {
				const lobby = new Lobby(code, 'mod1', hostId, maxPlayers, 'private')
				const hostSession = makeSession(hostId, 'Host')
				const guestSession = makeSession(guestId, 'Guest')
				hostSession.lobbyCode = code
				guestSession.lobbyCode = code
				lobby.players.set(hostId, hostSession)
				lobby.players.set(guestId, guestSession)
				lobbies.set(code, lobby)
				return { lobby, hostSession, guestSession }
			}

			it('queues all lobby members and returns their combined count as position', async () => {
				const { service } = makeService()
				const { hostSession } = makeGroupLobby('PRIV1', 'host1', 'guest1')
				const result = await service.joinQueue(hostSession, {
					modId: 'mod1', gameMode: 'mode1', minPlayers: 3, maxPlayers: 6,
				})
				expect(result.position).toBe(2)
				expect(playerQueues.get('host1')?.size).toBe(1)
				expect(playerQueues.get('guest1')?.size).toBe(1)
			})

			it('throws 403 when non-host initiates group queue', async () => {
				const { service } = makeService()
				const { guestSession } = makeGroupLobby('PRIV1', 'host1', 'guest1')
				await expect(
					service.joinQueue(guestSession, { modId: 'mod1', gameMode: 'mode1', minPlayers: 3, maxPlayers: 6 }),
				).rejects.toThrow('Only the lobby host can initiate group queue')
			})

			it('throws 400 when group size leaves no room for other players', async () => {
				const { service } = makeService()
				const { hostSession } = makeGroupLobby('PRIV1', 'host1', 'guest1', 2)
				await expect(
					service.joinQueue(hostSession, { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 2 }),
				).rejects.toThrow('Group size must leave room')
			})
		})
	})

	describe('leaveQueue', () => {
		it('removes a solo player from the queue', async () => {
			const { service } = makeService()
			await service.joinQueue(makeSession('p1', 'Alice'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			leaveQueue('p1', 'mod1', 'mode1')
			expect(playerQueues.has('p1')).toBe(false)
			expect(queues.has('mod1:mode1')).toBe(false)
		})

		it('is a no-op when player is not in the queue', () => {
			expect(() => leaveQueue('nobody', 'mod1', 'mode1')).not.toThrow()
		})

		it('removes the entire group entry and clears all members', async () => {
			const { service } = makeService()
			const lobby = new Lobby('PRIV1', 'mod1', 'host1', 16, 'private')
			const host = makeSession('host1', 'Host')
			const guest = makeSession('guest1', 'Guest')
			host.lobbyCode = 'PRIV1'
			guest.lobbyCode = 'PRIV1'
			lobby.players.set('host1', host)
			lobby.players.set('guest1', guest)
			lobbies.set('PRIV1', lobby)
			await service.joinQueue(host, { modId: 'mod1', gameMode: 'mode1', minPlayers: 3, maxPlayers: 6 })

			leaveQueue('host1', 'mod1', 'mode1')

			expect(playerQueues.has('host1')).toBe(false)
			expect(playerQueues.has('guest1')).toBe(false)
			expect(queues.has('mod1:mode1')).toBe(false)
		})
	})

	describe('leaveAllQueues', () => {
		it('removes a player from every queue they are in', async () => {
			const { service } = makeService()
			const session = makeSession('p1', 'Alice')
			await service.joinQueue(session, { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			await service.joinQueue(session, { modId: 'mod1', gameMode: 'mode2', minPlayers: 2, maxPlayers: 4 })

			leaveAllQueues('p1')

			expect(playerQueues.has('p1')).toBe(false)
			expect(queues.has('mod1:mode1')).toBe(false)
			expect(queues.has('mod1:mode2')).toBe(false)
		})

		it('is a no-op when player has no active queues', () => {
			expect(() => leaveAllQueues('nobody')).not.toThrow()
		})
	})

	describe('getQueueStatus', () => {
		it('returns empty array when player is not queued', () => {
			expect(getQueueStatus('p1')).toEqual([])
		})

		it('returns all active queue entries for a player', async () => {
			const { service } = makeService()
			const session = makeSession('p1', 'Alice')
			await service.joinQueue(session, { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			await service.joinQueue(session, { modId: 'mod1', gameMode: 'mode2', minPlayers: 2, maxPlayers: 4 })

			const status = getQueueStatus('p1')
			expect(status).toHaveLength(2)
			expect(status.map((e) => e.gameMode)).toEqual(expect.arrayContaining(['mode1', 'mode2']))
		})
	})

	describe('updateGroupQueueOnLobbyJoin', () => {
		async function queueGroup(service: ReturnType<typeof makeService>['service'], code: string, hostId: string, guestId: string, maxPlayers: number) {
			const lobby = new Lobby(code, 'mod1', hostId, maxPlayers, 'private')
			const host = makeSession(hostId, 'Host')
			const guest = makeSession(guestId, 'Guest')
			host.lobbyCode = code
			guest.lobbyCode = code
			lobby.players.set(hostId, host)
			lobby.players.set(guestId, guest)
			lobbies.set(code, lobby)
			await service.joinQueue(host, { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers })
			return lobby
		}

		it('adds a newly joined player to the group entry', async () => {
			const { service } = makeService()
			await queueGroup(service, 'PRIV1', 'host1', 'guest1', 8)
			makeSession('guest2', 'Charlie')

			await service.updateGroupQueueOnLobbyJoin('PRIV1', 'guest2')

			const entry = queues.get('mod1:mode1')![0] as any
			expect(entry.playerIds).toContain('guest2')
			expect(playerQueues.get('guest2')?.size).toBe(1)
		})

		it('does not add player when group would consume all slots', async () => {
			const { service } = makeService()
			await queueGroup(service, 'PRIV1', 'host1', 'guest1', 3)
			makeSession('guest2', 'Charlie')

			await service.updateGroupQueueOnLobbyJoin('PRIV1', 'guest2')

			const entry = queues.get('mod1:mode1')![0] as any
			expect(entry.playerIds).not.toContain('guest2')
		})

		it('is a no-op for a lobby that is not in the queue', async () => {
			const { service } = makeService()
			await expect(service.updateGroupQueueOnLobbyJoin('ZZZZZ', 'p1')).resolves.not.toThrow()
		})
	})

	describe('removeGroupQueueForLobby', () => {
		it('removes the group entry and clears all member playerQueues entries', async () => {
			const { service } = makeService()
			const lobby = new Lobby('PRIV1', 'mod1', 'host1', 16, 'private')
			const host = makeSession('host1', 'Host')
			const guest = makeSession('guest1', 'Guest')
			host.lobbyCode = 'PRIV1'
			guest.lobbyCode = 'PRIV1'
			lobby.players.set('host1', host)
			lobby.players.set('guest1', guest)
			lobbies.set('PRIV1', lobby)
			await service.joinQueue(host, { modId: 'mod1', gameMode: 'mode1', minPlayers: 3, maxPlayers: 6 })

			service.removeGroupQueueForLobby('PRIV1')

			expect(queues.has('mod1:mode1')).toBe(false)
			expect(playerQueues.has('host1')).toBe(false)
			expect(playerQueues.has('guest1')).toBe(false)
		})

		it('is a no-op for an unknown lobby code', () => {
			const { service } = makeService()
			expect(() => service.removeGroupQueueForLobby('ZZZZZ')).not.toThrow()
		})
	})

	describe('runCasualQueue', () => {
		it('returns empty when queue is empty', () => {
			expect(runCasualQueue([], 2, 4)).toEqual([])
		})

		it('returns empty when fewer than minPlayers are present', () => {
			expect(runCasualQueue([makeSoloEntry('p1')], 2, 4)).toEqual([])
		})

		it('forms a single match from exactly minPlayers', () => {
			const formed = runCasualQueue([makeSoloEntry('p1'), makeSoloEntry('p2')], 2, 4)
			expect(formed).toHaveLength(1)
			expect(formed[0]).toHaveLength(2)
		})

		it('forms multiple matches from a large queue', () => {
			const entries = Array.from({ length: 6 }, (_, i) => makeSoloEntry(`p${i}`))
			const formed = runCasualQueue(entries, 2, 2)
			expect(formed).toHaveLength(3)
		})

		it('leaves a remainder too small to form another match', () => {
			const entries = Array.from({ length: 5 }, (_, i) => makeSoloEntry(`p${i}`))
			const formed = runCasualQueue(entries, 3, 3)
			expect(formed).toHaveLength(1)
			expect(formed[0]).toHaveLength(3)
		})

		it('caps each match at maxPlayers', () => {
			const entries = Array.from({ length: 6 }, (_, i) => makeSoloEntry(`p${i}`))
			const formed = runCasualQueue(entries, 2, 3)
			expect(formed).toHaveLength(2)
			for (const match of formed) {
				const count = match.reduce(
					(sum, e) => sum + (e.type === 'solo' ? 1 : (e as any).playerIds.length),
					0,
				)
				expect(count).toBeLessThanOrEqual(3)
			}
		})
	})

	describe('runRankedQueue', () => {
		it('matches two players within the initial rating spread', () => {
			const entries = [
				makeSoloEntry('p1', { rating: 600 }),
				makeSoloEntry('p2', { rating: 700 }),
			]
			expect(runRankedQueue(entries, 2, 4)).toHaveLength(1)
		})

		it('does not match players outside the initial spread', () => {
			const entries = [
				makeSoloEntry('p1', { rating: 600 }),
				makeSoloEntry('p2', { rating: 900 }),
			]
			expect(runRankedQueue(entries, 2, 4)).toHaveLength(0)
		})

		it('matches out-of-range players after wait time expands the spread', () => {
			const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
			const entries = [
				makeSoloEntry('p1', { rating: 600, queuedAt: fiveMinutesAgo }),
				makeSoloEntry('p2', { rating: 1000 }),
			]
			expect(runRankedQueue(entries, 2, 4)).toHaveLength(1)
		})

		it('never exceeds RANKED_SPREAD_CAP regardless of wait time', () => {
			const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
			const entries = [
				makeSoloEntry('p1', { rating: 600, queuedAt: oneHourAgo }),
				makeSoloEntry('p2', { rating: 1300 }),
			]
			expect(runRankedQueue(entries, 2, 4)).toHaveLength(0)
		})

		it('stops trying when the oldest anchor cannot be matched', () => {
			const entries = [
				makeSoloEntry('p1', { rating: 100 }),
				makeSoloEntry('p2', { rating: 800 }),
				makeSoloEntry('p3', { rating: 850 }),
			]
			expect(runRankedQueue(entries, 2, 4)).toHaveLength(0)
		})
	})

	describe('runMatchmakingCycle', () => {
		it('matches two queued players and records the match', async () => {
			const { service } = makeService()
			await service.joinQueue(makeSession('p1', 'Alice'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			await service.joinQueue(makeSession('p2', 'Bob'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })

			await service.runMatchmakingCycle()

			expect(queues.has('mod1:mode1')).toBe(false)
			expect(playerQueues.has('p1')).toBe(false)
			expect(playerQueues.has('p2')).toBe(false)
			expect(matches.size).toBe(1)
			const [match] = matches.values()
			expect(match.modId).toBe('mod1')
			expect(match.gameMode).toBe('mode1')
			expect(match.playerIds).toEqual(expect.arrayContaining(['p1', 'p2']))
		})

		it('notifies each matched player via MQTT', async () => {
			const { service } = makeService()
			await service.joinQueue(makeSession('p1', 'Alice'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			await service.joinQueue(makeSession('p2', 'Bob'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })

			await service.runMatchmakingCycle()

			expect(mqttService.publishToPlayer).toHaveBeenCalledWith(
				'p1', 'matchmaking', expect.objectContaining({ type: 'match_found' }),
			)
			expect(mqttService.publishToPlayer).toHaveBeenCalledWith(
				'p2', 'matchmaking', expect.objectContaining({ type: 'match_found' }),
			)
		})

		it('does not match when queue has fewer than minPlayers', async () => {
			const { service } = makeService()
			await service.joinQueue(makeSession('p1', 'Alice'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 3, maxPlayers: 4 })

			await service.runMatchmakingCycle()

			expect(matches.size).toBe(0)
			expect(queues.get('mod1:mode1')).toHaveLength(1)
		})

		it('forms separate matches for different gamemodes in one cycle', async () => {
			const { service } = makeService()
			await service.joinQueue(makeSession('p1', 'Alice'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			await service.joinQueue(makeSession('p2', 'Bob'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			await service.joinQueue(makeSession('p3', 'Carol'), { modId: 'mod1', gameMode: 'mode2', minPlayers: 2, maxPlayers: 4 })
			await service.joinQueue(makeSession('p4', 'Dave'), { modId: 'mod1', gameMode: 'mode2', minPlayers: 2, maxPlayers: 4 })

			await service.runMatchmakingCycle()

			expect(matches.size).toBe(2)
		})
	})

	describe('reportResult', () => {
		function setupCasualMatch(matchId: string, code: string) {
			const host = makeSession('host1', 'Alice')
			const guest = makeSession('guest1', 'Bob')
			const lobby = new Lobby(code, 'mod1', 'host1', 16, 'public')
			lobby.players.set('host1', host)
			lobby.players.set('guest1', guest)
			lobbies.set(code, lobby)
			const match = {
				matchId,
				lobbyCode: code,
				modId: 'mod1',
				gameMode: 'casual_mode',
				playerIds: ['host1', 'guest1'],
				createdAt: new Date(),
			}
			matches.set(matchId, match)
			matchByLobby.set(code, match)
			return { host, guest }
		}

		it('removes match from state after a casual result is reported', async () => {
			const { service } = makeService()
			const { host } = setupCasualMatch('match-1', 'CODA1')
			await service.reportResult(host, 'match-1', [
				{ playerId: 'host1', place: 1 },
				{ playerId: 'guest1', place: 2 },
			])
			expect(matches.has('match-1')).toBe(false)
			expect(matchByLobby.has('CODA1')).toBe(false)
		})

		it('throws 404 when the match does not exist', async () => {
			const { service } = makeService()
			const session = makeSession('p1', 'Alice')
			await expect(
				service.reportResult(session, 'nonexistent', [
					{ playerId: 'p1', place: 1 },
					{ playerId: 'p2', place: 2 },
				]),
			).rejects.toThrow('Match not found')
		})

		it('§11.6: a non-host participant can report (not just the host)', async () => {
			const { service } = makeService()
			const { guest } = setupCasualMatch('match-2', 'CODA2')
			await expect(
				service.reportResult(guest, 'match-2', [
					{ playerId: 'host1', place: 1 },
					{ playerId: 'guest1', place: 2 },
				]),
			).resolves.toBeUndefined()
			expect(matches.has('match-2')).toBe(false)
		})

		it('throws 403 when the reporter was not a participant in the match', async () => {
			const { service } = makeService()
			setupCasualMatch('match-2b', 'CODA2B')
			const outsider = makeSession('outsider', 'Eve')
			await expect(
				service.reportResult(outsider, 'match-2b', [
					{ playerId: 'host1', place: 1 },
					{ playerId: 'guest1', place: 2 },
				]),
			).rejects.toThrow('Not a participant in this match')
		})

		it('throws 404 when the lobby has been removed', async () => {
			const { service } = makeService()
			const host = makeSession('host1', 'Alice')
			const match = {
				matchId: 'orphan',
				lobbyCode: 'GONE1',
				modId: 'mod1',
				gameMode: 'casual_mode',
				playerIds: ['host1'],
				createdAt: new Date(),
			}
			matches.set('orphan', match)
			await expect(
				service.reportResult(host, 'orphan', [
					{ playerId: 'host1', place: 1 },
					{ playerId: 'guest1', place: 2 },
				]),
			).rejects.toThrow('Lobby not found')
		})

		it('persists the result via recordMatchResult when a casual match resolves', async () => {
			const matchRepository = makeMockMatchRepository()
			const { service } = makeService({ matchRepository })
			const { host } = setupCasualMatch('match-3', 'CODA3')
			await service.reportResult(host, 'match-3', [
				{ playerId: 'host1', place: 1 },
				{ playerId: 'guest1', place: 2 },
			])
			expect(vi.mocked(matchRepository.recordMatchResult)).toHaveBeenCalledWith(
				'match-3',
				[
					{ playerId: 'host1', place: 1 },
					{ playerId: 'guest1', place: 2 },
				],
				'host1',
			)
		})

		it('§11.6/§21.5: a second, matching report for an already-resolved match is a silent no-op', async () => {
			const matchRepository = makeMockMatchRepository()
			const { service } = makeService({ matchRepository })
			const { host, guest } = setupCasualMatch('match-4', 'CODA4')
			const placements = [
				{ playerId: 'host1', place: 1 },
				{ playerId: 'guest1', place: 2 },
			]
			await service.reportResult(host, 'match-4', placements)

			// Simulate the persisted result the first report just wrote.
			vi.mocked(matchRepository.getResolvedMatchResult).mockResolvedValue({
				lobbyCode: 'CODA4',
				placements,
				reportedBy: 'host1',
			})

			vi.mocked(db.insert).mockClear()
			await expect(
				service.reportResult(guest, 'match-4', [
					{ playerId: 'host1', place: 1 },
					{ playerId: 'guest1', place: 2 },
				]),
			).resolves.toBeUndefined()
			// A matching second report shouldn't insert a conflict row at all.
			expect(vi.mocked(db.insert)).not.toHaveBeenCalled()
		})

		it('§11.6/§21.5: a second, differing report is flagged as a conflict, not applied', async () => {
			const matchRepository = makeMockMatchRepository()
			vi.mocked(matchRepository.getResolvedMatchResult).mockResolvedValue({
				lobbyCode: 'CODA5',
				placements: [
					{ playerId: 'host1', place: 1 },
					{ playerId: 'guest1', place: 2 },
				],
				reportedBy: 'host1',
			})
			const { service } = makeService({ matchRepository })
			const guest = makeSession('guest1', 'Bob')

			vi.mocked(db.insert).mockClear()
			await service.reportResult(guest, 'match-5', [
				{ playerId: 'host1', place: 2 },
				{ playerId: 'guest1', place: 1 },
			])

			expect(vi.mocked(db.insert)).toHaveBeenCalledTimes(1)
		})

		it('§21.5: a differing report from a non-participant is rejected, not flagged', async () => {
			const matchRepository = makeMockMatchRepository()
			vi.mocked(matchRepository.getResolvedMatchResult).mockResolvedValue({
				lobbyCode: 'CODA6',
				placements: [
					{ playerId: 'host1', place: 1 },
					{ playerId: 'guest1', place: 2 },
				],
				reportedBy: 'host1',
			})
			const { service } = makeService({ matchRepository })
			const outsider = makeSession('outsider', 'Eve')

			await expect(
				service.reportResult(outsider, 'match-6', [
					{ playerId: 'host1', place: 2 },
					{ playerId: 'guest1', place: 1 },
				]),
			).rejects.toThrow('Not a participant in this match')
		})
	})

	describe('reportResult — ranked', () => {
		function setupRankedMatch(
			matchId: string,
			code: string,
			hostId = 'rhost',
			guestId = 'rguest',
		) {
			const host = makeSession(hostId, 'Alice')
			const guest = makeSession(guestId, 'Bob')
			const lobby = new Lobby(code, 'mod1', hostId, 16, 'public')
			lobby.players.set(hostId, host)
			lobby.players.set(guestId, guest)
			lobbies.set(code, lobby)
			const match = {
				matchId,
				lobbyCode: code,
				modId: 'mod1',
				gameMode: 'ranked:1v1',
				playerIds: [hostId, guestId],
				createdAt: new Date(),
			}
			matches.set(matchId, match)
			matchByLobby.set(code, match)
			return { host, guest }
		}

		it('publishes match_resolved to both players', async () => {
			const matchRepository = makeMockMatchRepository()
			vi.mocked(matchRepository.getCurrentSeason).mockResolvedValue({ id: 1, name: 'Season 1' })
			vi.mocked(matchRepository.applyRatingTransaction).mockResolvedValue([
				{ playerId: 'rhost', newRating: 620, delta: 20, isPlacement: false, gamesPlayed: 11 },
				{ playerId: 'rguest', newRating: 580, delta: -20, isPlacement: false, gamesPlayed: 11 },
			])
			const { service } = makeService({ matchRepository })
			const { host } = setupRankedMatch('r1', 'RNKL1')

			await service.reportResult(host, 'r1', [
				{ playerId: 'rhost', place: 1 },
				{ playerId: 'rguest', place: 2 },
			])

			const targets = vi
				.mocked(mqttService.publishToPlayer)
				.mock.calls.filter(([, topic]) => topic === 'matchmaking')
				.map(([pid]) => pid)

			expect(targets).toContain('rhost')
			expect(targets).toContain('rguest')
		})

		it('match_resolved payload contains ratings array with correct shape', async () => {
			const matchRepository = makeMockMatchRepository()
			vi.mocked(matchRepository.getCurrentSeason).mockResolvedValue({ id: 1, name: 'Season 1' })
			vi.mocked(matchRepository.applyRatingTransaction).mockResolvedValue([
				{ playerId: 'rhost', newRating: 620, delta: 20, isPlacement: false, gamesPlayed: 11 },
				{ playerId: 'rguest', newRating: 580, delta: -20, isPlacement: false, gamesPlayed: 11 },
			])
			const { service } = makeService({ matchRepository })
			const { host } = setupRankedMatch('r2', 'RNKL2')

			await service.reportResult(host, 'r2', [
				{ playerId: 'rhost', place: 1 },
				{ playerId: 'rguest', place: 2 },
			])

			const payload = vi
				.mocked(mqttService.publishToPlayer)
				.mock.calls.find(([, topic]) => topic === 'matchmaking')?.[2] as any

			expect(payload.type).toBe('match_resolved')
			expect(payload.matchId).toBe('r2')
			expect(Array.isArray(payload.ratings)).toBe(true)
			expect(payload.ratings).toHaveLength(2)
			for (const r of payload.ratings) {
				expect(r).toHaveProperty('playerId')
				expect(r).toHaveProperty('gamesPlayed')
				expect(r).toHaveProperty('isPlacement')
			}
		})

		it('hides rating and delta during placement (isPlacement=true, newRating/delta null)', async () => {
			const matchRepository = makeMockMatchRepository()
			vi.mocked(matchRepository.getCurrentSeason).mockResolvedValue({ id: 1, name: 'Season 1' })
			vi.mocked(matchRepository.applyRatingTransaction).mockResolvedValue([
				{ playerId: 'rhost', newRating: null, delta: null, isPlacement: true, gamesPlayed: 1 },
				{ playerId: 'rguest', newRating: null, delta: null, isPlacement: true, gamesPlayed: 1 },
			])
			const { service } = makeService({ matchRepository })
			const { host } = setupRankedMatch('r3', 'RNKL3')

			await service.reportResult(host, 'r3', [
				{ playerId: 'rhost', place: 1 },
				{ playerId: 'rguest', place: 2 },
			])

			const payload = vi
				.mocked(mqttService.publishToPlayer)
				.mock.calls.find(([, topic]) => topic === 'matchmaking')?.[2] as any

			for (const r of payload.ratings) {
				expect(r.isPlacement).toBe(true)
				expect(r.newRating).toBeNull()
				expect(r.delta).toBeNull()
			}
		})

		it('reveals rating and delta after completing placement (isPlacement=false)', async () => {
			const matchRepository = makeMockMatchRepository()
			vi.mocked(matchRepository.getCurrentSeason).mockResolvedValue({ id: 1, name: 'Season 1' })
			vi.mocked(matchRepository.applyRatingTransaction).mockResolvedValue([
				{ playerId: 'rhost', newRating: 750, delta: 50, isPlacement: false, gamesPlayed: 5 },
				{ playerId: 'rguest', newRating: 550, delta: -50, isPlacement: false, gamesPlayed: 5 },
			])
			const { service } = makeService({ matchRepository })
			const { host } = setupRankedMatch('r4', 'RNKL4')

			await service.reportResult(host, 'r4', [
				{ playerId: 'rhost', place: 1 },
				{ playerId: 'rguest', place: 2 },
			])

			const payload = vi
				.mocked(mqttService.publishToPlayer)
				.mock.calls.find(([, topic]) => topic === 'matchmaking')?.[2] as any

			for (const r of payload.ratings) {
				expect(r.isPlacement).toBe(false)
				expect(r.newRating).not.toBeNull()
				expect(r.delta).not.toBeNull()
			}
		})

		it('cleans up in-memory match state after ranked result', async () => {
			const matchRepository = makeMockMatchRepository()
			vi.mocked(matchRepository.getCurrentSeason).mockResolvedValue({ id: 1, name: 'Season 1' })
			vi.mocked(matchRepository.applyRatingTransaction).mockResolvedValue([
				{ playerId: 'rhost', newRating: 620, delta: 20, isPlacement: false, gamesPlayed: 11 },
				{ playerId: 'rguest', newRating: 580, delta: -20, isPlacement: false, gamesPlayed: 11 },
			])
			const { service } = makeService({ matchRepository })
			const { host } = setupRankedMatch('r5', 'RNKL5')

			await service.reportResult(host, 'r5', [
				{ playerId: 'rhost', place: 1 },
				{ playerId: 'rguest', place: 2 },
			])

			expect(matches.has('r5')).toBe(false)
			expect(matchByLobby.has('RNKL5')).toBe(false)
		})

		it('throws No active season when getCurrentSeason returns null', async () => {
			const matchRepository = makeMockMatchRepository()
			vi.mocked(matchRepository.getCurrentSeason).mockResolvedValue(null)
			const { service } = makeService({ matchRepository })
			const { host } = setupRankedMatch('r6', 'RNKL6')

			await expect(
				service.reportResult(host, 'r6', [
					{ playerId: 'rhost', place: 1 },
					{ playerId: 'rguest', place: 2 },
				]),
			).rejects.toThrow('No active season')
		})

		describe('anti-cheat (Phase 8)', () => {
			// vi.clearAllMocks() (global beforeEach) resets call history but NOT a
			// mockImplementation set by a previous test -- these mocks are on a
			// module-level singleton shared across every test in this file (see the
			// vi.mock factory above), so without an explicit reset here, one test's
			// verifyPlayerHash/countHandResultEvents override leaks into the next.
			beforeEach(() => {
				vi.mocked(replayLogService.verifyPlayerHash).mockReturnValue('unavailable')
				vi.mocked(replayLogService.countHandResultEvents).mockReturnValue(0)
			})

			it('flags a hash mismatch but still applies ELO normally', async () => {
				const matchRepository = makeMockMatchRepository()
				vi.mocked(matchRepository.getCurrentSeason).mockResolvedValue({ id: 1, name: 'Season 1' })
				vi.mocked(matchRepository.applyRatingTransaction).mockResolvedValue([
					{ playerId: 'rhost', newRating: 620, delta: 20, isPlacement: false, gamesPlayed: 11 },
					{ playerId: 'rguest', newRating: 580, delta: -20, isPlacement: false, gamesPlayed: 11 },
				])
				vi.mocked(replayLogService.verifyPlayerHash).mockImplementation((_code, playerId) =>
					playerId === 'rhost' ? 'mismatch' : 'match',
				)
				const { service } = makeService({ matchRepository })
				const { host } = setupRankedMatch('r7', 'RNKL7')

				await service.reportResult(host, 'r7', [
					{ playerId: 'rhost', place: 1 },
					{ playerId: 'rguest', place: 2 },
				])

				// ELO still applied despite the flag -- flag, don't reject.
				expect(matchRepository.applyRatingTransaction).toHaveBeenCalled()
				const flags = vi.mocked(replayLogService.finalizeRun).mock.calls[0][2]
				expect(flags?.get('rhost')).toBe('hash_mismatch')
				expect(flags?.get('rguest')).toBeUndefined()
			})

			it('flags the elapsed-time gate when reported hand count implies an impossibly fast run', async () => {
				const matchRepository = makeMockMatchRepository()
				vi.mocked(matchRepository.getCurrentSeason).mockResolvedValue({ id: 1, name: 'Season 1' })
				vi.mocked(matchRepository.applyRatingTransaction).mockResolvedValue([
					{ playerId: 'rhost', newRating: 620, delta: 20, isPlacement: false, gamesPlayed: 11 },
					{ playerId: 'rguest', newRating: 580, delta: -20, isPlacement: false, gamesPlayed: 11 },
				])
				// 100 hands * MIN_MS_PER_HAND (3000ms) = 300s minimum -- the match's
				// createdAt is "now" (setupRankedMatch), so real elapsed time is ~0ms.
				vi.mocked(replayLogService.countHandResultEvents).mockImplementation((_code, playerId) =>
					playerId === 'rhost' ? 100 : 0,
				)
				const { service } = makeService({ matchRepository })
				const { host } = setupRankedMatch('r8', 'RNKL8')

				await service.reportResult(host, 'r8', [
					{ playerId: 'rhost', place: 1 },
					{ playerId: 'rguest', place: 2 },
				])

				const flags = vi.mocked(replayLogService.finalizeRun).mock.calls[0][2]
				expect(flags?.get('rhost')).toBe('elapsed_time_gate')
				expect(flags?.get('rguest')).toBeUndefined()
			})

			it('passes an empty flags map through to finalizeRun for a clean result', async () => {
				const matchRepository = makeMockMatchRepository()
				vi.mocked(matchRepository.getCurrentSeason).mockResolvedValue({ id: 1, name: 'Season 1' })
				vi.mocked(matchRepository.applyRatingTransaction).mockResolvedValue([
					{ playerId: 'rhost', newRating: 620, delta: 20, isPlacement: false, gamesPlayed: 11 },
					{ playerId: 'rguest', newRating: 580, delta: -20, isPlacement: false, gamesPlayed: 11 },
				])
				const { service } = makeService({ matchRepository })
				const { host } = setupRankedMatch('r9', 'RNKL9')

				await service.reportResult(host, 'r9', [
					{ playerId: 'rhost', place: 1 },
					{ playerId: 'rguest', place: 2 },
				])

				expect(replayLogService.finalizeRun).toHaveBeenCalledWith(
					'RNKL9',
					'completed',
					new Map(),
				)
			})
		})

		describe('autoForfeitMatch (Phase 8.4)', () => {
			it('is a no-op when the match is already resolved', async () => {
				const matchRepository = makeMockMatchRepository()
				const { service } = makeService({ matchRepository })

				await service.autoForfeitMatch('never-existed', 'someone', ['someone-else'])

				expect(matchRepository.applyRatingTransaction).not.toHaveBeenCalled()
				expect(matchRepository.updateMatchStatus).not.toHaveBeenCalled()
			})

			it('resolves the match with the disconnected player placed last when one player remains', async () => {
				const matchRepository = makeMockMatchRepository()
				vi.mocked(matchRepository.getCurrentSeason).mockResolvedValue({ id: 1, name: 'Season 1' })
				vi.mocked(matchRepository.applyRatingTransaction).mockResolvedValue([
					{ playerId: 'rhost', newRating: 620, delta: 20, isPlacement: false, gamesPlayed: 11 },
					{ playerId: 'rguest', newRating: 580, delta: -20, isPlacement: false, gamesPlayed: 11 },
				])
				const { service } = makeService({ matchRepository })
				setupRankedMatch('f1', 'FRFT1')

				await service.autoForfeitMatch('f1', 'rguest', ['rhost'])

				expect(matchRepository.applyRatingTransaction).toHaveBeenCalledWith(
					'f1',
					expect.anything(),
					1,
					[
						{ playerId: 'rhost', place: 1 },
						{ playerId: 'rguest', place: 2 },
					],
				)
				expect(replayLogService.finalizeRun).toHaveBeenCalledWith('FRFT1', 'completed', expect.any(Map))
				expect(matches.has('f1')).toBe(false)
				expect(matchByLobby.has('FRFT1')).toBe(false)
			})

			it('cancels with no ELO when no players remain connected', async () => {
				const matchRepository = makeMockMatchRepository()
				const { service } = makeService({ matchRepository })
				setupRankedMatch('f2', 'FRFT2')

				await service.autoForfeitMatch('f2', 'rhost', [])

				expect(matchRepository.applyRatingTransaction).not.toHaveBeenCalled()
				expect(matchRepository.updateMatchStatus).toHaveBeenCalledWith('f2', 'resolved')
				expect(replayLogService.finalizeRun).toHaveBeenCalledWith('FRFT2', 'abandoned')
				expect(matches.has('f2')).toBe(false)
				expect(matchByLobby.has('FRFT2')).toBe(false)
			})
		})

		describe('forfeitMatchForBan (§21.3)', () => {
			function setupCasualMatch(matchId: string, code: string, hostId = 'chost', guestId = 'cguest') {
				const host = makeSession(hostId, 'Alice')
				const guest = makeSession(guestId, 'Bob')
				host.lobbyCode = code
				guest.lobbyCode = code
				const lobby = new Lobby(code, 'mod1', hostId, 16, 'public')
				lobby.players.set(hostId, host)
				lobby.players.set(guestId, guest)
				lobbies.set(code, lobby)
				const match = {
					matchId,
					lobbyCode: code,
					modId: 'mod1',
					gameMode: 'mode1',
					playerIds: [hostId, guestId],
					createdAt: new Date(),
				}
				matches.set(matchId, match)
				matchByLobby.set(code, match)
				return { host, guest }
			}

			it('forfeits a ranked match instantly, placing the banned player last', async () => {
				const matchRepository = makeMockMatchRepository()
				vi.mocked(matchRepository.getCurrentSeason).mockResolvedValue({ id: 1, name: 'Season 1' })
				vi.mocked(matchRepository.applyRatingTransaction).mockResolvedValue([
					{ playerId: 'rhost', newRating: 620, delta: 20, isPlacement: false, gamesPlayed: 11 },
					{ playerId: 'rguest', newRating: 580, delta: -20, isPlacement: false, gamesPlayed: 11 },
				])
				const { service } = makeService({ matchRepository })
				const { guest } = setupRankedMatch('fb1', 'BANFRFT1')
				guest.lobbyCode = 'BANFRFT1'

				const kicked = await service.forfeitMatchForBan('rguest', 'account')

				expect(kicked).toBe(true)
				expect(matchRepository.applyRatingTransaction).toHaveBeenCalledWith(
					'fb1',
					expect.anything(),
					1,
					[
						{ playerId: 'rhost', place: 1 },
						{ playerId: 'rguest', place: 2 },
					],
				)
				expect(matches.has('fb1')).toBe(false)
				expect(matchByLobby.has('BANFRFT1')).toBe(false)
				expect(mqttService.publishToPlayer).toHaveBeenCalledWith(
					'rhost',
					'matchmaking',
					expect.objectContaining({ type: 'match_resolved', reason: 'ban', bannedPlayerId: 'rguest', banType: 'account' }),
				)
			})

			it('forfeits a casual match instantly, closing the pre-existing no-forfeit-path gap', async () => {
				const matchRepository = makeMockMatchRepository()
				const { service } = makeService({ matchRepository })
				setupCasualMatch('fb2', 'BANFRFT2')

				const kicked = await service.forfeitMatchForBan('cguest', 'queue')

				expect(kicked).toBe(true)
				expect(matchRepository.applyRatingTransaction).not.toHaveBeenCalled()
				expect(matchRepository.recordMatchResult).toHaveBeenCalledWith(
					'fb2',
					[
						{ playerId: 'chost', place: 1 },
						{ playerId: 'cguest', place: 2 },
					],
					'system',
				)
				expect(matchRepository.updateMatchStatus).toHaveBeenCalledWith('fb2', 'resolved')
				expect(matches.has('fb2')).toBe(false)
				expect(matchByLobby.has('BANFRFT2')).toBe(false)
				expect(mqttService.publishToPlayer).toHaveBeenCalledWith(
					'chost',
					'matchmaking',
					expect.objectContaining({ type: 'match_resolved', reason: 'ban', bannedPlayerId: 'cguest', banType: 'queue' }),
				)
			})

			it('dequeues a queue-banned player who is currently searching but not in a match', async () => {
				const { service } = makeService()
				const session = makeSession('searching1', 'Searcher')
				await service.joinQueue(session, { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
				expect(playerQueues.get('searching1')?.size).toBe(1)

				const kicked = await service.forfeitMatchForBan('searching1', 'queue')

				expect(kicked).toBe(false)
				expect(playerQueues.get('searching1')?.size ?? 0).toBe(0)
			})

			it('is a no-op for a banned player who is neither in a match nor queued', async () => {
				const matchRepository = makeMockMatchRepository()
				const { service } = makeService({ matchRepository })
				makeSession('idle1', 'Idle')

				const kicked = await service.forfeitMatchForBan('idle1', 'account')

				expect(kicked).toBe(false)
				expect(matchRepository.applyRatingTransaction).not.toHaveBeenCalled()
				expect(matchRepository.updateMatchStatus).not.toHaveBeenCalled()
			})
		})
	})
})

// ---- Decay & season rollover ----

function makeChain(rows: unknown[]) {
	const thenable = Object.assign(Promise.resolve(rows), {
		limit: vi.fn().mockResolvedValue(rows),
	})
	return { from: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue(thenable) }) }
}

describe('runDecay', () => {
	it('returns without any writes when there is no active season', async () => {
		;(db as any).select = vi.fn().mockReturnValue(makeChain([]))

		await runDecay()

		expect(db.update).not.toHaveBeenCalled()
	})

	it('returns without any writes when the leaderboard is empty', async () => {
		;(db as any).select = vi.fn().mockReturnValue(makeChain([{ id: 1, name: 'S1' }]))
		;(db as any).selectDistinct = vi.fn().mockReturnValue(makeChain([]))

		await runDecay()

		expect(db.update).not.toHaveBeenCalled()
	})

	it('decrements rating for a player inactive beyond the threshold', async () => {
		const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)
		const ratingRow = {
			playerId: 'p1',
			rating: 700,
			lastMatchAt: fifteenDaysAgo,
			updatedAt: fifteenDaysAgo,
			decayAppliedAt: null,
		}

		;(db as any).select = vi.fn()
			.mockReturnValueOnce(makeChain([{ id: 1, name: 'S1' }]))
			.mockReturnValueOnce(makeChain([{ playerId: 'p1' }]))
			.mockReturnValueOnce(makeChain([ratingRow]))
		;(db as any).selectDistinct = vi.fn().mockReturnValue(
			makeChain([{ modId: 'mod1', gameMode: 'ranked:1v1' }]),
		)
		;(db as any).transaction = vi.fn().mockResolvedValue(undefined)

		await runDecay()

		expect(db.update).toHaveBeenCalled()
		const setArg = vi.mocked(db.update).mock.results[0].value.set.mock.calls[0][0]
		expect(setArg.rating).toBe(660)
	})

	it('does not update a player inactive within the threshold', async () => {
		const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
		const ratingRow = {
			playerId: 'p1',
			rating: 700,
			lastMatchAt: threeDaysAgo,
			updatedAt: threeDaysAgo,
			decayAppliedAt: null,
		}

		;(db as any).select = vi.fn()
			.mockReturnValueOnce(makeChain([{ id: 1, name: 'S1' }]))
			.mockReturnValueOnce(makeChain([{ playerId: 'p1' }]))
			.mockReturnValueOnce(makeChain([ratingRow]))
		;(db as any).selectDistinct = vi.fn().mockReturnValue(
			makeChain([{ modId: 'mod1', gameMode: 'ranked:1v1' }]),
		)

		await runDecay()

		expect(db.update).not.toHaveBeenCalled()
	})

	it('clamps the decayed rating at the rating floor', async () => {
		const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000)
		const ratingRow = {
			playerId: 'p1',
			rating: 110,
			lastMatchAt: twentyDaysAgo,
			updatedAt: twentyDaysAgo,
			decayAppliedAt: null,
		}

		;(db as any).select = vi.fn()
			.mockReturnValueOnce(makeChain([{ id: 1, name: 'S1' }]))
			.mockReturnValueOnce(makeChain([{ playerId: 'p1' }]))
			.mockReturnValueOnce(makeChain([ratingRow]))
		;(db as any).selectDistinct = vi.fn().mockReturnValue(
			makeChain([{ modId: 'mod1', gameMode: 'ranked:1v1' }]),
		)
		;(db as any).transaction = vi.fn().mockResolvedValue(undefined)

		await runDecay()

		const setArg = vi.mocked(db.update).mock.results[0].value.set.mock.calls[0][0]
		expect(setArg.rating).toBe(100)
	})

	it('skips a player whose decay was already applied today', async () => {
		const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000)
		const ratingRow = {
			playerId: 'p1',
			rating: 700,
			lastMatchAt: twentyDaysAgo,
			updatedAt: twentyDaysAgo,
			decayAppliedAt: new Date(),
		}

		;(db as any).select = vi.fn()
			.mockReturnValueOnce(makeChain([{ id: 1, name: 'S1' }]))
			.mockReturnValueOnce(makeChain([{ playerId: 'p1' }]))
			.mockReturnValueOnce(makeChain([ratingRow]))
		;(db as any).selectDistinct = vi.fn().mockReturnValue(
			makeChain([{ modId: 'mod1', gameMode: 'ranked:1v1' }]),
		)

		await runDecay()

		expect(db.update).not.toHaveBeenCalled()
	})

	it('recomputes the leaderboard after applying decay', async () => {
		const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)
		const ratingRow = {
			playerId: 'p1',
			rating: 700,
			lastMatchAt: fifteenDaysAgo,
			updatedAt: fifteenDaysAgo,
			decayAppliedAt: null,
		}

		;(db as any).select = vi.fn()
			.mockReturnValueOnce(makeChain([{ id: 1, name: 'S1' }]))
			.mockReturnValueOnce(makeChain([{ playerId: 'p1' }]))
			.mockReturnValueOnce(makeChain([ratingRow]))
		;(db as any).selectDistinct = vi.fn().mockReturnValue(
			makeChain([{ modId: 'mod1', gameMode: 'ranked:1v1' }]),
		)
		;(db as any).transaction = vi.fn().mockResolvedValue(undefined)

		await runDecay()

		expect((db as any).transaction).toHaveBeenCalled()
	})
})

describe('checkSeasonRollover', () => {
	it('does nothing when no season has expired', async () => {
		;(db as any).select = vi.fn().mockReturnValue(makeChain([]))

		await checkSeasonRollover()

		expect(db.insert).not.toHaveBeenCalled()
		expect(db.update).not.toHaveBeenCalled()
	})

	it('creates a new season named Season N+1 for the expired season', async () => {
		const expiredSeason = {
			id: 1, name: 'Season 1',
			endsAt: new Date(Date.now() - 1000),
			endedAt: null,
			startedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
		}
		;(db as any).select = vi.fn().mockReturnValue(makeChain([expiredSeason]))

		const seasonValuesMock = vi.fn().mockReturnValue({
			returning: vi.fn().mockResolvedValue([{ id: 2 }]),
		})
		const tx = {
			select: vi.fn().mockReturnValue(makeChain([])),
			insert: vi.fn().mockReturnValue({ values: seasonValuesMock }),
			update: vi.fn().mockReturnValue({
				set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
			}),
		}
		;(db as any).transaction = vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx))

		await checkSeasonRollover()

		expect(seasonValuesMock).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'Season 2' }),
		)
	})

	it('marks the expired season as ended', async () => {
		const expiredSeason = {
			id: 3, name: 'Season 3',
			endsAt: new Date(Date.now() - 1000),
			endedAt: null,
			startedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
		}
		;(db as any).select = vi.fn().mockReturnValue(makeChain([expiredSeason]))

		const tx = {
			select: vi.fn().mockReturnValue(makeChain([])),
			insert: vi.fn().mockReturnValue({
				values: vi.fn().mockReturnValue({
					returning: vi.fn().mockResolvedValue([{ id: 4 }]),
				}),
			}),
			update: vi.fn().mockReturnValue({
				set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
			}),
		}
		;(db as any).transaction = vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx))

		await checkSeasonRollover()

		expect(tx.update).toHaveBeenCalled()
		const setArg = (tx.update as any).mock.results[0].value.set.mock.calls[0][0]
		expect(setArg).toHaveProperty('endedAt')
		expect(setArg.endedAt).toBeInstanceOf(Date)
	})

	it('carries established players into the new season with a soft-reset rating', async () => {
		const expiredSeason = {
			id: 5, name: 'Season 5',
			endsAt: new Date(Date.now() - 1000),
			endedAt: null,
			startedAt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
		}
		const establishedRating = {
			playerId: 'p1', modId: 'mod1', gameMode: 'ranked:1v1', season: 5,
			rating: 1500, gamesPlayed: 10, wins: 7, losses: 3,
		}
		;(db as any).select = vi.fn().mockReturnValue(makeChain([expiredSeason]))

		const seasonValuesMock = vi.fn().mockReturnValue({
			returning: vi.fn().mockResolvedValue([{ id: 6 }]),
		})
		const ratingValuesMock = vi.fn().mockResolvedValue(undefined)
		let insertCount = 0
		const tx = {
			select: vi.fn().mockReturnValue(makeChain([establishedRating])),
			insert: vi.fn().mockImplementation(() => {
				insertCount++
				return { values: insertCount === 1 ? seasonValuesMock : ratingValuesMock }
			}),
			update: vi.fn().mockReturnValue({
				set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
			}),
		}
		;(db as any).transaction = vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx))

		await checkSeasonRollover()

		expect(ratingValuesMock).toHaveBeenCalledWith(
			expect.objectContaining({
				playerId: 'p1',
				season: 6,
				wins: 0,
				losses: 0,
				gamesPlayed: 0,
			}),
		)
		const ratingArg = (ratingValuesMock.mock.calls[0][0] as any).rating
		expect(ratingArg).toBeLessThan(1500)
		expect(ratingArg).toBeGreaterThanOrEqual(600)
	})

	it('skips placement players when carrying ratings to the new season', async () => {
		const expiredSeason = {
			id: 7, name: 'Season 7',
			endsAt: new Date(Date.now() - 1000),
			endedAt: null,
			startedAt: new Date(),
		}
		const placementRating = {
			playerId: 'p2', modId: 'mod1', gameMode: 'ranked:1v1', season: 7,
			rating: 700, gamesPlayed: 2, wins: 2, losses: 0,
		}
		;(db as any).select = vi.fn().mockReturnValue(makeChain([expiredSeason]))

		let insertCount = 0
		const tx = {
			select: vi.fn().mockReturnValue(makeChain([placementRating])),
			insert: vi.fn().mockImplementation(() => {
				insertCount++
				return {
					values: vi.fn().mockReturnValue({
						returning: vi.fn().mockResolvedValue([{ id: 8 }]),
					}),
				}
			}),
			update: vi.fn().mockReturnValue({
				set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
			}),
		}
		;(db as any).transaction = vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) => cb(tx))

		await checkSeasonRollover()

		expect(insertCount).toBe(1)
	})
})
