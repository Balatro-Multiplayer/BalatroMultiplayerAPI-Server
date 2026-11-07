import { describe, expect, it } from 'vitest'
import { fakeNk } from '../testing/fake_nk'
import { LOGS_COLLECTION, RUNS_COLLECTION, type RunRecord, SYSTEM_USER_ID } from './protocol'
import { MY_RUNS_COLLECTION } from './protocol'
import { rpcRunGet, rpcRunLogs, rpcRunsMine, runWrites } from './storage'

const logger = {} as nkruntime.Logger
const ctx = (userId: string) => ({ userId }) as unknown as nkruntime.Context

function storedRun() {
	const nk = fakeNk()
	const run = {
		runId: 'r1',
		players: [
			{ id: 'a', displayName: 'A' },
			{ id: 'b', displayName: 'B' },
		],
		flags: { b: ['hash_mismatch'] },
	} as unknown as RunRecord
	nk.storageWrite([
		{
			collection: RUNS_COLLECTION,
			key: 'r1',
			userId: SYSTEM_USER_ID,
			value: run,
		},
	])
	return nk as unknown as nkruntime.Nakama
}

describe('rpcRunGet', () => {
	it('returns the run to a participant', () => {
		const out = JSON.parse(
			rpcRunGet(ctx('a'), logger, storedRun(), JSON.stringify({ runId: 'r1' })),
		)
		expect(out.runId).toBe('r1')
	})

	it('hides the run from a non-participant as not found', () => {
		expect(() =>
			rpcRunGet(
				ctx('stranger'),
				logger,
				storedRun(),
				JSON.stringify({ runId: 'r1' }),
			),
		).toThrow('Run not found')
	})

	it('reports a missing run as not found', () => {
		expect(() =>
			rpcRunGet(
				ctx('a'),
				logger,
				storedRun(),
				JSON.stringify({ runId: 'nope' }),
			),
		).toThrow('Run not found')
	})
})

describe('rpcRunsMine', () => {
	it('answers INVALID_ARGUMENT, not an uncaught error, for a cursor Nakama refuses', () => {
		const nk = fakeNk({
			storageList: (_u: string, _c: string, _l: number, cursor: string) => {
				if (cursor) throw new Error('failed to list storage objects: Malformed cursor was used.')
				return { objects: [], cursor: '' }
			},
		}) as unknown as nkruntime.Nakama
		let thrown: any
		try {
			rpcRunsMine(ctx('a'), logger, nk, JSON.stringify({ cursor: 'junk' }))
		} catch (e) {
			thrown = e
		}
		expect(thrown).toMatchObject({ code: 3, message: 'Invalid cursor' })
		expect(JSON.parse(rpcRunsMine(ctx('a'), logger, nk, '{}'))).toEqual({ runs: [], cursor: '' })
	})

	it('still surfaces a storage failure without a cursor', () => {
		const nk = fakeNk({
			storageList: () => {
				throw new Error('db down')
			},
		}) as unknown as nkruntime.Nakama
		expect(() => rpcRunsMine(ctx('a'), logger, nk, '{}')).toThrow('db down')
	})
})

describe('runWrites', () => {
	it('gives a player who left before the run settled their place and rating in their history', () => {
		const run = {
			runId: 'r1',
			code: 'ABC123',
			modId: 'MultiplayerPvP',
			startedAt: 1,
			endedAt: 2,
			status: 'partial',
			players: [
				{ id: 'a', displayName: 'A' },
				{ id: 'b', displayName: 'B' },
			],
			placements: [
				{ playerId: 'b', place: 1 },
				{ playerId: 'a', place: 2 },
			],
			ratings: { a: { delta: -12, newRating: 988, isPlacement: false, gamesPlayed: 9 } },
		} as unknown as RunRecord
		const writes = runWrites(run, {}, () => 'h')
		const mine = writes.filter((w) => w.collection === MY_RUNS_COLLECTION && w.userId === 'a')[0]
		expect(mine.value).toMatchObject({ status: 'partial', place: 2, rating: { delta: -12 } })
	})

	it('records the gap count and the incomplete check for each player', () => {
		const run = {
			runId: 'r1',
			players: [
				{ id: 'a', displayName: 'A' },
				{ id: 'b', displayName: 'B' },
			],
			placements: [],
		} as unknown as RunRecord
		const lines = ['[1,"play",null]', '[2,"chk",{"carbon":"x"}]']
		const writes = runWrites(
			run,
			{
				a: { lines, bytes: 0, truncated: false, seq: 2, ahead: 5 },
				b: { lines, bytes: 0, truncated: false, seq: 2 },
			},
			() => 'h',
		)
		expect(writes[0].value).toMatchObject({
			logChecks: { a: 'incomplete', b: 'mismatch' },
			logGaps: { a: 3, b: 0 },
		})
		const stored = (id: string) => writes.filter((w) => w.collection === LOGS_COLLECTION && w.key === `r1:${id}`)[0].value
		expect(stored('a')).toMatchObject({ gaps: 3, check: 'incomplete' })
		expect(stored('b')).toMatchObject({ gaps: 0 })
	})
})

describe('rpcRunLogs', () => {
	const logsOf = (value: { [key: string]: unknown }) => {
		const nk = storedRun()
		nk.storageWrite([{ collection: LOGS_COLLECTION, key: 'r1:a', userId: SYSTEM_USER_ID, value, permissionRead: 0, permissionWrite: 0 }])
		return JSON.parse(rpcRunLogs(ctx('a'), logger, nk, JSON.stringify({ runId: 'r1', playerId: 'a' }))).logs.a
	}

	it('parses the stored lines into events for the client', () => {
		const log = logsOf({ lines: ['[1,"play",null]'], eventCount: 1, check: 'match' })
		expect(log).toEqual({ events: [[1, 'play', null]], eventCount: 1, check: 'match' })
	})

	it('still answers the events of a log stored before lines were kept', () => {
		const log = logsOf({ events: [[1, 'play', null]], eventCount: 1 })
		expect(log.events).toEqual([[1, 'play', null]])
	})
})
