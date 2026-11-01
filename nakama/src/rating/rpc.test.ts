import { describe, expect, it } from 'vitest'
import { boardEntries, boardRankOf } from './rpc'

const DAY = 86400000
const NOW = 1_800_000_000_000

const rec = (ownerId: string, score: number, wins: number, rank: number) =>
	({ ownerId, username: ownerId, score, subscore: wins, rank, metadata: { losses: 0, gamesPlayed: 6, seasonBest: null } }) as unknown as nkruntime.LeaderboardRecord

describe('boardEntries', () => {
	it('shows each rating decayed, as rating_get and the website do', () => {
		const entries = boardEntries(
			[rec('c', 1645, 6, 1), rec('d', 1300, 0, 2), rec('e', 900, 0, 3)],
			{
				c: { rating: 1645, gamesPlayed: 6, lastMatchAt: NOW - 20.5 * DAY },
				d: { rating: 1300, gamesPlayed: 6, lastMatchAt: NOW - 200 * DAY },
				e: { rating: 900, gamesPlayed: 6, lastMatchAt: NOW - 200 * DAY },
			},
			NOW,
			'MultiplayerPvP',
		)
		expect(entries.map((e) => [e.playerId, e.rating, e.rank])).toEqual([
			['c', 1580, 1],
			['d', 1200, 2],
			['e', 900, 3],
		])
	})

	it('re-ranks the page by the decayed rating, then wins', () => {
		const entries = boardEntries(
			[rec('idle', 1700, 9, 11), rec('active', 1650, 3, 12), rec('tied', 1650, 5, 13)],
			{
				idle: { rating: 1700, gamesPlayed: 9, lastMatchAt: NOW - 30 * DAY },
				active: { rating: 1650, gamesPlayed: 6, lastMatchAt: NOW - DAY },
				tied: { rating: 1650, gamesPlayed: 6, lastMatchAt: NOW - DAY },
			},
			NOW,
			'MultiplayerPvP',
		)
		expect(entries.map((e) => [e.rank, e.playerId, e.rating])).toEqual([
			[11, 'tied', 1650],
			[12, 'active', 1650],
			[13, 'idle', 1585],
		])
	})

	it('carries a score season best as score text, also one stored as an old number', () => {
		const withBest = (seasonBest: unknown) =>
			({ ownerId: 'x', username: 'x', score: 700, subscore: 1, rank: 1, metadata: { losses: 0, gamesPlayed: 6, seasonBest } }) as unknown as nkruntime.LeaderboardRecord
		const best = (seasonBest: unknown, modId: string) => boardEntries([withBest(seasonBest)], {}, NOW, modId)[0].seasonBest
		expect(best('20.17609125905568,3', 'MultiplayerPvP')).toBe('20.17609125905568,3')
		expect(best(1e15, 'MultiplayerPvP')).toBe('1000000000000000')
		expect(best(null, 'MultiplayerPvP')).toBeNull()
		expect(best(95_000, 'MultiplayerSPDRN')).toBe(95_000)
	})

	it('keeps the stored score when the rating object is missing', () => {
		expect(boardEntries([rec('x', 700, 1, 1)], {}, NOW, 'MultiplayerPvP')[0].rating).toBe(700)
		expect(boardEntries([], {}, NOW, 'MultiplayerPvP')).toEqual([])
	})
})

describe('boardRankOf', () => {
	const nkWith = (list: () => unknown) => ({ leaderboardRecordsList: list }) as unknown as nkruntime.Nakama

	it("reads the player's own record's rank", () => {
		const nk = nkWith(() => ({ records: [], ownerRecords: [rec('a', 1500, 3, 7)] }))
		expect(boardRankOf(nk, 'board', 'a')).toBe(7)
	})

	it('is null for a player not on the board', () => {
		const nk = nkWith(() => ({ records: [], ownerRecords: [] }))
		expect(boardRankOf(nk, 'board', 'a')).toBeNull()
	})

	it('is null before the board exists', () => {
		const nk = nkWith(() => {
			throw new Error('leaderboard not found')
		})
		expect(boardRankOf(nk, 'board', 'a')).toBeNull()
	})
})
