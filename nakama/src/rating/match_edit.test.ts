import { describe, expect, it } from 'vitest'
import {
	MY_RUNS_COLLECTION,
	RATINGS_COLLECTION,
	RUNS_COLLECTION,
	type RunRecord,
	SYSTEM_USER_ID,
} from '../lobby/protocol'
import { myRunKey } from '../lobby/storage'
import { fakeLogger, fakeNk, serverCtx } from '../testing/fake_nk'
import type { RatingRecord } from './apply'
import { planMatchEdit, rpcAdminMatchEdit } from './match_edit'

const A = '11111111-1111-1111-1111-111111111111'
const B = '22222222-2222-2222-2222-222222222222'
const KEY = 'M:ranked:3'

const record = (over: Partial<RatingRecord> = {}): RatingRecord => ({
	rating: 1000,
	wins: 6,
	losses: 5,
	gamesPlayed: 11,
	seasonBest: null,
	lastMatchAt: 5000,
	...over,
})

const rated = (delta: number, newRating: number) => ({
	delta,
	newRating,
	isPlacement: false,
	gamesPlayed: 11,
})

// Two established players (1000 each before the game) who drew.
const drawRun = (over: Partial<RunRecord> = {}): RunRecord => ({
	runId: 'r1',
	code: 'ABCDE',
	modId: 'M',
	seed: 'S',
	stake: 1,
	options: {},
	startedAt: 1000,
	endedAt: 5000,
	status: 'agreed',
	placements: [
		{ playerId: A, place: 1 },
		{ playerId: B, place: 1 },
	],
	reports: {},
	players: [
		{ id: A, displayName: 'A' },
		{ id: B, displayName: 'B' },
	],
	rankedMode: 'ranked',
	ratings: { [A]: rated(0, 1000), [B]: rated(0, 1000) },
	...over,
})

const aWins = [
	{ playerId: A, place: 1 },
	{ playerId: B, place: 2 },
]
const bWins = [
	{ playerId: A, place: 2 },
	{ playerId: B, place: 1 },
]

describe('planMatchEdit', () => {
	it('moves each player by the new change minus the old one when a draw becomes a win', () => {
		const plan = planMatchEdit(
			drawRun(),
			{ [A]: record(), [B]: record() },
			{ placements: aWins, season: 3, now: 9000 },
		)
		expect(plan.ok).toBe(true)
		if (!plan.ok) return
		expect(plan.records[A]).toMatchObject({
			rating: 1020,
			wins: 6,
			losses: 5,
			gamesPlayed: 11,
		})
		expect(plan.records[B]).toMatchObject({
			rating: 980,
			wins: 5,
			losses: 6,
			gamesPlayed: 11,
		})
		expect(plan.run.placements.map((p) => p.playerId)).toEqual([A, B])
		expect(plan.run.ratings?.[A]).toMatchObject({ delta: 20, newRating: 1020 })
		expect(plan.run.ratings?.[B]).toMatchObject({ delta: -20, newRating: 980 })
		expect(plan.changes[B]).toEqual({
			oldDelta: 0,
			newDelta: -20,
			rating: -20,
			wins: -1,
			losses: 1,
			gamesPlayed: 0,
		})
		expect(plan.run.overturned).toEqual({
			at: 9000,
			previous: drawRun().placements,
		})
		expect(plan.places).toEqual({ [A]: 1, [B]: 2 })
		expect(plan.myRunRatings[B]).toMatchObject({ delta: -20, newRating: 980 })
	})

	it('applies the difference to the current rating after later games', () => {
		const run = drawRun({
			placements: aWins,
			ratings: { [A]: rated(20, 1020), [B]: rated(-20, 980) },
		})
		const current = {
			[A]: record({ rating: 1100, wins: 8, losses: 5, gamesPlayed: 13 }),
			[B]: record({ rating: 900, wins: 5, losses: 8, gamesPlayed: 13 }),
		}
		const plan = planMatchEdit(run, current, {
			placements: bWins,
			season: 3,
			now: 9000,
		})
		expect(plan.ok).toBe(true)
		if (!plan.ok) return
		expect(plan.records[A]).toMatchObject({
			rating: 1060,
			wins: 7,
			losses: 6,
			gamesPlayed: 13,
		})
		expect(plan.records[B]).toMatchObject({
			rating: 940,
			wins: 6,
			losses: 7,
			gamesPlayed: 13,
		})
		expect(plan.run.ratings?.[A]).toMatchObject({ delta: -20, newRating: 980 })
	})

	it('takes back the rating changes when a ranked match is voided', () => {
		const run = drawRun({
			placements: aWins,
			ratings: { [A]: rated(20, 1020), [B]: rated(-20, 980) },
		})
		const current = {
			[A]: record({ rating: 1020 }),
			[B]: record({ rating: 980, wins: 5, losses: 6 }),
		}
		const plan = planMatchEdit(run, current, {
			placements: null,
			season: 3,
			now: 9000,
		})
		expect(plan.ok).toBe(true)
		if (!plan.ok) return
		expect(plan.records[A]).toMatchObject({
			rating: 1000,
			wins: 5,
			losses: 5,
			gamesPlayed: 10,
		})
		expect(plan.records[B]).toMatchObject({
			rating: 1000,
			wins: 5,
			losses: 5,
			gamesPlayed: 10,
		})
		expect(plan.run.ratings).toBeUndefined()
		expect(plan.run.voided).toEqual({ at: 9000 })
		expect(plan.myRunRatings).toEqual({ [A]: null, [B]: null })
	})

	it('changes no rating for a casual match', () => {
		const run = drawRun({ rankedMode: undefined, ratings: undefined })
		const plan = planMatchEdit(
			run,
			{},
			{ placements: aWins, season: null, now: 9000 },
		)
		expect(plan.ok).toBe(true)
		if (!plan.ok) return
		expect(plan.changes).toEqual({})
		expect(plan.records).toEqual({})
		expect(plan.run.placements.map((p) => p.place)).toEqual([1, 2])
		const voided = planMatchEdit(
			run,
			{},
			{ placements: null, season: null, now: 9000 },
		)
		expect(voided.ok && voided.changes).toEqual({})
	})

	it('refuses when a player was still in their placement games', () => {
		const run = drawRun({
			ratings: {
				[A]: rated(0, 1000),
				[B]: {
					delta: null,
					newRating: null,
					isPlacement: true,
					gamesPlayed: 3,
				},
			},
		})
		const plan = planMatchEdit(
			run,
			{ [A]: record(), [B]: record({ gamesPlayed: 3 }) },
			{ placements: aWins, season: 3, now: 9000 },
		)
		expect(plan).toEqual({
			ok: false,
			refusal: { kind: 'old_change_unknown', playerId: B },
		})
	})

	it('refuses when a player record is gone or cannot hold the change', () => {
		const run = drawRun()
		expect(
			planMatchEdit(
				run,
				{ [A]: record() },
				{ placements: aWins, season: 3, now: 9000 },
			),
		).toEqual({
			ok: false,
			refusal: { kind: 'record_missing', playerId: B },
		})
		const small = planMatchEdit(
			run,
			{ [A]: record(), [B]: record({ wins: 0, gamesPlayed: 0 }) },
			{ placements: null, season: 3, now: 9000 },
		)
		expect(small).toEqual({
			ok: false,
			refusal: { kind: 'record_too_small', playerId: B },
		})
	})

	it('refuses an unchanged result and a second void', () => {
		expect(
			planMatchEdit(
				drawRun(),
				{},
				{ placements: drawRun().placements, season: 3, now: 9000 },
			),
		).toMatchObject({
			ok: false,
			refusal: { kind: 'unchanged' },
		})
		expect(
			planMatchEdit(
				drawRun({ voided: { at: 1 } }),
				{},
				{ placements: null, season: 3, now: 9000 },
			),
		).toMatchObject({
			ok: false,
			refusal: { kind: 'unchanged' },
		})
	})

	it('rates a game nobody was rated for from the current ratings', () => {
		const run = drawRun({
			status: 'contested',
			placements: [],
			ratings: undefined,
		})
		const plan = planMatchEdit(
			run,
			{ [A]: record(), [B]: record() },
			{ placements: aWins, season: 3, now: 9000 },
		)
		expect(plan.ok).toBe(true)
		if (!plan.ok) return
		expect(plan.records[A]).toMatchObject({
			rating: 1020,
			wins: 7,
			losses: 5,
			gamesPlayed: 12,
		})
		expect(plan.records[B]).toMatchObject({
			rating: 980,
			wins: 6,
			losses: 6,
			gamesPlayed: 12,
		})
		expect(plan.changes[A]).toEqual({
			oldDelta: null,
			newDelta: 20,
			rating: 20,
			wins: 1,
			losses: 0,
			gamesPlayed: 1,
		})
	})
})

describe('rating a game for the first time', () => {
	it('rates a contested game whose recorded result is confirmed unchanged', () => {
		const run = drawRun({
			status: 'contested',
			placements: aWins,
			ratings: undefined,
		})
		const plan = planMatchEdit(
			run,
			{ [A]: record(), [B]: record() },
			{ placements: aWins, season: 3, now: 9000 },
		)
		expect(plan.ok).toBe(true)
		if (!plan.ok) return
		expect(plan.records[A]).toMatchObject({ rating: 1020, gamesPlayed: 12 })
		expect(plan.run.overturned).toBeUndefined()
		expect(plan.run.ratings?.[A]).toMatchObject({ delta: 20, newRating: 1020 })
	})
})

describe('a disputed ranked run stored with an empty ratings object', () => {
	const disputed = () =>
		drawRun({ status: 'disputed', placements: [], ratings: {} })

	it('is overturned like a game nobody was rated for, rating both players', () => {
		const plan = planMatchEdit(
			disputed(),
			{ [A]: record(), [B]: record() },
			{ placements: aWins, season: 3, now: 9000 },
		)
		expect(plan.ok).toBe(true)
		if (!plan.ok) return
		expect(plan.run.overturned).toBeDefined()
		expect(plan.records[A]).toMatchObject({
			rating: 1020,
			wins: 7,
			losses: 5,
			gamesPlayed: 12,
		})
		expect(plan.records[B]).toMatchObject({
			rating: 980,
			wins: 6,
			losses: 6,
			gamesPlayed: 12,
		})
		expect(plan.run.ratings?.[A]).toMatchObject({ delta: 20, newRating: 1020 })
	})

	it('is voided without refusing and without changing any rating', () => {
		const plan = planMatchEdit(
			disputed(),
			{ [A]: record(), [B]: record() },
			{ placements: null, season: 3, now: 9000 },
		)
		expect(plan.ok).toBe(true)
		if (!plan.ok) return
		expect(plan.run.voided).toEqual({ at: 9000 })
		expect(plan.records).toEqual({})
		expect(plan.myRunRatings).toEqual({ [A]: null, [B]: null })
	})

	it('rates a confirmed result like a run with no ratings', () => {
		const plan = planMatchEdit(
			drawRun({ status: 'contested', placements: aWins, ratings: {} }),
			{ [A]: record(), [B]: record() },
			{ placements: aWins, season: 3, now: 9000 },
		)
		expect(plan.ok).toBe(true)
		if (!plan.ok) return
		expect(plan.records[A]).toMatchObject({ rating: 1020, gamesPlayed: 12 })
	})
})

describe('admin_match_edit', () => {
	function world(run: RunRecord, current: { [id: string]: RatingRecord }) {
		const board = new Map<string, number>()
		const nk = fakeNk({
			board,
			leaderboardCreate: () => {},
			leaderboardRecordWrite: (
				_id: string,
				owner: string,
				_n: string,
				score: number,
			) => board.set(owner, score),
			leaderboardRecordDelete: (_id: string, owner: string) =>
				board.delete(owner),
		})
		nk.storageWrite([
			{
				collection: RUNS_COLLECTION,
				key: run.runId,
				userId: SYSTEM_USER_ID,
				value: run,
			},
			...run.players.map((p) => ({
				collection: MY_RUNS_COLLECTION,
				key: myRunKey(run),
				userId: p.id,
				value: {
					runId: run.runId,
					place: 1,
					rating: run.ratings?.[p.id] ?? null,
				},
			})),
			...Object.entries(current).map(([userId, value]) => ({
				collection: RATINGS_COLLECTION,
				key: KEY,
				userId,
				value,
			})),
		])
		const call = (body: object) =>
			JSON.parse(
				rpcAdminMatchEdit(
					serverCtx(),
					fakeLogger,
					nk as never,
					JSON.stringify({ runId: 'r1', ...body }),
				),
			)
		const read = (collection: string, key: string, userId: string) =>
			nk.storageRead([{ collection, key, userId }])[0].value
		return { nk, board, call, read }
	}

	it('writes the run, match history, ratings and leaderboard together', () => {
		const { call, read, board } = world(drawRun(), {
			[A]: record(),
			[B]: record(),
		})
		const reply = call({ placements: aWins, season: 3 })
		expect(reply.applied).toBe(true)
		expect(reply.changes[A]).toMatchObject({ rating: 20 })
		expect(
			read(RUNS_COLLECTION, 'r1', SYSTEM_USER_ID).ratings[B],
		).toMatchObject({ delta: -20 })
		expect(read(MY_RUNS_COLLECTION, myRunKey(drawRun()), B)).toMatchObject({
			place: 2,
			rating: { delta: -20, newRating: 980 },
		})
		expect(read(RATINGS_COLLECTION, KEY, A)).toMatchObject({ rating: 1020 })
		expect(read(RATINGS_COLLECTION, KEY, B)).toMatchObject({
			rating: 980,
			wins: 5,
		})
		expect(board.get(A)).toBe(1020)
		expect(board.get(B)).toBe(980)
	})

	it('answers a repeated edit with the earlier change and writes nothing more', () => {
		const { call, read } = world(drawRun(), { [A]: record(), [B]: record() })
		const first = call({ placements: aWins, season: 3 })
		const again = call({ placements: aWins, season: 3 })
		expect(again.applied).toBe(false)
		expect(again.changes).toEqual(first.changes)
		expect(read(RATINGS_COLLECTION, KEY, A)).toMatchObject({ rating: 1020 })
	})

	it('removes a player from the leaderboard when a void drops them under the placement games', () => {
		const run = drawRun({
			ratings: { [A]: rated(0, 1000), [B]: rated(0, 1000) },
		})
		const { call, board } = world(run, {
			[A]: record({ gamesPlayed: 5 }),
			[B]: record({ gamesPlayed: 5 }),
		})
		board.set(A, 1000)
		call({ void: true, season: 3 })
		expect(board.has(A)).toBe(false)
	})

	it('refuses a bad request', () => {
		const { call } = world(drawRun(), { [A]: record(), [B]: record() })
		expect(() => call({ placements: 'x' })).toThrow(/placements/)
		expect(() => call({ placements: aWins, season: 0 })).toThrow(/season/)
		expect(() => call({ placements: aWins, season: 3, runId: 'nope' })).toThrow(
			/not found/i,
		)
	})

	describe('Notifications', () => {
		const contested = drawRun({
			status: 'contested',
			ratings: undefined,
			rankedMode: undefined,
			contest: { by: B, against: A, at: 1 },
		})
		const sent = (nk: {
			notifications: { userId: string; content: unknown }[]
		}) =>
			nk.notifications.map((n) => ({ to: n.userId, ...(n.content as object) }))

		it('tells a contest decision with each player their own result', () => {
			const { nk, call } = world(contested, {})
			call({ placements: aWins, decidesContest: true })
			expect(sent(nk as never)).toMatchObject([
				{
					to: A,
					kind: 'contest_decided',
					params: { role: 'opponent', outcome: 'win' },
				},
				{
					to: B,
					kind: 'contest_decided',
					params: { role: 'contester', outcome: 'loss' },
				},
			])
		})

		it('sends nothing when the caller tells the players itself, and does not tell again later', () => {
			const { nk, call } = world(contested, {})
			call({ placements: aWins, silent: true })
			expect(sent(nk as never)).toHaveLength(0)
			call({ placements: aWins })
			expect(sent(nk as never)).toHaveLength(0)
		})

		it('tells a contest keeping the reported result, once', () => {
			const { nk, call } = world(contested, {})
			call({ placements: drawRun().placements, decidesContest: true })
			expect(sent(nk as never)).toHaveLength(2)
			call({ placements: drawRun().placements, decidesContest: true })
			expect(sent(nk as never)).toHaveLength(2)
		})

		it('tells nothing when a reopened contest is decided the same way, and tells a different decision', () => {
			const { nk, call } = world(contested, {})
			call({ placements: aWins, decidesContest: true })
			call({ placements: aWins, decidesContest: true })
			expect(sent(nk as never)).toHaveLength(2)
			call({
				placements: [
					{ playerId: A, place: 2 },
					{ playerId: B, place: 1 },
				],
				decidesContest: true,
			})
			expect(sent(nk as never)).toHaveLength(4)
		})

		it('tells a void and a set result from the match page without contest wording', () => {
			const voided = world(drawRun(), { [A]: record(), [B]: record() })
			voided.call({ void: true, season: 3 })
			expect(
				sent(voided.nk as never).map(
					(n) => (n as unknown as { kind: string }).kind,
				),
			).toEqual(['result_voided', 'result_voided'])
			const changed = world(drawRun(), { [A]: record(), [B]: record() })
			changed.call({ placements: aWins, season: 3 })
			expect(sent(changed.nk as never)).toMatchObject([
				{ to: A, kind: 'result_changed', params: { outcome: 'win' } },
				{ to: B, kind: 'result_changed', params: { outcome: 'loss' } },
			])
		})

		it('tells a contest decided by a void with the void wording, and nobody twice', () => {
			const { nk, call } = world(contested, {})
			call({ void: true, decidesContest: true })
			call({ void: true, decidesContest: true })
			expect(sent(nk as never)).toMatchObject([
				{ kind: 'result_voided' },
				{ kind: 'result_voided' },
			])
			expect(sent(nk as never)).toHaveLength(2)
		})
	})
})
