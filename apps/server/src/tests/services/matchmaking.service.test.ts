import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mqttService } from '../../services/mqtt.service.js'
import { db } from '../../db/index.js'
import {
	checkSeasonRollover,
	getQueueStatus,
	joinQueue,
	leaveAllQueues,
	leaveQueue,
	removeGroupQueueForLobby,
	reportResult,
	runCasualQueue,
	runDecay,
	runMatchmakingCycle,
	runRankedQueue,
	updateGroupQueueOnLobbyJoin,
} from '../../services/matchmaking.service.js'
import { matches, matchByLobby, playerQueues, queues } from '../../state/matchmaking.js'
import { createSession, lobbies, sessions } from '../../state/index.js'
import { Lobby } from '../../state/lobby.js'
import type { SoloQueueEntry } from '../../types/index.js'

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

describe('matchmaking.service', () => {
	// setup.ts beforeEach clears lobbies, sessions, and matchmaking state globally

	describe('joinQueue', () => {
		it('adds a solo player and returns position 1', async () => {
			const session = makeSession('p1', 'Alice')
			const result = await joinQueue(session, {
				modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4,
			})
			expect(result.position).toBe(1)
			expect(playerQueues.get('p1')?.size).toBe(1)
		})

		it('returns correct position for subsequent players', async () => {
			await joinQueue(makeSession('p1', 'Alice'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			const result = await joinQueue(makeSession('p2', 'Bob'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			expect(result.position).toBe(2)
		})

		it('allows queuing for multiple modes simultaneously', async () => {
			const session = makeSession('p1', 'Alice')
			await joinQueue(session, { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			const result = await joinQueue(session, { modId: 'mod1', gameMode: 'mode2', minPlayers: 2, maxPlayers: 4 })
			expect(result.position).toBe(1)
			expect(playerQueues.get('p1')?.size).toBe(2)
		})

		it('throws 409 when already queued for the same mode', async () => {
			const session = makeSession('p1', 'Alice')
			await joinQueue(session, { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			await expect(
				joinQueue(session, { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 }),
			).rejects.toThrow('Already queued for this mode')
		})

		it('throws 409 when player is inside a matchmade (public) lobby', async () => {
			const lobby = new Lobby('PUBLO', 'mod1', 'p1', 16, 'public')
			lobbies.set('PUBLO', lobby)
			const session = makeSession('p1', 'Alice')
			session.lobbyCode = 'PUBLO'
			await expect(
				joinQueue(session, { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 }),
			).rejects.toThrow('Cannot queue while in a matchmade lobby')
		})

		it('throws 409 when min/max mismatches the existing queue for that mode', async () => {
			await joinQueue(makeSession('p1', 'Alice'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			await expect(
				joinQueue(makeSession('p2', 'Bob'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 8 }),
			).rejects.toThrow('minPlayers/maxPlayers must match')
		})

		it('throws 400 when minPlayers < 2', async () => {
			await expect(
				joinQueue(makeSession('p1', 'Alice'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 1, maxPlayers: 4 }),
			).rejects.toThrow('minPlayers must be at least 2')
		})

		it('throws 400 when maxPlayers < minPlayers', async () => {
			await expect(
				joinQueue(makeSession('p1', 'Alice'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 4, maxPlayers: 2 }),
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
				const { hostSession } = makeGroupLobby('PRIV1', 'host1', 'guest1')
				const result = await joinQueue(hostSession, {
					modId: 'mod1', gameMode: 'mode1', minPlayers: 3, maxPlayers: 6,
				})
				expect(result.position).toBe(2)
				expect(playerQueues.get('host1')?.size).toBe(1)
				expect(playerQueues.get('guest1')?.size).toBe(1)
			})

			it('throws 403 when non-host initiates group queue', async () => {
				const { guestSession } = makeGroupLobby('PRIV1', 'host1', 'guest1')
				await expect(
					joinQueue(guestSession, { modId: 'mod1', gameMode: 'mode1', minPlayers: 3, maxPlayers: 6 }),
				).rejects.toThrow('Only the lobby host can initiate group queue')
			})

			it('throws 400 when group size leaves no room for other players', async () => {
				const { hostSession } = makeGroupLobby('PRIV1', 'host1', 'guest1', 2)
				await expect(
					joinQueue(hostSession, { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 2 }),
				).rejects.toThrow('Group size must leave room')
			})
		})
	})

	describe('leaveQueue', () => {
		it('removes a solo player from the queue', async () => {
			await joinQueue(makeSession('p1', 'Alice'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			leaveQueue('p1', 'mod1', 'mode1')
			expect(playerQueues.has('p1')).toBe(false)
			expect(queues.has('mod1:mode1')).toBe(false)
		})

		it('is a no-op when player is not in the queue', () => {
			expect(() => leaveQueue('nobody', 'mod1', 'mode1')).not.toThrow()
		})

		it('removes the entire group entry and clears all members', async () => {
			const lobby = new Lobby('PRIV1', 'mod1', 'host1', 16, 'private')
			const host = makeSession('host1', 'Host')
			const guest = makeSession('guest1', 'Guest')
			host.lobbyCode = 'PRIV1'
			guest.lobbyCode = 'PRIV1'
			lobby.players.set('host1', host)
			lobby.players.set('guest1', guest)
			lobbies.set('PRIV1', lobby)
			await joinQueue(host, { modId: 'mod1', gameMode: 'mode1', minPlayers: 3, maxPlayers: 6 })

			leaveQueue('host1', 'mod1', 'mode1')

			expect(playerQueues.has('host1')).toBe(false)
			expect(playerQueues.has('guest1')).toBe(false)
			expect(queues.has('mod1:mode1')).toBe(false)
		})
	})

	describe('leaveAllQueues', () => {
		it('removes a player from every queue they are in', async () => {
			const session = makeSession('p1', 'Alice')
			await joinQueue(session, { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			await joinQueue(session, { modId: 'mod1', gameMode: 'mode2', minPlayers: 2, maxPlayers: 4 })

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
			const session = makeSession('p1', 'Alice')
			await joinQueue(session, { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			await joinQueue(session, { modId: 'mod1', gameMode: 'mode2', minPlayers: 2, maxPlayers: 4 })

			const status = getQueueStatus('p1')
			expect(status).toHaveLength(2)
			expect(status.map((e) => e.gameMode)).toEqual(expect.arrayContaining(['mode1', 'mode2']))
		})
	})

	describe('updateGroupQueueOnLobbyJoin', () => {
		async function queueGroup(code: string, hostId: string, guestId: string, maxPlayers: number) {
			const lobby = new Lobby(code, 'mod1', hostId, maxPlayers, 'private')
			const host = makeSession(hostId, 'Host')
			const guest = makeSession(guestId, 'Guest')
			host.lobbyCode = code
			guest.lobbyCode = code
			lobby.players.set(hostId, host)
			lobby.players.set(guestId, guest)
			lobbies.set(code, lobby)
			await joinQueue(host, { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers })
			return lobby
		}

		it('adds a newly joined player to the group entry', async () => {
			await queueGroup('PRIV1', 'host1', 'guest1', 8)
			makeSession('guest2', 'Charlie')

			await updateGroupQueueOnLobbyJoin('PRIV1', 'guest2')

			const entry = queues.get('mod1:mode1')![0] as any
			expect(entry.playerIds).toContain('guest2')
			expect(playerQueues.get('guest2')?.size).toBe(1)
		})

		it('does not add player when group would consume all slots', async () => {
			// 2 players already, maxPlayers=3 — adding 1 more leaves no room for outsiders
			await queueGroup('PRIV1', 'host1', 'guest1', 3)
			makeSession('guest2', 'Charlie')

			await updateGroupQueueOnLobbyJoin('PRIV1', 'guest2')

			const entry = queues.get('mod1:mode1')![0] as any
			expect(entry.playerIds).not.toContain('guest2')
		})

		it('is a no-op for a lobby that is not in the queue', async () => {
			await expect(updateGroupQueueOnLobbyJoin('ZZZZZ', 'p1')).resolves.not.toThrow()
		})
	})

	describe('removeGroupQueueForLobby', () => {
		it('removes the group entry and clears all member playerQueues entries', async () => {
			const lobby = new Lobby('PRIV1', 'mod1', 'host1', 16, 'private')
			const host = makeSession('host1', 'Host')
			const guest = makeSession('guest1', 'Guest')
			host.lobbyCode = 'PRIV1'
			guest.lobbyCode = 'PRIV1'
			lobby.players.set('host1', host)
			lobby.players.set('guest1', guest)
			lobbies.set('PRIV1', lobby)
			await joinQueue(host, { modId: 'mod1', gameMode: 'mode1', minPlayers: 3, maxPlayers: 6 })

			removeGroupQueueForLobby('PRIV1')

			expect(queues.has('mod1:mode1')).toBe(false)
			expect(playerQueues.has('host1')).toBe(false)
			expect(playerQueues.has('guest1')).toBe(false)
		})

		it('is a no-op for an unknown lobby code', () => {
			expect(() => removeGroupQueueForLobby('ZZZZZ')).not.toThrow()
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
			// 5 players, min=3, max=3: forms one match of 3, leaves 2 (< min)
			const entries = Array.from({ length: 5 }, (_, i) => makeSoloEntry(`p${i}`))
			const formed = runCasualQueue(entries, 3, 3)
			expect(formed).toHaveLength(1)
			expect(formed[0]).toHaveLength(3)
		})

		it('caps each match at maxPlayers', () => {
			// 6 players, min=2, max=3 → two matches of 3
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
				makeSoloEntry('p2', { rating: 700 }), // diff=100, spread=150
			]
			expect(runRankedQueue(entries, 2, 4)).toHaveLength(1)
		})

		it('does not match players outside the initial spread', () => {
			const entries = [
				makeSoloEntry('p1', { rating: 600 }),
				makeSoloEntry('p2', { rating: 900 }), // diff=300 > spread=150
			]
			expect(runRankedQueue(entries, 2, 4)).toHaveLength(0)
		})

		it('matches out-of-range players after wait time expands the spread', () => {
			const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000)
			const entries = [
				makeSoloEntry('p1', { rating: 600, queuedAt: fiveMinutesAgo }), // oldest
				makeSoloEntry('p2', { rating: 1000 }), // diff=400
			]
			// After 300s: spread = min(150 + floor(300/30)*50, 600) = 600 → 400 ≤ 600 → match
			expect(runRankedQueue(entries, 2, 4)).toHaveLength(1)
		})

		it('never exceeds RANKED_SPREAD_CAP regardless of wait time', () => {
			const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000)
			const entries = [
				makeSoloEntry('p1', { rating: 600, queuedAt: oneHourAgo }),
				makeSoloEntry('p2', { rating: 1300 }), // diff=700 > cap=600
			]
			expect(runRankedQueue(entries, 2, 4)).toHaveLength(0)
		})

		it('stops trying when the oldest anchor cannot be matched', () => {
			// p1 is the anchor (lowest rating, same queue time → first index)
			// p2 and p3 are in range of each other but not p1
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
			await joinQueue(makeSession('p1', 'Alice'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			await joinQueue(makeSession('p2', 'Bob'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })

			await runMatchmakingCycle()

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
			await joinQueue(makeSession('p1', 'Alice'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			await joinQueue(makeSession('p2', 'Bob'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })

			await runMatchmakingCycle()

			expect(mqttService.publishToPlayer).toHaveBeenCalledWith(
				'p1', 'matchmaking', expect.objectContaining({ type: 'match_found' }),
			)
			expect(mqttService.publishToPlayer).toHaveBeenCalledWith(
				'p2', 'matchmaking', expect.objectContaining({ type: 'match_found' }),
			)
		})

		it('does not match when queue has fewer than minPlayers', async () => {
			await joinQueue(makeSession('p1', 'Alice'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 3, maxPlayers: 4 })

			await runMatchmakingCycle()

			expect(matches.size).toBe(0)
			expect(queues.get('mod1:mode1')).toHaveLength(1)
		})

		it('forms separate matches for different gamemodes in one cycle', async () => {
			await joinQueue(makeSession('p1', 'Alice'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			await joinQueue(makeSession('p2', 'Bob'), { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			await joinQueue(makeSession('p3', 'Carol'), { modId: 'mod1', gameMode: 'mode2', minPlayers: 2, maxPlayers: 4 })
			await joinQueue(makeSession('p4', 'Dave'), { modId: 'mod1', gameMode: 'mode2', minPlayers: 2, maxPlayers: 4 })

			await runMatchmakingCycle()

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
			const { host } = setupCasualMatch('match-1', 'CODA1')
			await reportResult(host, 'match-1', [
				{ playerId: 'host1', place: 1 },
				{ playerId: 'guest1', place: 2 },
			])
			expect(matches.has('match-1')).toBe(false)
			expect(matchByLobby.has('CODA1')).toBe(false)
		})

		it('throws 404 when the match does not exist', async () => {
			const session = makeSession('p1', 'Alice')
			await expect(
				reportResult(session, 'nonexistent', [
					{ playerId: 'p1', place: 1 },
					{ playerId: 'p2', place: 2 },
				]),
			).rejects.toThrow('Match not found')
		})

		it('throws 403 when a non-host player reports', async () => {
			const { guest } = setupCasualMatch('match-2', 'CODA2')
			await expect(
				reportResult(guest, 'match-2', [
					{ playerId: 'host1', place: 1 },
					{ playerId: 'guest1', place: 2 },
				]),
			).rejects.toThrow('Only the match host can report results')
		})

		it('throws 404 when the lobby has been removed', async () => {
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
			// Deliberately do not add a lobby entry
			await expect(
				reportResult(host, 'orphan', [
					{ playerId: 'host1', place: 1 },
					{ playerId: 'guest1', place: 2 },
				]),
			).rejects.toThrow('Lobby not found')
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

		function makeTx(
			ratingRows: Array<{ rating: number; gamesPlayed: number; wins: number; losses: number }>,
		) {
			let callCount = 0
			return {
				select: vi.fn().mockReturnValue({
					from: vi.fn().mockReturnValue({
						where: vi.fn().mockReturnValue({
							limit: vi.fn().mockImplementation(() =>
								Promise.resolve(
									ratingRows[callCount] !== undefined
										? [{ ...ratingRows[callCount++], decayAppliedAt: null }]
										: [],
								),
							),
						}),
					}),
				}),
				insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
				update: vi.fn().mockReturnValue({
					set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
				}),
				delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
				execute: vi.fn().mockResolvedValue({ rows: [] }),
			}
		}

		beforeEach(() => {
			// getCurrentSeason() chains: db.select().from(seasons).where(...).limit(1)
			;(db as any).select = vi.fn().mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([{ id: 1, name: 'Season 1', endedAt: null }]),
					}),
				}),
			})
		})

		it('publishes match_resolved to both players', async () => {
			const { host } = setupRankedMatch('r1', 'RNKL1')
			;(db as any).transaction = vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) =>
				cb(
					makeTx([
						{ rating: 600, gamesPlayed: 10, wins: 5, losses: 5 },
						{ rating: 600, gamesPlayed: 10, wins: 5, losses: 5 },
					]),
				),
			)

			await reportResult(host, 'r1', [
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
			const { host } = setupRankedMatch('r2', 'RNKL2')
			;(db as any).transaction = vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) =>
				cb(
					makeTx([
						{ rating: 600, gamesPlayed: 10, wins: 5, losses: 5 },
						{ rating: 600, gamesPlayed: 10, wins: 5, losses: 5 },
					]),
				),
			)

			await reportResult(host, 'r2', [
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

		it('hides rating and delta during placement (gamesPlayed < PLACEMENT_GAMES after match)', async () => {
			const { host } = setupRankedMatch('r3', 'RNKL3')
			// 0 games played → after this match gamesPlayed = 1, still in placement
			;(db as any).transaction = vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) =>
				cb(
					makeTx([
						{ rating: 600, gamesPlayed: 0, wins: 0, losses: 0 },
						{ rating: 600, gamesPlayed: 0, wins: 0, losses: 0 },
					]),
				),
			)

			await reportResult(host, 'r3', [
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

		it('reveals rating and delta after completing placement (gamesPlayed >= PLACEMENT_GAMES)', async () => {
			const { host } = setupRankedMatch('r4', 'RNKL4')
			// 4 games played → after this match gamesPlayed = 5, exits placement
			;(db as any).transaction = vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) =>
				cb(
					makeTx([
						{ rating: 700, gamesPlayed: 4, wins: 3, losses: 1 },
						{ rating: 550, gamesPlayed: 4, wins: 1, losses: 3 },
					]),
				),
			)

			await reportResult(host, 'r4', [
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
			const { host } = setupRankedMatch('r5', 'RNKL5')
			;(db as any).transaction = vi.fn().mockImplementation(async (cb: (tx: unknown) => unknown) =>
				cb(
					makeTx([
						{ rating: 600, gamesPlayed: 10, wins: 5, losses: 5 },
						{ rating: 600, gamesPlayed: 10, wins: 5, losses: 5 },
					]),
				),
			)

			await reportResult(host, 'r5', [
				{ playerId: 'rhost', place: 1 },
				{ playerId: 'rguest', place: 2 },
			])

			expect(matches.has('r5')).toBe(false)
			expect(matchByLobby.has('RNKL5')).toBe(false)
		})

		it('throws No active season when seasons table is empty', async () => {
			const { host } = setupRankedMatch('r6', 'RNKL6')
			;(db as any).select = vi.fn().mockReturnValue({
				from: vi.fn().mockReturnValue({
					where: vi.fn().mockReturnValue({
						limit: vi.fn().mockResolvedValue([]), // no season
					}),
				}),
			})

			await expect(
				reportResult(host, 'r6', [
					{ playerId: 'rhost', place: 1 },
					{ playerId: 'rguest', place: 2 },
				]),
			).rejects.toThrow('No active season')
		})
	})
})

// ---- Decay & season rollover ----

// Returns a mock that handles both .where().limit() and plain await .where()
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
			.mockReturnValueOnce(makeChain([{ id: 1, name: 'S1' }])) // getCurrentSeason
			.mockReturnValueOnce(makeChain([{ playerId: 'p1' }]))    // top-100
			.mockReturnValueOnce(makeChain([ratingRow]))              // rating row
		;(db as any).selectDistinct = vi.fn().mockReturnValue(
			makeChain([{ modId: 'mod1', gameMode: 'ranked:1v1' }]),
		)
		;(db as any).transaction = vi.fn().mockResolvedValue(undefined)

		await runDecay()

		// inactiveDays=15, decayAmount=floor(15-7)*5=40, newRating=700-40=660
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
			rating: 110, // close to the floor of 100
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

		// decayAmount=65 would push rating to 45, floor clamps to 100
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
			decayAppliedAt: new Date(), // already ran today
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
		// Soft reset: 1500 → 1200 + (300 * 0.5) = 1350
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
			rating: 700, gamesPlayed: 2, wins: 2, losses: 0, // < PLACEMENT_GAMES
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

		// Only 1 insert: the new season row — placement player was not carried over
		expect(insertCount).toBe(1)
	})
})
