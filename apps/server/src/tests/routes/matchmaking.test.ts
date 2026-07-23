import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createTestApp } from './app.js'
import { signJwt } from '../../features/auth/jwt.js'
import { createSession } from '../../state/index.js'
import { matches, matchByLobby, queues, playerQueues } from '../../state/matchmaking.js'
import { Lobby } from '../../state/lobby.js'
import { lobbies } from '../../state/index.js'
import { db } from '../../infrastructure/db/index.js'
import type { Match } from '../../shared/types/index.js'

const app = createTestApp()

// reportResult() falls back to a db.select (getResolvedMatchResult) when the
// match is no longer in the in-memory map -- the base mock in tests/setup.ts
// has no .select stub, so give it a default here (no resolved result, i.e.
// the match genuinely doesn't exist). Mirrors report.test.ts's pattern.
beforeEach(() => {
	;(db as any).select = vi.fn().mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockReturnValue({
				limit: vi.fn().mockResolvedValue([]),
			}),
		}),
	})
})

function authHeader(playerId: string, steamName: string, lobbyCode?: string) {
	createSession(steamName, { id: playerId })
	const token = signJwt({ playerId, steamName, lobbyCode })
	return `Bearer ${token}`
}

function makeMatch(
	matchId: string,
	lobbyCode: string,
	hostId: string,
	playerIds: string[],
	gameMode = 'mode1',
): Match {
	const lobby = new Lobby(lobbyCode, 'mod1', hostId, 16, 'public')
	lobbies.set(lobbyCode, lobby)

	const match: Match = {
		matchId,
		lobbyCode,
		modId: 'mod1',
		gameMode,
		playerIds,
		createdAt: new Date(),
	}
	matches.set(matchId, match)
	matchByLobby.set(lobbyCode, match)
	return match
}

describe('matchmaking routes', () => {
	describe('POST /api/matchmaking/queue', () => {
		it('returns 401 without auth', async () => {
			const res = await request(app)
				.post('/api/matchmaking/queue')
				.send({ modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			expect(res.status).toBe(401)
		})

		it('returns 400 when modId is missing', async () => {
			const res = await request(app)
				.post('/api/matchmaking/queue')
				.set('Authorization', authHeader('p1', 'Alice'))
				.send({ gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			expect(res.status).toBe(400)
		})

		it('returns 400 when gameMode is missing', async () => {
			const res = await request(app)
				.post('/api/matchmaking/queue')
				.set('Authorization', authHeader('p1', 'Alice'))
				.send({ modId: 'mod1', minPlayers: 2, maxPlayers: 4 })
			expect(res.status).toBe(400)
		})

		it('returns 400 when minPlayers is less than 2', async () => {
			const res = await request(app)
				.post('/api/matchmaking/queue')
				.set('Authorization', authHeader('p1', 'Alice'))
				.send({ modId: 'mod1', gameMode: 'mode1', minPlayers: 1, maxPlayers: 4 })
			expect(res.status).toBe(400)
		})

		it('returns 400 when maxPlayers is less than minPlayers', async () => {
			const res = await request(app)
				.post('/api/matchmaking/queue')
				.set('Authorization', authHeader('p1', 'Alice'))
				.send({ modId: 'mod1', gameMode: 'mode1', minPlayers: 4, maxPlayers: 2 })
			expect(res.status).toBe(400)
		})

		it('returns 400 when minPlayers is not an integer', async () => {
			const res = await request(app)
				.post('/api/matchmaking/queue')
				.set('Authorization', authHeader('p1', 'Alice'))
				.send({ modId: 'mod1', gameMode: 'mode1', minPlayers: 2.5, maxPlayers: 4 })
			expect(res.status).toBe(400)
		})

		it('returns 200 and queue position on success', async () => {
			const res = await request(app)
				.post('/api/matchmaking/queue')
				.set('Authorization', authHeader('p1', 'Alice'))
				.send({ modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			expect(res.status).toBe(200)
			expect(res.body.position).toBe(1)
		})

		it('returns 409 when already queued for this mode', async () => {
			const auth = authHeader('p1', 'Alice')
			await request(app)
				.post('/api/matchmaking/queue')
				.set('Authorization', auth)
				.send({ modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })

			const res = await request(app)
				.post('/api/matchmaking/queue')
				.set('Authorization', auth)
				.send({ modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			expect(res.status).toBe(409)
		})

		it('returns position reflecting all queued players', async () => {
			await request(app)
				.post('/api/matchmaking/queue')
				.set('Authorization', authHeader('p1', 'Alice'))
				.send({ modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })

			const res = await request(app)
				.post('/api/matchmaking/queue')
				.set('Authorization', authHeader('p2', 'Bob'))
				.send({ modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })

			expect(res.status).toBe(200)
			expect(res.body.position).toBe(2)
		})
	})

	describe('DELETE /api/matchmaking/queue', () => {
		it('returns 401 without auth', async () => {
			const res = await request(app)
				.delete('/api/matchmaking/queue')
				.send({ modId: 'mod1', gameMode: 'mode1' })
			expect(res.status).toBe(401)
		})

		it('returns 400 when modId is missing', async () => {
			const res = await request(app)
				.delete('/api/matchmaking/queue')
				.set('Authorization', authHeader('p1', 'Alice'))
				.send({ gameMode: 'mode1' })
			expect(res.status).toBe(400)
		})

		it('returns 400 when gameMode is missing', async () => {
			const res = await request(app)
				.delete('/api/matchmaking/queue')
				.set('Authorization', authHeader('p1', 'Alice'))
				.send({ modId: 'mod1' })
			expect(res.status).toBe(400)
		})

		it('returns 204 and removes player from queue', async () => {
			const auth = authHeader('p1', 'Alice')
			await request(app)
				.post('/api/matchmaking/queue')
				.set('Authorization', auth)
				.send({ modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })

			const res = await request(app)
				.delete('/api/matchmaking/queue')
				.set('Authorization', auth)
				.send({ modId: 'mod1', gameMode: 'mode1' })

			expect(res.status).toBe(204)
			expect(playerQueues.has('p1')).toBe(false)
		})

		it('returns 204 idempotently when not in queue', async () => {
			const res = await request(app)
				.delete('/api/matchmaking/queue')
				.set('Authorization', authHeader('p1', 'Alice'))
				.send({ modId: 'mod1', gameMode: 'mode1' })
			expect(res.status).toBe(204)
		})
	})

	describe('DELETE /api/matchmaking/queue/all', () => {
		it('returns 401 without auth', async () => {
			const res = await request(app).delete('/api/matchmaking/queue/all')
			expect(res.status).toBe(401)
		})

		it('returns 204 and removes all queues for player', async () => {
			const auth = authHeader('p1', 'Alice')
			await request(app)
				.post('/api/matchmaking/queue')
				.set('Authorization', auth)
				.send({ modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			await request(app)
				.post('/api/matchmaking/queue')
				.set('Authorization', auth)
				.send({ modId: 'mod1', gameMode: 'mode2', minPlayers: 2, maxPlayers: 4 })

			const res = await request(app)
				.delete('/api/matchmaking/queue/all')
				.set('Authorization', auth)

			expect(res.status).toBe(204)
			expect(playerQueues.has('p1')).toBe(false)
			expect(queues.size).toBe(0)
		})

		it('returns 204 idempotently when not in any queue', async () => {
			const res = await request(app)
				.delete('/api/matchmaking/queue/all')
				.set('Authorization', authHeader('p1', 'Alice'))
			expect(res.status).toBe(204)
		})
	})

	describe('GET /api/matchmaking/queue', () => {
		it('returns 401 without auth', async () => {
			const res = await request(app).get('/api/matchmaking/queue')
			expect(res.status).toBe(401)
		})

		it('returns empty entries when not queued', async () => {
			const res = await request(app)
				.get('/api/matchmaking/queue')
				.set('Authorization', authHeader('p1', 'Alice'))
			expect(res.status).toBe(200)
			expect(res.body.entries).toEqual([])
		})

		it('returns queue entries when queued', async () => {
			const auth = authHeader('p1', 'Alice')
			await request(app)
				.post('/api/matchmaking/queue')
				.set('Authorization', auth)
				.send({ modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })

			const res = await request(app)
				.get('/api/matchmaking/queue')
				.set('Authorization', auth)

			expect(res.status).toBe(200)
			expect(res.body.entries).toHaveLength(1)
			expect(res.body.entries[0]).toMatchObject({
				type: 'solo',
				playerId: 'p1',
				modId: 'mod1',
				gameMode: 'mode1',
			})
		})

		it('returns all entries when queued in multiple modes', async () => {
			const auth = authHeader('p1', 'Alice')
			await request(app)
				.post('/api/matchmaking/queue')
				.set('Authorization', auth)
				.send({ modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 })
			await request(app)
				.post('/api/matchmaking/queue')
				.set('Authorization', auth)
				.send({ modId: 'mod1', gameMode: 'mode2', minPlayers: 2, maxPlayers: 4 })

			const res = await request(app)
				.get('/api/matchmaking/queue')
				.set('Authorization', auth)

			expect(res.status).toBe(200)
			expect(res.body.entries).toHaveLength(2)
		})
	})

	describe('POST /api/matchmaking/matches/:matchId/result', () => {
		it('returns 401 without auth', async () => {
			const res = await request(app)
				.post('/api/matchmaking/matches/some-match/result')
				.send({ placements: [{ playerId: 'p1', place: 1 }, { playerId: 'p2', place: 2 }] })
			expect(res.status).toBe(401)
		})

		it('returns 400 when placements has fewer than 2 entries', async () => {
			makeMatch('m1', 'LOBBY1', 'p1', ['p1', 'p2'])
			const res = await request(app)
				.post('/api/matchmaking/matches/m1/result')
				.set('Authorization', authHeader('p1', 'Alice'))
				.send({ placements: [{ playerId: 'p1', place: 1 }] })
			expect(res.status).toBe(400)
		})

		it('returns 400 when placements is missing', async () => {
			makeMatch('m2', 'LOBBY2', 'p1', ['p1', 'p2'])
			const res = await request(app)
				.post('/api/matchmaking/matches/m2/result')
				.set('Authorization', authHeader('p1', 'Alice'))
				.send({})
			expect(res.status).toBe(400)
		})

		it('returns 400 when place is invalid (< 1)', async () => {
			makeMatch('m3', 'LOBBY3', 'p1', ['p1', 'p2'])
			const res = await request(app)
				.post('/api/matchmaking/matches/m3/result')
				.set('Authorization', authHeader('p1', 'Alice'))
				.send({ placements: [{ playerId: 'p1', place: 0 }, { playerId: 'p2', place: 2 }] })
			expect(res.status).toBe(400)
		})

		it('returns 400 when performance is out of range (> 1.0)', async () => {
			makeMatch('m4', 'LOBBY4', 'p1', ['p1', 'p2'])
			const res = await request(app)
				.post('/api/matchmaking/matches/m4/result')
				.set('Authorization', authHeader('p1', 'Alice'))
				.send({
					placements: [
						{ playerId: 'p1', place: 1, performance: 1.5 },
						{ playerId: 'p2', place: 2 },
					],
				})
			expect(res.status).toBe(400)
		})

		it('returns 404 when match does not exist', async () => {
			const res = await request(app)
				.post('/api/matchmaking/matches/nonexistent/result')
				.set('Authorization', authHeader('p1', 'Alice'))
				.send({ placements: [{ playerId: 'p1', place: 1 }, { playerId: 'p2', place: 2 }] })
			expect(res.status).toBe(404)
		})

		it('§11.6: allows a non-host participant to report the result', async () => {
			makeMatch('m5', 'LOBBY5', 'p1', ['p1', 'p2'])
			const res = await request(app)
				.post('/api/matchmaking/matches/m5/result')
				.set('Authorization', authHeader('p2', 'Bob'))
				.send({ placements: [{ playerId: 'p1', place: 1 }, { playerId: 'p2', place: 2 }] })
			expect(res.status).toBe(204)
		})

		it('returns 403 when caller was not a participant in the match', async () => {
			makeMatch('m5b', 'LOBBY5B', 'p1', ['p1', 'p2'])
			const res = await request(app)
				.post('/api/matchmaking/matches/m5b/result')
				.set('Authorization', authHeader('p3', 'Carol'))
				.send({ placements: [{ playerId: 'p1', place: 1 }, { playerId: 'p2', place: 2 }] })
			expect(res.status).toBe(403)
		})

		it('returns 204 and cleans up casual match state', async () => {
			makeMatch('m6', 'LOBBY6', 'p1', ['p1', 'p2'], 'mode1')
			const res = await request(app)
				.post('/api/matchmaking/matches/m6/result')
				.set('Authorization', authHeader('p1', 'Alice'))
				.send({ placements: [{ playerId: 'p1', place: 1 }, { playerId: 'p2', place: 2 }] })

			expect(res.status).toBe(204)
			expect(matches.has('m6')).toBe(false)
			expect(matchByLobby.has('LOBBY6')).toBe(false)
		})

		it('returns 400 when a placement metric is negative', async () => {
			makeMatch('m7', 'LOBBY7', 'p1', ['p1', 'p2'])
			const res = await request(app)
				.post('/api/matchmaking/matches/m7/result')
				.set('Authorization', authHeader('p1', 'Alice'))
				.send({
					placements: [
						{ playerId: 'p1', place: 1, metric: -5 },
						{ playerId: 'p2', place: 2 },
					],
				})
			expect(res.status).toBe(400)
		})

		it('returns 400 when a placement metric is not finite', async () => {
			makeMatch('m8', 'LOBBY8', 'p1', ['p1', 'p2'])
			const res = await request(app)
				.post('/api/matchmaking/matches/m8/result')
				.set('Authorization', authHeader('p1', 'Alice'))
				.send({
					placements: [
						{ playerId: 'p1', place: 1, metric: 'lots' },
						{ playerId: 'p2', place: 2 },
					],
				})
			expect(res.status).toBe(400)
		})
	})

	describe('POST /api/matchmaking/matches/:matchId/start', () => {
		it('returns 401 without auth', async () => {
			const res = await request(app).post('/api/matchmaking/matches/some-match/start')
			expect(res.status).toBe(401)
		})

		it('returns 404 when match does not exist', async () => {
			const res = await request(app)
				.post('/api/matchmaking/matches/nonexistent/start')
				.set('Authorization', authHeader('p1', 'Alice'))
			expect(res.status).toBe(404)
		})

		it('returns 403 when caller is not the match host', async () => {
			makeMatch('s1', 'START1', 'p1', ['p1', 'p2'])
			const res = await request(app)
				.post('/api/matchmaking/matches/s1/start')
				.set('Authorization', authHeader('p2', 'Bob'))
			expect(res.status).toBe(403)
		})

		it('returns 204 and stamps the in-memory start time for the host', async () => {
			const match = makeMatch('s2', 'START2', 'p1', ['p1', 'p2'])
			const res = await request(app)
				.post('/api/matchmaking/matches/s2/start')
				.set('Authorization', authHeader('p1', 'Alice'))
			expect(res.status).toBe(204)
			expect(match.gameStartedAt).toBeInstanceOf(Date)
		})

		it('keeps the first start time on repeated calls (idempotent)', async () => {
			const match = makeMatch('s3', 'START3', 'p1', ['p1', 'p2'])
			const auth = authHeader('p1', 'Alice')
			await request(app).post('/api/matchmaking/matches/s3/start').set('Authorization', auth)
			const first = match.gameStartedAt
			await request(app).post('/api/matchmaking/matches/s3/start').set('Authorization', auth)
			expect(match.gameStartedAt).toBe(first)
		})
	})
})
