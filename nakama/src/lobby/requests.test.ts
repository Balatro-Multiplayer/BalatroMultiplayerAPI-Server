import { readFileSync } from 'node:fs'
import { join as pathJoin } from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import type { StepContext } from '../actions/registry'
import { fakeLogger, fakeNk, playerCtx } from '../testing/fake_nk'
import { testContext } from '../testing/request_context'
import { checkpointOf, resumeFrom } from './checkpoint'
import {
	type LobbyMatchState,
	lobbyMatchInit,
	lobbyMatchJoinAttempt,
	lobbyMatchLoop,
} from './match'
import { announceChange, revOf, unregisterMatchKey } from './match_state'
import {
	type AnswerMessage,
	ClientOp,
	PROTOCOL_VERSION,
	type RequestMessage,
	ServerOp,
	type Snapshot,
	type StateMessage,
} from './protocol'
import { PVP_PROJECTIONS } from './pvp/view'
import { BURST } from './relay'
import {
	ANSWERED_LIMIT,
	type Reducer,
	handleRequest as handleRequestWith,
	registerReducer,
	requestStep,
} from './requests'
import { SPECTATOR_ROLE } from './spectate'
import { type Lobby, type Outbound, join, leave, newLobby } from './state'

// handleRequest at a fixed clock unless the test passes its own context.
const handleRequest = (
	lobby: Lobby,
	senderId: string,
	msg: { [key: string]: unknown },
	ctx: StepContext = testContext(0),
) => handleRequestWith(lobby, senderId, msg, ctx)

// A fixture's JSON, read as loosely nested data unless the caller names a type.
interface Fx {
	[key: string]: Fx
}
function fixture<T = Fx>(name: string): T {
	return JSON.parse(
		readFileSync(
			pathJoin(__dirname, '__fixtures__', 'net-v1', `${name}.json`),
			'utf8',
		),
	)
}

const info = (name: string) => ({
	displayName: name,
	preferredJoker: null,
	mods: null,
})

function lobbyOf(ids: string[], rev?: number): Lobby {
	let lobby = newLobby({
		code: 'ABCD',
		modId: 'M',
		maxPlayers: 8,
		creatorId: ids[0],
		now: 0,
		graceMs: 60_000,
	})
	for (const id of ids) lobby = join(lobby, id, `${id}-s`, info(id), 0).lobby
	return rev === undefined ? lobby : { ...lobby, rev }
}

// The test state: metadata.n counts applied `test.inc` requests.
const count = (lobby: Lobby): number => Number(lobby.metadata.n ?? 0)
const inc: Reducer = {
	keys: { 'test.n': (lobby) => count(lobby) },
	reduce: (lobby) => ({
		ok: true,
		lobby: { ...lobby, metadata: { ...lobby.metadata, n: count(lobby) + 1 } },
		changed: ['test.n'],
	}),
}
const noop: Reducer = {
	keys: {},
	reduce: (lobby) => ({ ok: true, lobby, changed: [] }),
}
const refuse: Reducer = {
	keys: {},
	reduce: (_lobby, _sender, payload) => ({
		ok: false,
		reason: String((payload as { reason?: unknown } | null)?.reason),
	}),
}
// A refusal the reducer records in the state (a slot that happened but was refused).
const recordRefusal: Reducer = {
	keys: { 'test.n': (lobby) => count(lobby) },
	reduce: (lobby) => ({
		ok: true,
		lobby: { ...lobby, metadata: { ...lobby.metadata, n: count(lobby) + 1 } },
		changed: ['test.n'],
		refusal: { reason: 'bad_spend' },
	}),
}
// A refusal the reducer reports without recording anything.
const unrecordedRefusal: Reducer = {
	keys: {},
	reduce: (lobby) => ({
		ok: true,
		lobby,
		changed: [],
		refusal: { reason: 'no_progress' },
	}),
}

beforeAll(() => {
	registerReducer('test.recorded', recordRefusal)
	registerReducer('test.unrecorded', unrecordedRefusal)
	registerReducer('test.inc', inc)
	registerReducer('test.noop', noop)
	registerReducer('test.refuse', refuse)
})

const req = (
	reqId: string,
	type: string,
	payload: unknown = {},
): { [key: string]: unknown } => ({
	v: 1,
	reqId,
	type,
	payload,
})

const sentTo = (out: Outbound[], op: number) =>
	out.filter(
		(o): o is Extract<Outbound, { kind: 'send' }> =>
			o.kind === 'send' && o.op === op,
	)

describe('handleRequest', () => {
	it('a refusal recorded in the state carries the rev the change is in', () => {
		const r = handleRequest(
			lobbyOf(['u1', 'u2']),
			'u1',
			req('c1:1', 'test.recorded'),
		)
		expect(r.answer).toEqual({
			reqId: 'c1:1',
			ok: false,
			reason: 'bad_spend',
			rev: 2,
		})
		expect(revOf(r.lobby)).toBe(2)
		const again = handleRequest(r.lobby, 'u1', req('c1:1', 'test.recorded'))
		expect(again.answer).toEqual(r.answer)
	})

	it('a refusal that changed nothing carries no rev', () => {
		const r = handleRequest(
			lobbyOf(['u1', 'u2']),
			'u1',
			req('c1:1', 'test.unrecorded'),
		)
		expect(r.answer).toEqual({
			reqId: 'c1:1',
			ok: false,
			reason: 'no_progress',
		})
	})

	it('answers ok with the new rev and pushes STATE to every seated player', () => {
		const r = handleRequest(
			lobbyOf(['u1', 'u2']),
			'u1',
			req('c1:1', 'test.inc'),
		)
		expect(r.answer).toEqual({ reqId: 'c1:1', ok: true, rev: 2 })
		expect(revOf(r.lobby)).toBe(2)
		expect(r.pushes).toEqual([
			{
				kind: 'send',
				op: ServerOp.STATE,
				payload: { rev: 2, changed: { 'test.n': 1 } },
				to: ['u1', 'u2'],
			},
		])
	})

	it('applies a resent reqId once and returns the stored answer', () => {
		const first = handleRequest(
			lobbyOf(['u1', 'u2']),
			'u1',
			req('c1:1', 'test.inc'),
		)
		const again = handleRequest(first.lobby, 'u1', req('c1:1', 'test.inc'))
		expect(again.answer).toEqual(first.answer)
		expect(again.pushes).toEqual([])
		expect(count(again.lobby)).toBe(1)
		expect(revOf(again.lobby)).toBe(2)
	})

	it('keeps each player their own answers', () => {
		const first = handleRequest(
			lobbyOf(['u1', 'u2']),
			'u1',
			req('c1:1', 'test.inc'),
		)
		const other = handleRequest(first.lobby, 'u2', req('c1:1', 'test.inc'))
		expect(count(other.lobby)).toBe(2)
	})

	it('does not bump rev for an ok that changed nothing', () => {
		const r = handleRequest(lobbyOf(['u1']), 'u1', req('c1:1', 'test.noop'))
		expect(r.answer).toEqual({ reqId: 'c1:1', ok: true, rev: 1 })
		expect(r.pushes).toEqual([])
		expect(revOf(r.lobby)).toBe(1)
	})

	it.each([
		['unknown_type', req('c1:1', 'nope'), 'u1'],
		['bad_payload', { v: 1, reqId: 'c1:1', payload: {} }, 'u1'],
		['no_seat', req('c1:1', 'test.inc'), 'ghost'],
	])('refuses %s without touching rev', (reason, msg, sender) => {
		const lobby = lobbyOf(['u1'])
		const r = handleRequest(lobby, sender, msg)
		expect(r.answer).toEqual({ reqId: 'c1:1', ok: false, reason })
		expect(r.pushes).toEqual([])
		expect(revOf(r.lobby)).toBe(1)
	})

	it('stores terminal refusals and answers a resend the same', () => {
		const first = handleRequest(
			lobbyOf(['u1']),
			'u1',
			req('c1:1', 'test.refuse', { reason: 'round_over' }),
		)
		expect(first.lobby.answered?.u1).toHaveLength(1)
		// Even if the reducer would now say something else, the stored answer wins.
		const again = handleRequest(
			first.lobby,
			'u1',
			req('c1:1', 'test.refuse', { reason: 'bad_round' }),
		)
		expect(again.answer).toEqual({
			reqId: 'c1:1',
			ok: false,
			reason: 'round_over',
		})
	})

	it('never stores a rate_limited refusal, so a resend can succeed', () => {
		let lobby = lobbyOf(['u1'])
		let n = 0
		// Drain the bucket at one instant.
		for (; n < BURST; n++)
			lobby = handleRequest(
				lobby,
				'u1',
				req(`c1:${n}`, 'test.noop'),
				testContext(0),
			).lobby
		const limited = handleRequest(
			lobby,
			'u1',
			req('c1:late', 'test.inc'),
			testContext(0),
		)
		expect(limited.answer).toEqual({
			reqId: 'c1:late',
			ok: false,
			reason: 'rate_limited',
		})
		expect(
			(limited.lobby.answered?.u1 || []).some((e) => e.reqId === 'c1:late'),
		).toBe(false)
		const retried = handleRequest(
			limited.lobby,
			'u1',
			req('c1:late', 'test.inc'),
			testContext(60_000),
		)
		expect(retried.answer).toEqual({ reqId: 'c1:late', ok: true, rev: 2 })
	})

	it('a reducer-reported rate_limited is not stored either', () => {
		const r = handleRequest(
			lobbyOf(['u1']),
			'u1',
			req('c1:1', 'test.refuse', { reason: 'rate_limited' }),
		)
		expect(r.lobby.answered?.u1 ?? []).toEqual([])
	})

	it('drops a message with no usable reqId without an answer', () => {
		expect(
			handleRequest(lobbyOf(['u1']), 'u1', { type: 'test.inc' }).answer,
		).toBeNull()
	})

	it('keeps the last ANSWERED_LIMIT terminal answers, evicting the oldest', () => {
		let lobby = lobbyOf(['u1'])
		for (let i = 0; i < ANSWERED_LIMIT + 1; i++)
			lobby = handleRequest(
				lobby,
				'u1',
				req(`c1:${i}`, 'test.noop'),
				testContext(0 + i * 1000),
			).lobby
		const ids = (lobby.answered?.u1 || []).map((e) => e.reqId)
		expect(ids).toHaveLength(ANSWERED_LIMIT)
		expect(ids[0]).toBe('c1:1')
		expect(ids[ANSWERED_LIMIT - 1]).toBe(`c1:${ANSWERED_LIMIT}`)
		// The evicted one is applied again (a fresh request).
		const replay = handleRequest(
			lobby,
			'u1',
			req('c1:0', 'test.inc'),
			testContext((ANSWERED_LIMIT + 10) * 1000),
		)
		expect(count(replay.lobby)).toBe(1)
	})
})

describe('a burst of requests, all resent', () => {
	it('applies none of the resends, up to the rate limit burst', () => {
		let lobby = lobbyOf(['u1'])
		for (let i = 0; i < BURST; i++)
			lobby = handleRequest(lobby, 'u1', req(`c1:${i}`, 'test.inc')).lobby
		expect(count(lobby)).toBe(BURST)
		for (let i = 0; i < BURST; i++)
			lobby = handleRequest(
				lobby,
				'u1',
				req(`c1:${i}`, 'test.inc'),
				testContext(60_000),
			).lobby
		expect(count(lobby)).toBe(BURST)
	})
})

describe('snapshot request', () => {
	it('sends a full STATE before the ANSWER and never stores it', () => {
		const lobby = lobbyOf(['u1', 'u2'], 5)
		const step = requestStep(
			lobby,
			'u1',
			req('c1:1', 'snapshot'),
			testContext(0),
		)
		const ops = step.out.map((o) => (o.kind === 'send' ? o.op : -1))
		expect(ops).toEqual([ServerOp.STATE, ServerOp.ANSWER])
		const state = sentTo(step.out, ServerOp.STATE)[0]
		expect(state.to).toEqual(['u1'])
		expect(state.payload).toMatchObject({ rev: 5, full: true })
		expect((state.payload as StateMessage).changed).toHaveProperty('test.n', 0)
		expect(step.lobby.answered).toBeUndefined()
		expect(revOf(step.lobby)).toBe(5)
		// A resend gets a fresh full STATE again.
		const again = requestStep(
			step.lobby,
			'u1',
			req('c1:1', 'snapshot'),
			testContext(0),
		)
		expect(sentTo(again.out, ServerOp.STATE)).toHaveLength(1)
	})
})

describe('requestStep', () => {
	it('sends STATE to every seat and the ANSWER to the sender only', () => {
		const step = requestStep(
			lobbyOf(['u1', 'u2', 'u3']),
			'u2',
			req('c2:1', 'test.inc'),
			testContext(0),
		)
		expect(sentTo(step.out, ServerOp.STATE)[0].to).toEqual(['u1', 'u2', 'u3'])
		expect(sentTo(step.out, ServerOp.ANSWER)).toEqual([
			{
				kind: 'send',
				op: ServerOp.ANSWER,
				payload: { reqId: 'c2:1', ok: true, rev: 2 },
				to: ['u2'],
			},
		])
	})

	it('caps the type that reaches the refusal log', () => {
		const step = requestStep(
			lobbyOf(['u1']),
			'u1',
			req('c1:1', 'z'.repeat(500)),
			testContext(0),
		)
		expect(step.refused?.key).toBe(`request:${'z'.repeat(64)}`)
	})

	it('matches a reducer on the full type, capping only the logged copy', () => {
		const long = `test.${'x'.repeat(80)}`
		registerReducer(long, noop)
		const r = handleRequest(lobbyOf(['u1']), 'u1', req('c1:1', long))
		expect(r.answer?.ok).toBe(true)
		const unknown = handleRequest(
			lobbyOf(['u1']),
			'u1',
			req('c1:2', `${long}y`),
		)
		expect(unknown.refused).toEqual({
			type: long.slice(0, 64),
			reason: 'unknown_type',
		})
	})

	it('reports a refusal for the log', () => {
		const step = requestStep(
			lobbyOf(['u1']),
			'u1',
			req('c1:1', 'zzz'),
			testContext(0),
		)
		expect(step.refused).toEqual({ key: 'request:zzz', reason: 'unknown_type' })
	})

	it('spends the ACTION budget', () => {
		const step = requestStep(
			lobbyOf(['u1']),
			'u1',
			req('c1:1', 'test.noop'),
			testContext(0),
		)
		expect(step.lobby.actionBudget.u1.tokens).toBe(BURST - 1)
	})
})

describe('announceChange', () => {
	it('bumps rev once and pushes one STATE; no keys, no change', () => {
		const lobby = lobbyOf(['u1', 'u2'])
		const step = announceChange(lobby, ['test.n'])
		expect(revOf(step.lobby)).toBe(2)
		expect(step.out).toHaveLength(1)
		expect(announceChange(lobby, [])).toEqual({ lobby, out: [] })
	})
})

describe('connections and the snapshot', () => {
	it('bumps connSeq on every join and rejoin and puts the new fields in SNAPSHOT', () => {
		const lobby = newLobby({
			code: 'ABCD',
			modId: 'M',
			maxPlayers: 8,
			creatorId: 'u1',
			now: 0,
			graceMs: 60_000,
		})
		const first = join(lobby, 'u1', 's1', info('u1'), 0)
		const snap1 = sentTo(first.out, ServerOp.SNAPSHOT)[0].payload as Snapshot
		expect(snap1).toMatchObject({
			rev: 1,
			connectionId: 'c1',
			protocol: PROTOCOL_VERSION,
		})
		expect(snap1.match).toHaveProperty('test.n', 0)
		const second = join(first.lobby, 'u2', 's2', info('u2'), 0)
		expect(
			(sentTo(second.out, ServerOp.SNAPSHOT)[0].payload as Snapshot)
				.connectionId,
		).toBe('c2')
		const rejoin = join(second.lobby, 'u1', 's1b', info('u1'), 5)
		expect(
			(sentTo(rejoin.out, ServerOp.SNAPSHOT)[0].payload as Snapshot)
				.connectionId,
		).toBe('c3')
		expect(rejoin.lobby.connSeq).toBe(3)
	})

	it('reads an old lobby without rev, connSeq or answered as rev 1 and counts connections from 0', () => {
		const old = lobbyOf(['u1'])
		const { rev: _r, connSeq: _c, answered: _a, ...bare } = old
		const joined = join(bare as Lobby, 'u2', 's2', info('u2'), 0)
		expect(sentTo(joined.out, ServerOp.SNAPSHOT)[0].payload).toMatchObject({
			rev: 1,
			connectionId: 'c1',
		})
	})
})

describe('answered and the seat', () => {
	it('is dropped when the seat is removed (leave), not on disconnect', () => {
		const answered = handleRequest(
			lobbyOf(['u1', 'u2']),
			'u2',
			req('c2:1', 'test.noop'),
		).lobby
		expect(answered.answered?.u2).toHaveLength(1)
		const left = leave(answered, 'u2', 0).lobby
		expect(left.answered?.u2).toBeUndefined()
	})

	it('survives a checkpoint and resume with rev, connSeq and answered', () => {
		const stepped = handleRequest(
			lobbyOf(['u1', 'u2']),
			'u1',
			req('c1:1', 'test.inc'),
		).lobby
		const cp = checkpointOf(stepped, 100)
		expect(cp).not.toBeNull()
		const resumed = resumeFrom(JSON.parse(JSON.stringify(cp)), 200)
		expect(resumed.rev).toBe(2)
		expect(resumed.connSeq).toBe(stepped.connSeq)
		expect(resumed.answered).toEqual(stepped.answered)
		// The resent request is answered from the stored copy.
		const again = handleRequest(resumed, 'u1', req('c1:1', 'test.inc'))
		expect(count(again.lobby)).toBe(1)
	})
})

describe('joining a lobby of another mod', () => {
	const nk = fakeNk({
		accountGetId: (id: string) => ({ user: { userId: id, username: id } }),
		matchGet: () => null,
	}) as unknown as nkruntime.Nakama
	const ctx = { ...playerCtx(''), matchId: 'm1' } as nkruntime.Context
	const dispatcher = {} as unknown as nkruntime.MatchDispatcher
	const presence = {
		userId: 'u1',
		sessionId: 's',
		username: 'u1',
		node: 'n',
	} as nkruntime.Presence
	const state = lobbyMatchInit(ctx, fakeLogger, nk, {
		code: 'ABCD',
		modId: 'M',
		maxPlayers: 4,
		creatorId: 'u1',
	}).state as LobbyMatchState
	const attempt = (meta: { [key: string]: string }) =>
		lobbyMatchJoinAttempt(
			ctx,
			fakeLogger,
			nk,
			dispatcher,
			1,
			state,
			presence,
			meta,
		)

	it('lets a join in with no protocol metadata', () => {
		const r = attempt({ modId: 'M' })
		expect(r.accept).toBe(true)
	})
	it('lets a spectator in with no protocol metadata', () => {
		const open = {
			...state,
			lobby: { ...state.lobby, metadata: { ...state.lobby.metadata, spectatable: true } },
		}
		const r = lobbyMatchJoinAttempt(ctx, fakeLogger, nk, dispatcher, 1, open, presence, {
			modId: 'M',
			role: SPECTATOR_ROLE,
		})
		expect(r.accept).toBe(true)
	})
	it('lets a seated player rejoin with no protocol metadata', () => {
		const seated = { ...state, lobby: lobbyOf(['u1']) }
		const r = lobbyMatchJoinAttempt(ctx, fakeLogger, nk, dispatcher, 1, seated, presence, { modId: 'M' })
		expect(r.accept).toBe(true)
	})
})

describe('REQUEST in the match loop', () => {
	it('sends the full STATE, then the ANSWER, to the presence that asked', () => {
		const nk = fakeNk({
			binaryToString: (data: ArrayBuffer) => Buffer.from(data).toString('utf8'),
			matchLabelUpdate: () => undefined,
		}) as unknown as nkruntime.Nakama
		const calls: string[] = []
		const dispatcher = {
			broadcastMessage: (op: number, _data: string, to: { userId: string }[]) =>
				calls.push(`${op} -> ${to.map((p) => p.userId).join(',')}`),
			matchKick: () => undefined,
			matchLabelUpdate: () => undefined,
		} as unknown as nkruntime.MatchDispatcher
		const ctx = { ...playerCtx(''), matchId: 'm1' } as nkruntime.Context
		const presence = (userId: string) =>
			({
				userId,
				sessionId: `${userId}-s`,
				username: userId,
				node: 'n',
			}) as nkruntime.Presence
		const state = {
			lobby: lobbyOf(['u1', 'u2']),
			presences: { u1: presence('u1'), u2: presence('u2') },
			pendingInfo: {},
			label: '',
		} as unknown as LobbyMatchState
		const body = JSON.stringify({
			v: 1,
			reqId: 'c1:1',
			type: 'snapshot',
			payload: {},
		})
		const message = {
			sender: presence('u1'),
			opCode: ClientOp.REQUEST,
			data: new TextEncoder().encode(body).buffer,
		} as unknown as nkruntime.MatchMessage
		lobbyMatchLoop(ctx, fakeLogger, nk, dispatcher, 1, state, [message])
		expect(calls).toEqual([
			`${ServerOp.STATE} -> u1`,
			`${ServerOp.ANSWER} -> u1`,
		])
	})
})

describe('golden fixtures', () => {
	// The fixtures' match holds only pvp.ready: drop the referee keys the PvP
	// register module added.
	beforeAll(() => {
		unregisterMatchKey('test.n')
		for (const key of Object.keys(PVP_PROJECTIONS)) unregisterMatchKey(key)
	})

	const fixtureLobby = (): Lobby => {
		const base = lobbyOf(['u1', 'u2'], 11)
		return base
	}

	it('parses every fixture into the wire types', () => {
		const request: RequestMessage = fixture('request_ready')
		expect(request).toMatchObject({ v: 1, type: 'pvp.ready' })
		expect(fixture('request_blind_start')).toMatchObject({
			v: 1,
			type: 'pvp.blind_start',
		})
		const answers: AnswerMessage[] = [
			fixture('answer_ok'),
			fixture('answer_round_over'),
			fixture('answer_bad_round'),
		]
		expect(answers.map((a) => a.reqId)).toEqual(['c4:7', 'c4:7', 'c4:9'])
		const states: StateMessage[] = [
			fixture('state_ready_push'),
			fixture('state_round_started'),
			fixture('state_full'),
		]
		expect(states.map((s) => s.rev)).toEqual([12, 13, 13])
		expect(fixture('request_snapshot').type).toBe('snapshot')
	})

	it('answers pvp.ready as answer_ok and pushes state_ready_push', () => {
		const projected = fixture('state_ready_push').changed['pvp.ready']
		registerReducer('pvp.ready', {
			keys: { 'pvp.ready': () => projected },
			reduce: (lobby) => ({ ok: true, lobby, changed: ['pvp.ready'] }),
		})
		const r = handleRequest(fixtureLobby(), 'u1', fixture('request_ready'))
		expect(r.answer).toEqual(fixture('answer_ok'))
		expect((r.pushes[0] as { payload: unknown }).payload).toEqual(
			fixture('state_ready_push'),
		)
	})

	it.each([
		['answer_round_over', 'round_over'],
		['answer_bad_round', 'bad_round'],
	])('answers a refusal as %s', (name, reason) => {
		const fx = fixture(name)
		registerReducer('pvp.ready', {
			keys: {},
			reduce: () => ({ ok: false, reason }),
		})
		const r = handleRequest(fixtureLobby(), 'u1', {
			...fixture('request_ready'),
			reqId: fx.reqId,
		})
		expect(r.answer).toEqual(fx)
	})

	it('sends the snapshot exchange as snapshot_exchange: STATE full, then ANSWER', () => {
		const exchange =
			fixture<{ op: number; body: unknown }[]>('snapshot_exchange')
		const full = fixture('state_full').changed['pvp.ready']
		registerReducer('pvp.ready', {
			keys: { 'pvp.ready': () => full },
			reduce: (lobby) => ({ ok: true, lobby, changed: [] }),
		})
		const step = requestStep(
			lobbyOf(['u1', 'u2'], 13),
			'u1',
			fixture('request_snapshot'),
			testContext(0),
		)
		const wire = sentTo(step.out, ServerOp.STATE)
			.concat(sentTo(step.out, ServerOp.ANSWER))
			.map((o) => ({ op: o.op, body: o.payload }))
		expect(step.out.map((o) => (o.kind === 'send' ? o.op : -1))).toEqual(
			exchange.map((e) => e.op),
		)
		expect(wire).toEqual(exchange)
	})

	it('builds a snapshot carrying the fixture fields', () => {
		const projected = fixture('snapshot_v1').match['pvp.ready']
		registerReducer('pvp.ready', {
			keys: { 'pvp.ready': () => projected },
			reduce: (lobby) => ({ ok: true, lobby, changed: [] }),
		})
		const lobby = { ...lobbyOf(['u1']), rev: 13, connSeq: 4 }
		const snap = sentTo(
			join(lobby, 'u2', 's2', info('u2'), 0).out,
			ServerOp.SNAPSHOT,
		)[0].payload as Snapshot
		const expected = fixture('snapshot_v1')
		expect({
			rev: snap.rev,
			connectionId: snap.connectionId,
			protocol: snap.protocol,
			pvp: snap.match['pvp.ready'],
		}).toEqual({
			rev: expected.rev,
			connectionId: expected.connectionId,
			protocol: expected.protocol,
			pvp: expected.match['pvp.ready'],
		})
	})
})

describe('properties', () => {
	it('applies each distinct reqId at most once and rev is 1 + applied changes', () => {
		// Seeded sequences (mulberry32): fast-check is not a dependency of this package.
		const senders = ['u1', 'u2']
		const types = ['test.inc', 'test.noop', 'test.refuse', 'nope']
		for (let seed = 1; seed <= 200; seed++) {
			let s = seed
			const rnd = (n: number): number => {
				s = (s + 0x6d2b79f5) | 0
				let t = Math.imul(s ^ (s >>> 15), 1 | s)
				t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
				return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * n)
			}
			let lobby = lobbyOf(['u1', 'u2'])
			const seen = new Set<string>()
			let applied = 0
			let at = 0
			for (let i = 0, len = rnd(41); i < len; i++) {
				const sender = senders[rnd(2)]
				const type = types[rnd(types.length)]
				const reqId = `${sender}:${rnd(7)}`
				const first = !seen.has(reqId)
				seen.add(reqId)
				at += 1000
				const r = handleRequest(
					lobby,
					sender,
					req(reqId, type, { reason: 'round_over' }),
					testContext(at),
				)
				if (first && type === 'test.inc') applied++
				lobby = r.lobby
			}
			expect(count(lobby), `seed ${seed}`).toBe(applied)
			expect(revOf(lobby), `seed ${seed}`).toBe(1 + applied)
		}
	})
})

describe('ClientOp.REQUEST', () => {
	it('is op 8 and ANSWER/STATE are 114/115', () => {
		expect([ClientOp.REQUEST, ServerOp.ANSWER, ServerOp.STATE]).toEqual([
			8, 114, 115,
		])
	})
})
