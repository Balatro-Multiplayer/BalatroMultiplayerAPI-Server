import { describe, expect, it } from 'vitest'
import { LOGS_COLLECTION, MY_RUNS_COLLECTION, RUNS_COLLECTION, type RunRecord, SYSTEM_USER_ID } from '../lobby/protocol'
import { myRunKey, runWrites } from '../lobby/storage'
import { fakeLogger, fakeNk, playerCtx, serverCtx } from '../testing/fake_nk'
import { NotifyCode, isNotifyCode } from '../notify'
import { lobbyKindOf, lobbyKindOfLabel, rankedContextOf } from './ranked'
import { overturnRun, parseResultPlacements } from './result'
import { rpcAdminRunTellVoided } from '../notification/tell_voided'
import { rpcAdminRunGet, rpcAdminRunSetResult } from './rpc'

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
	runId: 'r1',
	code: 'ABCDE',
	modId: 'M',
	seed: 'S',
	stake: 1,
	options: {},
	startedAt: 1000,
	endedAt: 5000,
	status: 'disputed',
	placements: [
		{ playerId: 'a', place: 1, performance: 9 },
		{ playerId: 'b', place: 2 },
	],
	reports: { a: [], b: [] },
	players: [
		{ id: 'a', displayName: 'A' },
		{ id: 'b', displayName: 'B' },
	],
	...over,
})

describe('overturning a run result', () => {
	it('swaps places, keeps each player\'s performance and remembers the original', () => {
		const result = overturnRun(run(), [
			{ playerId: 'a', place: 2 },
			{ playerId: 'b', place: 1 },
		], 7000)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.run.placements).toEqual([
			{ playerId: 'b', place: 1 },
			{ playerId: 'a', place: 2, performance: 9 },
		])
		expect(result.run.overturned).toEqual({ at: 7000, previous: run().placements })
		expect(result.places).toEqual({ a: 2, b: 1 })
	})

	it('names a winner for a contested run nobody reported on', () => {
		const result = overturnRun(run({ status: 'contested', placements: [] }), [
			{ playerId: 'b', place: 1 },
			{ playerId: 'a', place: 2 },
		], 7000)
		expect(result.ok).toBe(true)
		if (!result.ok) return
		expect(result.run.placements).toEqual([
			{ playerId: 'b', place: 1 },
			{ playerId: 'a', place: 2 },
		])
		expect(result.run.overturned).toEqual({ at: 7000, previous: [] })
		expect(overturnRun(run({ placements: [] }), [{ playerId: 'a', place: 1 }], 0)).toEqual({
			ok: false,
			refusal: { kind: 'players_differ' },
		})
	})

	it('keeps the first original across a second overturn', () => {
		const once = overturnRun(run(), [{ playerId: 'a', place: 2 }, { playerId: 'b', place: 1 }], 7000)
		if (!once.ok) throw new Error('first overturn refused')
		const twice = overturnRun(once.run, [{ playerId: 'a', place: 1 }, { playerId: 'b', place: 2 }], 8000)
		expect(twice.ok && twice.run.overturned).toEqual({ at: 8000, previous: run().placements })
	})

	it('refuses another set of players, or the same result', () => {
		expect(overturnRun(run(), [{ playerId: 'a', place: 1 }], 0)).toEqual({ ok: false, refusal: { kind: 'players_differ' } })
		expect(overturnRun(run(), [{ playerId: 'b', place: 2 }, { playerId: 'a', place: 1 }], 0)).toEqual({
			ok: false,
			refusal: { kind: 'unchanged' },
		})
	})

	it('parses only whole positive places', () => {
		expect(parseResultPlacements([{ playerId: 'a', place: 1 }])).toEqual([{ playerId: 'a', place: 1 }])
		expect(parseResultPlacements([{ playerId: 'a', place: 0 }])).toBeNull()
		expect(parseResultPlacements([{ playerId: 'a', place: 1.5 }])).toBeNull()
		expect(parseResultPlacements([])).toBeNull()
		expect(parseResultPlacements('x')).toBeNull()
	})
})

describe('ranked context', () => {
	const record = (gameMode: string) => ({ modId: 'M', gameMode, ticket: 't', sessionId: 's', at: 0 })
	it('is queued for a ranked ticket only', () => {
		expect(rankedContextOf([record('ranked:duel')], null)).toEqual({ queued: true, inGame: false })
		expect(rankedContextOf([record('duel')], null)).toEqual({ queued: false, inGame: false })
	})
	it('is in game for a started ranked lobby only', () => {
		const label = (mode: string, started: boolean) => JSON.stringify({ mode, started })
		expect(rankedContextOf([], label('ranked:duel', true)).inGame).toBe(true)
		expect(rankedContextOf([], label('ranked:duel', false)).inGame).toBe(false)
		expect(rankedContextOf([], label('', true)).inGame).toBe(false)
		expect(rankedContextOf([], 'not json').inGame).toBe(false)
	})
})

describe('lobby kind', () => {
	it('tells ranked, casual and private lobbies apart', () => {
		expect(lobbyKindOf({ rankedMode: 'duel', allowedIds: [] })).toBe('ranked')
		expect(lobbyKindOf({ gameMode: 'ranked:duel' })).toBe('ranked')
		expect(lobbyKindOf({ gameMode: 'duel', allowedIds: [] })).toBe('casual')
		expect(lobbyKindOf({})).toBe('private')
	})
	it('reads the same from a label', () => {
		expect(lobbyKindOfLabel(JSON.stringify({ type: 'ranked', mode: 'ranked:duel' }))).toBe('ranked')
		expect(lobbyKindOfLabel(JSON.stringify({ type: 'public', mode: 'duel' }))).toBe('casual')
		expect(lobbyKindOfLabel(JSON.stringify({ type: 'private', mode: '' }))).toBe('private')
		expect(lobbyKindOfLabel(null)).toBeNull()
		expect(lobbyKindOfLabel('{')).toBeNull()
	})
})

describe('admin run RPCs', () => {
	const stored = () => {
		const nk: any = fakeNk({ sha256Hash: () => 'h' })
		nk.storageWrite(runWrites(run(), { a: { lines: ['{"t":1}'], truncated: false } as never }, () => 'h'))
		return nk
	}

	it('admin_run_get answers the record and log summaries, events on request', () => {
		const nk = stored()
		const plain = JSON.parse(rpcAdminRunGet(serverCtx(), fakeLogger, nk, JSON.stringify({ runId: 'r1' })))
		expect(plain.run.runId).toBe('r1')
		expect(plain.logs.a).toEqual({ eventCount: 1, truncated: false, carbonHash: null, check: 'unavailable' })
		expect(plain.logs.a.events).toBeUndefined()
		const full = JSON.parse(rpcAdminRunGet(serverCtx(), fakeLogger, nk, JSON.stringify({ runId: 'r1', events: true })))
		expect(full.logs.a.events).toEqual([{ t: 1 }])
	})

	it('admin_run_get still reads a log stored before lines were kept', () => {
		const nk: any = fakeNk()
		nk.storageWrite(runWrites(run(), { a: { lines: [], truncated: false } as never }, () => 'h'))
		nk.storageWrite([
			{
				collection: LOGS_COLLECTION,
				key: 'r1:a',
				userId: SYSTEM_USER_ID,
				value: { events: [{ t: 2 }], eventCount: 1, truncated: false, carbonHash: null, check: 'unavailable' },
			},
		])
		const full = JSON.parse(rpcAdminRunGet(serverCtx(), fakeLogger, nk, JSON.stringify({ runId: 'r1', events: true })))
		expect(full.logs.a.events).toEqual([{ t: 2 }])
	})

	it('admin_run_tell_voided tells each player once and leaves the run unvoided', () => {
		const nk: any = fakeNk()
		nk.storageWrite(runWrites(run({ status: 'contested', placements: [] }), {}, () => 'h'))
		const call = () => JSON.parse(rpcAdminRunTellVoided(serverCtx(), fakeLogger, nk, JSON.stringify({ runId: 'r1' })))
		expect(call().told).toBe(2)
		expect(nk.notifications.map((n: any) => n.content.kind)).toEqual(['result_voided', 'result_voided'])
		expect(call().told).toBe(0)
		expect(nk.notifications).toHaveLength(2)
		const stored = nk.storageRead([{ collection: RUNS_COLLECTION, key: 'r1', userId: SYSTEM_USER_ID }])[0].value
		expect(stored.voided).toBeUndefined()
		expect(() => rpcAdminRunTellVoided(playerCtx('a'), fakeLogger, nk, '{"runId":"r1"}')).toThrow(/server/)
	})

	it('admin_run_get refuses a player session and an unknown run', () => {
		const nk = stored()
		expect(() => rpcAdminRunGet(playerCtx('a'), fakeLogger, nk, JSON.stringify({ runId: 'r1' }))).toThrow(/server/)
		expect(() => rpcAdminRunGet(serverCtx(), fakeLogger, nk, JSON.stringify({ runId: 'nope' }))).toThrow(/not found/i)
	})

	it('admin_run_set_result rewrites the record and each my_runs place', () => {
		const nk = stored()
		const reply = JSON.parse(
			rpcAdminRunSetResult(
				serverCtx(),
				fakeLogger,
				nk,
				JSON.stringify({ runId: 'r1', placements: [{ playerId: 'a', place: 2 }, { playerId: 'b', place: 1 }] }),
			),
		)
		expect(reply.run.placements.map((p: any) => p.playerId)).toEqual(['b', 'a'])
		const record = nk.storageRead([{ collection: RUNS_COLLECTION, key: 'r1', userId: SYSTEM_USER_ID }])[0].value
		expect(record.overturned.previous[0]).toEqual({ playerId: 'a', place: 1, performance: 9 })
		const key = myRunKey(run())
		const places = nk
			.storageRead(['a', 'b'].map((userId) => ({ collection: MY_RUNS_COLLECTION, key, userId })))
			.map((o: any) => [o.userId, o.value.place])
		expect(places).toEqual([
			['a', 2],
			['b', 1],
		])
		// Logs untouched.
		expect(nk.storageRead([{ collection: LOGS_COLLECTION, key: 'r1:a', userId: SYSTEM_USER_ID }]).length).toBe(1)
	})

	it('admin_run_set_result refuses a malformed or unchanged result', () => {
		const nk = stored()
		const call = (placements: unknown) =>
			rpcAdminRunSetResult(serverCtx(), fakeLogger, nk, JSON.stringify({ runId: 'r1', placements }))
		expect(() => call('x')).toThrow(/placements/)
		expect(() => call([{ playerId: 'a', place: 1 }])).toThrow(/exactly/)
		expect(() => call([{ playerId: 'a', place: 1 }, { playerId: 'b', place: 2 }])).toThrow(/already/)
	})
})

describe('WARNED', () => {
	it('is a known notification code, 109', () => {
		expect(NotifyCode.WARNED).toBe(109)
		expect(isNotifyCode(109)).toBe(true)
	})
})
