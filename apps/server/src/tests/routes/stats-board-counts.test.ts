import request from 'supertest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStatsTestApp } from './stats-app.js'

const boards = [
	{
		modId: 'MultiplayerPvP',
		gameMode: 'ranked:pvp_ranked_balanced',
		entries: 12,
	},
	{
		modId: 'MultiplayerPvP',
		gameMode: 'ranked:pvp_ranked_vanilla',
		entries: 40,
	},
	{
		modId: 'MultiplayerSPDRN',
		gameMode: 'ranked:spdrn_gold_stake_single',
		entries: 3,
	},
]

function appWithBoards() {
	const countBoardEntries = vi.fn(async () => ({ season: 7, boards }))
	const { app } = createStatsTestApp({
		statsRepository: {
			countTotals: vi.fn(async () => ({ matches: 0, players: 0 })),
			countBoardEntries,
		},
	})
	return { app, countBoardEntries }
}

const clock = Date.UTC(2026, 9, 27)
beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] })
	vi.setSystemTime(clock)
})
afterEach(() => {
	vi.useRealTimers()
})

describe('GET /api/stats/leaderboard-counts', () => {
	it('answers the entry count of each mod and game mode in the current season', async () => {
		const { app } = appWithBoards()

		const res = await request(app).get('/api/stats/leaderboard-counts')

		expect(res.status).toBe(200)
		expect(res.body).toEqual({
			season: 7,
			counts: {
				MultiplayerPvP: {
					'ranked:pvp_ranked_balanced': 12,
					'ranked:pvp_ranked_vanilla': 40,
				},
				MultiplayerSPDRN: { 'ranked:spdrn_gold_stake_single': 3 },
			},
		})
	})

	it('counts once per 10 minutes, not per request', async () => {
		const { app, countBoardEntries } = appWithBoards()

		await request(app).get('/api/stats/leaderboard-counts')
		vi.setSystemTime(clock + 9 * 60 * 1000)
		await request(app).get('/api/stats/leaderboard-counts')
		expect(countBoardEntries).toHaveBeenCalledTimes(1)

		vi.setSystemTime(clock + 10 * 60 * 1000)
		await request(app).get('/api/stats/leaderboard-counts')
		expect(countBoardEntries).toHaveBeenCalledTimes(2)
	})
})
