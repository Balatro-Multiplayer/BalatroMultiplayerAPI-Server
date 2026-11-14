import { describe, expect, it } from 'vitest'
import type { RunRecord } from '../lobby/protocol'
import type { LogEvent } from '../shared/replay/events'
import {
	type RatingRecord,
	type Standing,
	applyRatings,
	newRating,
	planRatings,
	standingsOf,
} from './apply'
import { PLACEMENT_GAMES } from './elo'
import { logBounds, nextSeasonBest, seasonBestOf } from './metrics'
import { configureSeason } from './season'

function run(overrides: Partial<RunRecord> = {}): RunRecord {
	return {
		runId: 'r1',
		code: 'ABC123',
		modId: 'MultiplayerSPDRN',
		seed: 's',
		stake: 1,
		options: null,
		startedAt: 1000,
		endedAt: 61_000,
		status: 'agreed',
		placements: [
			{ playerId: 'a', place: 1, metric: 120_000 },
			{ playerId: 'b', place: 2 },
		],
		reports: {},
		players: [
			{ id: 'a', displayName: 'A' },
			{ id: 'b', displayName: 'B' },
		],
		rankedMode: 'solo',
		...overrides,
	}
}

function seasoned(rating: number): RatingRecord {
	return { ...newRating(), rating, gamesPlayed: 10 }
}

// The same table is in apps/server/src/tests/services/ratings-standing.test.ts.
describe('standingsOf', () => {
	it.each<[string, number[], Standing[]]>([
		['two players share first: a draw', [1, 1], ['draw', 'draw']],
		['two players, one wins', [1, 2], ['win', 'loss']],
		['[1,1,2]: both first places win', [1, 1, 2], ['win', 'win', 'loss']],
		['a single placement keeps the win', [1], ['win']],
		['three share first: a draw', [1, 1, 1], ['draw', 'draw', 'draw']],
	])('%s', (_name, places, expected) => {
		const placements = places.map((place, i) => ({ playerId: `p${i}`, place }))
		const got = standingsOf(placements)
		expect(placements.map((p) => got.get(p.playerId))).toEqual(expected)
	})
})

describe('planRatings', () => {
	it('a draw credits neither a win nor a loss and a normal win credits exactly one win and one loss', () => {
		const draw = planRatings(
			run({
				placements: [
					{ playerId: 'a', place: 1 },
					{ playerId: 'b', place: 1 },
				],
			}),
			{ a: seasoned(600), b: seasoned(600) },
		)
		expect(draw.updates.a.wins).toBe(0)
		expect(draw.updates.b.wins).toBe(0)
		expect(draw.updates.a.losses).toBe(0)
		expect(draw.updates.b.losses).toBe(0)
		expect(draw.updates.a.gamesPlayed).toBe(11)
		expect(draw.updates.a.rating).toBe(600)
		expect(draw.updates.b.rating).toBe(600)
		const win = planRatings(run(), { a: seasoned(600), b: seasoned(600) })
		expect([win.updates.a.wins, win.updates.b.wins]).toEqual([1, 0])
		expect([win.updates.a.losses, win.updates.b.losses]).toEqual([0, 1])
	})

	it('moves an even 1v1 by K/2 and records the win and loss', () => {
		const plan = planRatings(run(), { a: seasoned(600), b: seasoned(600) })
		expect(plan.updates.a).toMatchObject({ rating: 620, wins: 1, losses: 0, gamesPlayed: 11, lastMatchAt: 61_000 })
		expect(plan.updates.b).toMatchObject({ rating: 580, wins: 0, losses: 1, gamesPlayed: 11 })
		expect(plan.results.a).toEqual({ delta: 20, newRating: 620, isPlacement: false, justPlaced: false, gamesPlayed: 11 })
	})

	it('marks the game that ends the placement games, and shows the rating then', () => {
		const last = { ...newRating(), rating: 640, gamesPlayed: PLACEMENT_GAMES - 1 }
		const plan = planRatings(run(), { a: last, b: seasoned(600) })
		expect(plan.results.a.justPlaced).toBe(true)
		expect(plan.results.a.isPlacement).toBe(false)
		expect(plan.results.a.newRating).toBe(plan.updates.a.rating)
		expect(plan.results.b.justPlaced).toBe(false)
	})

	it('hides the rating change while a player is still in placement games', () => {
		const plan = planRatings(run(), {})
		expect(plan.results.a).toEqual({ delta: null, newRating: null, isPlacement: true, justPlaced: false, gamesPlayed: 1 })
		// ...but still stores it.
		expect(plan.updates.a.rating).toBeGreaterThan(600)
	})

	it('rates a partial result (the leaver was placed last by whoever stayed)', () => {
		const plan = planRatings(run({ status: 'partial' }), { a: seasoned(600), b: seasoned(600) })
		expect(plan.updates.a.rating).toBe(620)
	})

	it.each(['disputed', 'abandoned', 'restarted', 'contested'] as const)('does not rate a %s game', (status) => {
		const plan = planRatings(run({ status }), { a: seasoned(600), b: seasoned(600) })
		expect(plan).toEqual({ updates: {}, results: {} })
	})

	it.each(['hash_mismatch', 'elapsed_time_gate'] as const)('rates a game where one player carries a %s flag', (reason) => {
		const plan = planRatings(run({ flags: { b: reason } }), { a: seasoned(600), b: seasoned(600) })
		expect(plan.updates.a.rating).toBe(620)
		expect(plan.updates.b.rating).toBe(580)
		expect(Object.keys(plan.results).sort()).toEqual(['a', 'b'])
	})

	it('rates a game where both players are flagged, one of each kind', () => {
		const flags = { a: 'hash_mismatch', b: 'elapsed_time_gate' } as const
		const plan = planRatings(run({ flags }), { a: seasoned(600), b: seasoned(600) })
		expect(plan.updates.a.rating).toBe(620)
		expect(plan.updates.b.rating).toBe(580)
	})

	it('rates every player of a three-player game, flagged or not', () => {
		const three = run({
			placements: [
				{ playerId: 'a', place: 1 },
				{ playerId: 'b', place: 2 },
				{ playerId: 'c', place: 3 },
			],
			players: [
				{ id: 'a', displayName: 'A' },
				{ id: 'b', displayName: 'B' },
				{ id: 'c', displayName: 'C' },
			],
			flags: { c: 'elapsed_time_gate' },
		})
		const current = { a: seasoned(600), b: seasoned(600), c: seasoned(600) }
		const plan = planRatings(three, current)
		expect(Object.keys(plan.updates).sort()).toEqual(['a', 'b', 'c'])
	})

	it('never drops a rating below the floor', () => {
		const plan = planRatings(run(), { a: seasoned(100), b: seasoned(100) })
		expect(plan.updates.b.rating).toBe(100)
	})

	it('keeps a season-best time only when the new one is faster and plausible', () => {
		const current = { a: { ...seasoned(600), seasonBest: 100_000 }, b: seasoned(600) }
		expect(planRatings(run(), current).updates.a.seasonBest).toBe(100_000)
		const faster = run({ placements: [{ playerId: 'a', place: 1, metric: 90_000 }, { playerId: 'b', place: 2 }] })
		expect(planRatings(faster, current).updates.a.seasonBest).toBe(90_000)
	})

	it('still rates a player whose claimed PvP score is above their replay log', () => {
		const pvp = run({
			modId: 'MultiplayerPvP',
			placements: [
				{ playerId: 'a', place: 1, metricText: '20,3' },
				{ playerId: 'b', place: 2, metricText: '20,3' },
			],
		})
		const plan = planRatings(pvp, { a: seasoned(600), b: seasoned(600) }, { a: '500' })
		expect(plan.updates.a.seasonBest).toBeNull()
		expect(plan.updates.a.wins).toBe(1)
		expect(plan.updates.a.rating).toBeGreaterThan(600)
		expect(plan.updates.b.seasonBest).toBe('20,3')
	})
})

describe('nextSeasonBest', () => {
	it('rejects an implausible time rather than clamping it', () => {
		expect(nextSeasonBest('MultiplayerSPDRN', { metric: 5_000 }, null)).toBeNull()
		expect(nextSeasonBest('MultiplayerSPDRN', { metric: 7 * 3_600_000 }, 200_000)).toBe(200_000)
	})
	it('treats a higher PvP score as better', () => {
		expect(nextSeasonBest('MultiplayerPvP', { metricText: '50' }, '40')).toBe('50')
		expect(nextSeasonBest('MultiplayerPvP', { metricText: '30' }, '40')).toBe('40')
		expect(nextSeasonBest('MultiplayerPvP', { metricText: '50' }, null)).toBe('50')
	})
	it('stores a PvP score past 1e15 as it was reported', () => {
		expect(nextSeasonBest('MultiplayerPvP', { metricText: '20.17609125905568,3' }, '1000000000000000')).toBe(
			'20.17609125905568,3',
		)
		expect(nextSeasonBest('MultiplayerPvP', { metricText: '20,2' }, '20.17609125905568,3')).toBe(
			'20.17609125905568,3',
		)
	})
	it('keeps a score at exactly 1e15 over an equal one', () => {
		expect(nextSeasonBest('MultiplayerPvP', { metricText: '1000000000000000' }, '1000000000000000')).toBe(
			'1000000000000000',
		)
	})
	it('compares against a score stored as an old number', () => {
		expect(nextSeasonBest('MultiplayerPvP', { metricText: '1000000000000001' }, 1e15)).toBe('1000000000000001')
		expect(nextSeasonBest('MultiplayerPvP', { metricText: '5' }, 1e15)).toBe('1000000000000000')
	})
	it('ignores the old number metric and bad text for a score board', () => {
		expect(nextSeasonBest('MultiplayerPvP', { metric: 50 }, '40')).toBe('40')
		expect(nextSeasonBest('MultiplayerPvP', { metric: 50 }, null)).toBeNull()
		expect(nextSeasonBest('MultiplayerPvP', { metricText: 'nope' }, '40')).toBe('40')
	})
	it('ignores a mod with no metric', () => {
		expect(nextSeasonBest('OtherMod', { metric: 100_000, metricText: '5' }, null)).toBeNull()
	})
	it('ignores a PvP score above the bound from the replay log', () => {
		expect(nextSeasonBest('MultiplayerPvP', { metricText: '20,3' }, '40', '1234.5,1')).toBe('40')
		expect(nextSeasonBest('MultiplayerPvP', { metricText: '501' }, null, '500')).toBeNull()
	})
	it('keeps a PvP score at or below the bound', () => {
		expect(nextSeasonBest('MultiplayerPvP', { metricText: '500' }, '40', '500')).toBe('500')
		expect(nextSeasonBest('MultiplayerPvP', { metricText: '500' }, '40', '1234.5,1')).toBe('500')
	})
})

const hand = (total: unknown): LogEvent => ({ t: 0, opcode: 'hand_result', args: [total, 1] })

describe('logBounds', () => {
	it('is the largest round total in each trusted log, compared as score text', () => {
		const events = {
			a: [hand('900'), { t: 0, opcode: 'hand_scored', args: { score: '20,3' } }, hand('1234.5,1'), hand('50')],
			b: [hand('7')],
		}
		expect(logBounds(events, { a: 'match', b: 'match' })).toEqual({ a: '1234.5,1', b: '7' })
	})
	it('bounds a trusted log with no scored hand at 0', () => {
		expect(logBounds({}, { a: 'match' })).toEqual({ a: '0' })
	})
	it('has no bound for a log that is missing, cut off or does not match', () => {
		expect(logBounds({ a: [hand('5')], b: [hand('5')] }, { a: 'mismatch', b: 'unavailable' })).toEqual({})
	})
	it('reads a round total written as a plain number', () => {
		expect(logBounds({ a: [hand(900), hand('40')] }, { a: 'match' })).toEqual({ a: '900' })
	})
	it('skips a round total that is not score text', () => {
		expect(logBounds({ a: [hand('nope'), hand(null), hand('40')] }, { a: 'match' })).toEqual({ a: '40' })
	})
})

describe('seasonBestOf', () => {
	it('shows a PvP score as score text, also one stored as an old number', () => {
		expect(seasonBestOf('MultiplayerPvP', 1e15)).toBe('1000000000000000')
		expect(seasonBestOf('MultiplayerPvP', '20,2')).toBe('20,2')
		expect(seasonBestOf('MultiplayerPvP', null)).toBeNull()
		expect(seasonBestOf('MultiplayerPvP', undefined)).toBeNull()
	})
	it('keeps a time as a number', () => {
		expect(seasonBestOf('MultiplayerSPDRN', 95_000)).toBe(95_000)
	})
})

// A storage-only fake of Nakama: versioned objects, '*' = must not exist, and
// an optional hook that runs just before each write (to race it).
function fakeNk(before?: (nk: ReturnType<typeof fakeNk>) => void) {
	const objects = new Map<string, { value: RatingRecord; version: number }>()
	const boards: { [id: string]: { [owner: string]: number } } = {}
	const nk = {
		objects,
		boards,
		writes: 0,
		storageRead: (reads: { key: string; userId: string; collection: string }[]) =>
			reads.flatMap((r) => {
				const o = objects.get(`${r.userId}/${r.key}`)
				return o ? [{ ...r, value: o.value, version: String(o.version) }] : []
			}),
		storageWrite: (writes: { key: string; userId: string; value: RatingRecord; version?: string }[]) => {
			nk.writes++
			before?.(nk)
			for (const w of writes) {
				const existing = objects.get(`${w.userId}/${w.key}`)
				const ok = w.version === '*' ? !existing : existing && String(existing.version) === w.version
				if (!ok) throw new Error('version check failed')
			}
			for (const w of writes) {
				const existing = objects.get(`${w.userId}/${w.key}`)
				objects.set(`${w.userId}/${w.key}`, { value: w.value, version: (existing?.version ?? 0) + 1 })
			}
		},
		leaderboardCreate: () => undefined,
		leaderboardRecordWrite: (id: string, owner: string, _name: string, score: number) => {
			boards[id] = { ...boards[id], [owner]: score }
		},
	}
	return nk
}

const logger = { warn: () => undefined, error: () => undefined } as unknown as nkruntime.Logger

describe('applyRatings', () => {
	it('stores ratings for both players and reports their results', () => {
		const nk = fakeNk()
		const results = applyRatings(nk as never, logger, run(), 'solo')
		expect(results.a.gamesPlayed).toBe(1)
		expect(nk.objects.get('a/MultiplayerSPDRN:solo:1')?.value.wins).toBe(1)
		expect(nk.objects.get('b/MultiplayerSPDRN:solo:1')?.value.losses).toBe(1)
	})

	it('retries from fresh ratings when another game wrote a player in between', () => {
		let raced = false
		const nk = fakeNk((self) => {
			if (raced) return
			raced = true
			// Another game finished for b first.
			self.objects.set('b/MultiplayerSPDRN:solo:1', { value: seasoned(900), version: 1 })
		})
		const results = applyRatings(nk as never, logger, run(), 'solo')
		expect(nk.writes).toBe(2)
		// Rated against b's fresh 900, not a fresh 600.
		expect(nk.objects.get('b/MultiplayerSPDRN:solo:1')?.value.gamesPlayed).toBe(11)
		expect(results.b.gamesPlayed).toBe(11)
	})

	it('puts only players past their placement games on the leaderboard', () => {
		const nk = fakeNk()
		nk.objects.set('a/MultiplayerSPDRN:solo:1', { value: seasoned(600), version: 1 })
		applyRatings(nk as never, logger, run(), 'solo')
		expect(Object.keys(nk.boards['MultiplayerSPDRN:solo:1'])).toEqual(['a'])
	})

	it('rates nobody, and writes nothing, for a disputed game', () => {
		const nk = fakeNk()
		expect(applyRatings(nk as never, logger, run({ status: 'disputed' }), 'solo')).toEqual({})
		expect(nk.writes).toBe(0)
	})

	it('rates nobody, and writes nothing, for a contested game', () => {
		const nk = fakeNk()
		expect(applyRatings(nk as never, logger, run({ status: 'contested' }), 'solo')).toEqual({})
		expect(nk.writes).toBe(0)
	})

	it('seeds a new season from the last one, soft-reset, and decays idle ratings', () => {
		const nk = fakeNk()
		// a played recently (lastMatchAt = the run's end); b has been idle for 17 days.
		nk.objects.set('a/MultiplayerSPDRN:solo:1', { value: { ...seasoned(1600), lastMatchAt: 61_000 }, version: 1 })
		nk.objects.set('b/MultiplayerSPDRN:solo:1', {
			value: { ...seasoned(1600), lastMatchAt: 61_000 - 17 * 24 * 3600 * 1000 },
			version: 1,
		})
		configureSeason('2')
		try {
			const results = applyRatings(nk as never, logger, run(), 'solo')
			// 1100 and 1075 (1600 - 10 days' decay, then halved toward 600), both placing again.
			expect(nk.objects.get('a/MultiplayerSPDRN:solo:2')?.value.gamesPlayed).toBe(1)
			expect(results.a.isPlacement).toBe(true)
			const a = nk.objects.get('a/MultiplayerSPDRN:solo:2')?.value.rating
			const b = nk.objects.get('b/MultiplayerSPDRN:solo:2')?.value.rating
			expect(a as number).toBeGreaterThan(b as number)
			expect(a as number).toBeGreaterThan(700)
			expect(b as number).toBeLessThan(1100)
		} finally {
			configureSeason('1')
		}
	})
})
