import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createTestApp } from './app.js'
import { signJwt } from '../../services/auth.service.js'
import { createSession } from '../../state/index.js'
import { getLeaderboard, getOwnRating } from '../../services/matchmaking.service.js'

vi.mock('../../services/matchmaking.service.js', () => ({
	joinQueue: vi.fn(),
	leaveQueue: vi.fn(),
	leaveAllQueues: vi.fn(),
	getQueueStatus: vi.fn().mockReturnValue([]),
	reportResult: vi.fn(),
	getLeaderboard: vi.fn(),
	getOwnRating: vi.fn(),
	updateGroupQueueOnLobbyJoin: vi.fn(),
	removeGroupQueueForLobby: vi.fn(),
	runCasualQueue: vi.fn(),
	runRankedQueue: vi.fn(),
	runMatchmakingCycle: vi.fn(),
	startMatchmaking: vi.fn(),
	stopMatchmaking: vi.fn(),
	syncMatchLobbyState: vi.fn(),
	restoreMatchesFromDb: vi.fn(),
	restorePlayerMatchSession: vi.fn(),
	runDecay: vi.fn(),
	checkSeasonRollover: vi.fn(),
	startDailyJob: vi.fn(),
	stopDailyJob: vi.fn(),
}))

const app = createTestApp()

function authHeader(playerId: string, steamName: string) {
	createSession(steamName, { id: playerId })
	return `Bearer ${signJwt({ playerId, steamName })}`
}

describe('GET /api/matchmaking/ratings', () => {
	beforeEach(() => {
		vi.mocked(getOwnRating).mockReset()
	})

	it('returns 401 without auth', async () => {
		const res = await request(app)
			.get('/api/matchmaking/ratings')
			.query({ modId: 'speedrunning', gameMode: 'ranked:1v1', season: '1' })
		expect(res.status).toBe(401)
	})

	it('returns 400 when modId is missing', async () => {
		const res = await request(app)
			.get('/api/matchmaking/ratings')
			.set('Authorization', authHeader('p1', 'Alice'))
			.query({ gameMode: 'ranked:1v1', season: '1' })
		expect(res.status).toBe(400)
	})

	it('returns 400 when gameMode is missing', async () => {
		const res = await request(app)
			.get('/api/matchmaking/ratings')
			.set('Authorization', authHeader('p1', 'Alice'))
			.query({ modId: 'speedrunning', season: '1' })
		expect(res.status).toBe(400)
	})

	it('returns 400 when season is missing', async () => {
		const res = await request(app)
			.get('/api/matchmaking/ratings')
			.set('Authorization', authHeader('p1', 'Alice'))
			.query({ modId: 'speedrunning', gameMode: 'ranked:1v1' })
		expect(res.status).toBe(400)
	})

	it('returns 400 for non-numeric season', async () => {
		const res = await request(app)
			.get('/api/matchmaking/ratings')
			.set('Authorization', authHeader('p1', 'Alice'))
			.query({ modId: 'speedrunning', gameMode: 'ranked:1v1', season: 'current' })
		expect(res.status).toBe(400)
	})

	it('returns null when player has no rating record', async () => {
		vi.mocked(getOwnRating).mockResolvedValueOnce(null)
		const res = await request(app)
			.get('/api/matchmaking/ratings')
			.set('Authorization', authHeader('p1', 'Alice'))
			.query({ modId: 'speedrunning', gameMode: 'ranked:1v1', season: '1' })
		expect(res.status).toBe(200)
		expect(res.body).toBeNull()
	})

	it('returns placement data with hidden rating', async () => {
		vi.mocked(getOwnRating).mockResolvedValueOnce({
			rating: null,
			wins: 1,
			losses: 1,
			gamesPlayed: 2,
			isPlacement: true,
			placementGamesLeft: 3,
		})
		const res = await request(app)
			.get('/api/matchmaking/ratings')
			.set('Authorization', authHeader('p2', 'Bob'))
			.query({ modId: 'speedrunning', gameMode: 'ranked:1v1', season: '1' })
		expect(res.status).toBe(200)
		expect(res.body).toMatchObject({
			rating: null,
			wins: 1,
			losses: 1,
			gamesPlayed: 2,
			isPlacement: true,
			placementGamesLeft: 3,
		})
	})

	it('returns visible rating for established player', async () => {
		vi.mocked(getOwnRating).mockResolvedValueOnce({
			rating: 1250,
			wins: 8,
			losses: 3,
			gamesPlayed: 11,
			isPlacement: false,
			placementGamesLeft: 0,
		})
		const res = await request(app)
			.get('/api/matchmaking/ratings')
			.set('Authorization', authHeader('p3', 'Carol'))
			.query({ modId: 'speedrunning', gameMode: 'ranked:1v1', season: '1' })
		expect(res.status).toBe(200)
		expect(res.body.rating).toBe(1250)
		expect(res.body.isPlacement).toBe(false)
		expect(res.body.placementGamesLeft).toBe(0)
	})

	it('forwards correct params to getOwnRating service', async () => {
		vi.mocked(getOwnRating).mockResolvedValueOnce(null)
		createSession('Dave', { id: 'param-check' })
		await request(app)
			.get('/api/matchmaking/ratings')
			.set('Authorization', `Bearer ${signJwt({ playerId: 'param-check', steamName: 'Dave' })}`)
			.query({ modId: 'speedrunning', gameMode: 'ranked:1v1', season: '3' })
		expect(vi.mocked(getOwnRating)).toHaveBeenCalledWith('param-check', 'speedrunning', 'ranked:1v1', 3)
	})
})

describe('GET /api/matchmaking/leaderboard', () => {
	beforeEach(() => {
		vi.mocked(getLeaderboard).mockReset()
	})

	it('returns 401 without auth', async () => {
		const res = await request(app)
			.get('/api/matchmaking/leaderboard')
			.query({ modId: 'speedrunning', gameMode: 'ranked:1v1', season: '1' })
		expect(res.status).toBe(401)
	})

	it('returns 400 when modId is missing', async () => {
		const res = await request(app)
			.get('/api/matchmaking/leaderboard')
			.set('Authorization', authHeader('p1', 'Alice'))
			.query({ gameMode: 'ranked:1v1', season: '1' })
		expect(res.status).toBe(400)
	})

	it('returns 400 when gameMode is missing', async () => {
		const res = await request(app)
			.get('/api/matchmaking/leaderboard')
			.set('Authorization', authHeader('p1', 'Alice'))
			.query({ modId: 'speedrunning', season: '1' })
		expect(res.status).toBe(400)
	})

	it('returns 400 when season is missing', async () => {
		const res = await request(app)
			.get('/api/matchmaking/leaderboard')
			.set('Authorization', authHeader('p1', 'Alice'))
			.query({ modId: 'speedrunning', gameMode: 'ranked:1v1' })
		expect(res.status).toBe(400)
	})

	it('returns 400 for non-numeric season', async () => {
		const res = await request(app)
			.get('/api/matchmaking/leaderboard')
			.set('Authorization', authHeader('p1', 'Alice'))
			.query({ modId: 'speedrunning', gameMode: 'ranked:1v1', season: 'latest' })
		expect(res.status).toBe(400)
	})

	it('returns empty leaderboard with null playerEntry', async () => {
		vi.mocked(getLeaderboard).mockResolvedValueOnce({
			season: 1,
			modId: 'speedrunning',
			gameMode: 'ranked:1v1',
			entries: [],
			playerEntry: null,
		})
		const res = await request(app)
			.get('/api/matchmaking/leaderboard')
			.set('Authorization', authHeader('p1', 'Alice'))
			.query({ modId: 'speedrunning', gameMode: 'ranked:1v1', season: '1' })
		expect(res.status).toBe(200)
		expect(res.body.entries).toHaveLength(0)
		expect(res.body.playerEntry).toBeNull()
	})

	it('returns entries in rank order', async () => {
		vi.mocked(getLeaderboard).mockResolvedValueOnce({
			season: 1,
			modId: 'speedrunning',
			gameMode: 'ranked:1v1',
			entries: [
				{ rank: 1, playerId: 'top', displayName: 'Alice', rating: 1800, wins: 20, losses: 3 },
				{ rank: 2, playerId: 'mid', displayName: 'Bob', rating: 1400, wins: 10, losses: 5 },
			],
			playerEntry: { rank: 1, rating: 1800, wins: 20, losses: 3 },
		})
		const res = await request(app)
			.get('/api/matchmaking/leaderboard')
			.set('Authorization', authHeader('top', 'Alice'))
			.query({ modId: 'speedrunning', gameMode: 'ranked:1v1', season: '1' })
		expect(res.status).toBe(200)
		expect(res.body.entries).toHaveLength(2)
		expect(res.body.entries[0].rank).toBe(1)
		expect(res.body.entries[1].rank).toBe(2)
		expect(res.body.playerEntry).toMatchObject({ rank: 1, rating: 1800 })
	})

	it('includes playerEntry for player outside top 100', async () => {
		vi.mocked(getLeaderboard).mockResolvedValueOnce({
			season: 1,
			modId: 'speedrunning',
			gameMode: 'ranked:1v1',
			entries: [
				{ rank: 1, playerId: 'top', displayName: 'Alice', rating: 1800, wins: 20, losses: 3 },
			],
			playerEntry: { rank: 142, rating: 900, wins: 3, losses: 7 },
		})
		const res = await request(app)
			.get('/api/matchmaking/leaderboard')
			.set('Authorization', authHeader('other', 'Dave'))
			.query({ modId: 'speedrunning', gameMode: 'ranked:1v1', season: '1' })
		expect(res.status).toBe(200)
		expect(res.body.playerEntry.rank).toBe(142)
		expect(res.body.entries).toHaveLength(1)
	})

	it('forwards correct params to getLeaderboard service', async () => {
		vi.mocked(getLeaderboard).mockResolvedValueOnce({
			season: 3,
			modId: 'speedrunning',
			gameMode: 'ranked:1v1',
			entries: [],
			playerEntry: null,
		})
		createSession('Eve', { id: 'lb-param-check' })
		await request(app)
			.get('/api/matchmaking/leaderboard')
			.set('Authorization', `Bearer ${signJwt({ playerId: 'lb-param-check', steamName: 'Eve' })}`)
			.query({ modId: 'speedrunning', gameMode: 'ranked:1v1', season: '3' })
		expect(vi.mocked(getLeaderboard)).toHaveBeenCalledWith(
			'speedrunning',
			'ranked:1v1',
			3,
			'lb-param-check',
		)
	})

	it('returns season, modId, and gameMode in response body', async () => {
		vi.mocked(getLeaderboard).mockResolvedValueOnce({
			season: 2,
			modId: 'speedrunning',
			gameMode: 'ranked:1v1',
			entries: [],
			playerEntry: null,
		})
		const res = await request(app)
			.get('/api/matchmaking/leaderboard')
			.set('Authorization', authHeader('p1', 'Alice'))
			.query({ modId: 'speedrunning', gameMode: 'ranked:1v1', season: '2' })
		expect(res.status).toBe(200)
		expect(res.body.season).toBe(2)
		expect(res.body.modId).toBe('speedrunning')
		expect(res.body.gameMode).toBe('ranked:1v1')
	})
})
