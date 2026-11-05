import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../infrastructure/gateways/rating.gateway.js', () => ({
	checkSeasonRollover: vi.fn(),
	listSeasonsToAnnounce: vi.fn(),
	listSeasonEndEntries: vi.fn(),
	markSeasonAnnounced: vi.fn(),
}))
vi.mock('../../infrastructure/nakama/season-sync.js', () => ({
	notifySeasonEndInNakama: vi.fn(),
}))
vi.mock('../../infrastructure/gateways/config.gateway.js', () => ({
	loadConfigFromDb: vi.fn().mockResolvedValue(undefined),
}))

import { rollSeasons } from '../../features/ratings/season.job.js'
import { seasonEndPlayers } from '../../features/ratings/season-end.js'
import { loadConfigFromDb } from '../../infrastructure/gateways/config.gateway.js'
import {
	checkSeasonRollover,
	listSeasonEndEntries,
	listSeasonsToAnnounce,
	markSeasonAnnounced,
} from '../../infrastructure/gateways/rating.gateway.js'
import { notifySeasonEndInNakama } from '../../infrastructure/nakama/season-sync.js'

const entry = (userId: string, modId: string, gameMode: string, place: number, rating: number) => ({
	nakamaUserId: userId,
	modId,
	gameMode,
	place,
	rating,
})

beforeEach(() => {
	vi.resetAllMocks()
	vi.mocked(loadConfigFromDb).mockResolvedValue(undefined)
	vi.mocked(listSeasonsToAnnounce).mockResolvedValue([])
})

describe('rollSeasons', () => {
	it('reloads the config, pushing the new season to Nakama, after a rollover', async () => {
		vi.mocked(checkSeasonRollover).mockResolvedValue(1)
		expect(await rollSeasons()).toBe(1)
		expect(loadConfigFromDb).toHaveBeenCalledOnce()
	})

	it('leaves the config alone when no season expired', async () => {
		vi.mocked(checkSeasonRollover).mockResolvedValue(0)
		expect(await rollSeasons()).toBe(0)
		expect(loadConfigFromDb).not.toHaveBeenCalled()
	})

	it('sends the leaderboard places to Nakama and marks the season told', async () => {
		vi.mocked(checkSeasonRollover).mockResolvedValue(1)
		vi.mocked(listSeasonsToAnnounce).mockResolvedValue([{ id: 4, name: 'Season 4' }])
		vi.mocked(listSeasonEndEntries).mockResolvedValue([
			entry('u1', 'MultiplayerPvP', 'ranked:pvp_ranked_vanilla', 37, 1520),
		])
		vi.mocked(notifySeasonEndInNakama).mockResolvedValue(true)
		await rollSeasons()
		expect(notifySeasonEndInNakama).toHaveBeenCalledWith(
			{ id: 4, name: 'Season 4' },
			[{ userId: 'u1', boards: [{ name: 'PvP Vanilla', place: 37, rating: 1520 }] }],
		)
		expect(markSeasonAnnounced).toHaveBeenCalledWith(4)
	})

	it('keeps the season for the next run when Nakama does not confirm', async () => {
		vi.mocked(checkSeasonRollover).mockResolvedValue(0)
		vi.mocked(listSeasonsToAnnounce).mockResolvedValue([
			{ id: 4, name: 'Season 4' },
			{ id: 5, name: 'Season 5' },
		])
		vi.mocked(listSeasonEndEntries).mockResolvedValue([
			entry('u1', 'MultiplayerPvP', 'ranked:pvp_ranked_vanilla', 1, 1600),
		])
		vi.mocked(notifySeasonEndInNakama).mockResolvedValue(false)
		await rollSeasons()
		expect(markSeasonAnnounced).not.toHaveBeenCalled()
		expect(notifySeasonEndInNakama).toHaveBeenCalledOnce()
	})

	it('marks a season with no ranked entries told without calling Nakama', async () => {
		vi.mocked(checkSeasonRollover).mockResolvedValue(0)
		vi.mocked(listSeasonsToAnnounce).mockResolvedValue([{ id: 4, name: 'Season 4' }])
		vi.mocked(listSeasonEndEntries).mockResolvedValue([])
		await rollSeasons()
		expect(notifySeasonEndInNakama).not.toHaveBeenCalled()
		expect(markSeasonAnnounced).toHaveBeenCalledWith(4)
	})
})

describe('seasonEndPlayers', () => {
	it('puts a player on two boards into one entry, named as the leaderboard names them', () => {
		const { players, unnamed } = seasonEndPlayers([
			entry('u1', 'MultiplayerPvP', 'ranked:pvp_ranked_balanced', 2, 1400.4),
			entry('u1', 'MultiplayerSPDRN', 'ranked:spdrn_gold_stake_single', 9, 1300),
			entry('u2', 'MultiplayerPvP', 'ranked:pvp_ranked_balanced', 1, 1500),
		])
		expect(unnamed).toEqual([])
		expect(players.find((p) => p.userId === 'u1')?.boards).toEqual([
			{ name: 'PvP Balanced', place: 2, rating: 1400 },
			{ name: 'Speedrun Gold Stake Single', place: 9, rating: 1300 },
		])
		expect(players).toHaveLength(2)
	})

	it('leaves out a board with no display name and reports it', () => {
		const { players, unnamed } = seasonEndPlayers([
			entry('u1', 'OtherMod', 'ranked:x', 1, 1500),
		])
		expect(players).toEqual([])
		expect(unnamed).toEqual(['OtherMod ranked:x'])
	})
})
