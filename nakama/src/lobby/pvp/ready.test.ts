import { readFileSync } from 'node:fs'
import { join as pathJoin } from 'node:path'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { seedFromHex } from '../../actions/registry'
import { finishGame } from '../../actions/results'
import { testContext } from '../../testing/request_context'
import { checkpointOf, resumeFrom } from '../checkpoint'
import {
	announceChange,
	announceDrift,
	changedKeys,
	revOf,
} from '../match_state'
import { ServerOp, type StateMessage } from '../protocol'
import { action } from '../relay'
import { type RequestResult, handleRequest, requestStep } from '../requests'
import {
	type Lobby,
	type Outbound,
	type Step,
	disconnect,
	join,
	leave,
	newLobby,
	tick,
} from '../state'
import {
	gameAfterResume,
	projectReady,
	pvpOf,
	readyDroppedOnDisconnect,
	requiredIds,
	startIfReady,
	tryStart,
} from './ready'
import { emptyFacts } from './state'
import { type PvpLifePlayer, type StoredPvp, emptyPvp } from './state'

const info = (name: string) => ({
	displayName: name,
	preferredJoker: null,
	mods: null,
})

const actionCtx = (runId: string) => ({
	now: 1000,
	newSeed: () => seedFromHex('ab'.repeat(16)),
	newId: () => runId,
	random: () => 0,
})

function seated(ids: string[]): Lobby {
	let lobby = newLobby({
		code: 'ABCD',
		modId: 'MultiplayerSPDRN',
		maxPlayers: 8,
		creatorId: ids[0],
		now: 0,
		graceMs: 10_000,
	})
	for (const id of ids) lobby = join(lobby, id, `${id}-s`, info(id), 0).lobby
	return lobby
}

// A game started through the real actions: everyone ready, the host starts.
function started(ids: string[], runId = 'RUN1'): Lobby {
	let lobby = seated(ids)
	for (const id of ids.slice(1))
		lobby = action(
			lobby,
			id,
			{
				cid: `r-${id}`,
				action: 'mpapi_ready',
				to: 'server',
				params: { ready: true },
			},
			actionCtx(runId),
		).lobby
	return action(
		lobby,
		ids[0],
		{ cid: 's', action: 'mpapi_start_game', to: 'server', params: {} },
		actionCtx(runId),
	).lobby
}

// A PvP blind.
const PVP_BLIND = '2:Boss'

function fixture<T = unknown>(name: string): T {
	return JSON.parse(
		readFileSync(
			pathJoin(__dirname, '..', '__fixtures__', 'net-v1', `${name}.json`),
			'utf8',
		),
	)
}

// A clock that moves on with every request, so the rate budget refills.
let clock = 1000
const tick1 = (): number => {
	clock += 1000
	return clock
}
let counter = 0
function ask(
	lobby: Lobby,
	from: string,
	type: string,
	payload: unknown,
	reqId = `c1:${++counter}`,
): RequestResult {
	return handleRequest(
		lobby,
		from,
		{ v: 1, reqId, type, payload },
		testContext(tick1()),
	)
}

const ready = (
	lobby: Lobby,
	from: string,
	hands = 4,
	roundId = (pvpOf(lobby)?.round ?? 0) + 1,
	runId = lobby.game.started?.runId ?? '',
	blindKey: unknown = PVP_BLIND,
) =>
	ask(lobby, from, 'pvp.ready', {
		runId,
		roundId,
		startingHands: hands,
		blindKey,
	})
const unready = (lobby: Lobby, from: string) =>
	ask(lobby, from, 'pvp.unready', {
		runId: lobby.game.started?.runId,
		roundId: (pvpOf(lobby)?.round ?? 0) + 1,
	})
const key = (lobby: Lobby) => pvpOf(lobby)
const states = (outbound: Outbound[]): StateMessage[] =>
	outbound
		.filter((o) => o.kind === 'send' && o.op === ServerOp.STATE)
		.map(
			(o) => (o as Extract<Outbound, { kind: 'send' }>).payload as StateMessage,
		)
const refusal = (r: RequestResult) =>
	r.answer && !r.answer.ok ? r.answer.reason : null

describe('tryStart', () => {
	const base = {
		runId: 'r1',
		round: 0,
		ready: { u1: true, u2: true } as { [id: string]: boolean },
		blindKeys: { u1: PVP_BLIND } as { [id: string]: string },
		firstReady: 'u1' as string | null,
		order: ['u1', 'u2'],
		readied: ['u1', 'u2'],
		lastStart: null,
	}

	it('starts with a key for every starter', () => {
		const next = tryStart(
			{ ...base, blindKeys: { u1: PVP_BLIND, u2: PVP_BLIND } },
			['u1', 'u2'],
		)
		expect(next.lastStart?.blindKeys).toEqual({ u1: PVP_BLIND, u2: PVP_BLIND })
	})
})

describe('pvp.ready', () => {
	it('starts a round when both players are ready, carrying firstReady and the hands', () => {
		const first = ready(started(['u1', 'u2']), 'u2', 5)
		expect(first.answer).toEqual({
			reqId: expect.any(String),
			ok: true,
			rev: 2,
		})
		expect(key(first.lobby)?.firstReady).toBe('u2')
		expect(key(first.lobby)?.round).toBe(0)

		const second = ready(first.lobby, 'u1', 4)
		const pvp = key(second.lobby)
		expect(pvp?.round).toBe(1)
		expect(pvp?.lastStart).toEqual({
			roundId: 1,
			firstPlayer: 'u2',
			players: ['u2', 'u1'],
			blindKeys: { u1: PVP_BLIND, u2: PVP_BLIND },
		})
		expect(pvp?.ready).toEqual({})
		expect(pvp?.firstReady).toBeNull()
	})

	it('pushes match the golden fixtures (rev 11 -> 12 -> 13)', () => {
		const lastStart = {
			roundId: 2,
			firstPlayer: 'u2',
			players: ['u1', 'u2'],
			blindKeys: { u1: '1:Boss', u2: '1:Boss' },
		}
		const base = started(['u1', 'u2'], 'r-abc')
		const lobby: Lobby = {
			...base,
			rev: 11,
			game: {
				...base.game,
				pvp: {
					runId: 'r-abc',
					round: 2,
					ready: {},
					blindKeys: {},
					firstReady: null,
					order: [],
					readied: [],
					lastStart,
				},
			},
		}
		const first = ready(lobby, 'u1', 4)
		const wire = (r: RequestResult) =>
			JSON.parse(JSON.stringify(states(r.pushes)))
		expect(wire(first)).toEqual([fixture('state_ready_push')])
		const second = ready(first.lobby, 'u2', 5)
		expect(wire(second)).toEqual([fixture('state_round_started')])
	})

	it('with no game the key is the idle value of the fixture', () => {
		const idle = fixture<{ changed: { [key: string]: unknown } }>('state_idle')
		expect(projectReady(seated(['u1', 'u2']))).toEqual(
			idle.changed['pvp.ready'],
		)
		expect(JSON.parse(JSON.stringify(projectReady(seated(['u1']))))).toEqual(
			idle.changed['pvp.ready'],
		)
	})

	it('exposes exactly the documented shape (no internal order list)', () => {
		const r = ready(started(['u1', 'u2']), 'u1')
		const shown = states(r.pushes)[0].changed['pvp.ready'] as object
		expect(Object.keys(shown).sort()).toEqual([
			'firstReady',
			'lastStart',
			'ready',
			'round',
			'runId',
		])
	})

	it('unready hands firstReady to the earliest remaining ready player', () => {
		let lobby = started(['u1', 'u2', 'u3'])
		lobby = ready(lobby, 'u1').lobby
		lobby = ready(lobby, 'u2').lobby
		expect(key(lobby)?.firstReady).toBe('u1')
		lobby = unready(lobby, 'u1').lobby
		expect(key(lobby)?.firstReady).toBe('u2')
		expect(key(lobby)?.ready).toEqual({ u2: true })
		lobby = unready(lobby, 'u2').lobby
		expect(key(lobby)?.firstReady).toBeNull()
	})

	it('a repeat Ready, and an Unready of a player not ready, change nothing', () => {
		const first = ready(started(['u1', 'u2', 'u3']), 'u1')
		const again = ready(first.lobby, 'u1', 9)
		expect(again.answer?.ok).toBe(true)
		expect(again.pushes).toEqual([])
		expect(revOf(again.lobby)).toBe(revOf(first.lobby))
		const idle = unready(first.lobby, 'u2')
		expect(idle.answer?.ok).toBe(true)
		expect(revOf(idle.lobby)).toBe(revOf(first.lobby))
	})

	it.each([
		['no game running', () => seated(['u1', 'u2']), 'u1', {}, 'no_game'],
		[
			'sender not a participant',
			() => join(started(['u1', 'u2']), 'u9', 'u9-s', info('u9'), 0).lobby,
			'u9',
			{ runId: 'RUN1', roundId: 1, startingHands: 4, blindKey: PVP_BLIND },
			'no_seat',
		],
		[
			'payload is not an object',
			() => started(['u1', 'u2']),
			'u1',
			'x',
			'bad_payload',
		],
		[
			'runId missing',
			() => started(['u1', 'u2']),
			'u1',
			{ roundId: 1, startingHands: 4, blindKey: PVP_BLIND },
			'bad_payload',
		],
		[
			'roundId fractional',
			() => started(['u1', 'u2']),
			'u1',
			{ runId: 'RUN1', roundId: 1.5, startingHands: 4, blindKey: PVP_BLIND },
			'bad_payload',
		],
		[
			'stale runId',
			() => started(['u1', 'u2']),
			'u1',
			{ runId: 'OLD', roundId: 1, startingHands: 4, blindKey: PVP_BLIND },
			'round_over',
		],
		[
			'round already started',
			() => started(['u1', 'u2']),
			'u1',
			{ runId: 'RUN1', roundId: 0, startingHands: 4, blindKey: PVP_BLIND },
			'round_over',
		],
		[
			'round too far ahead',
			() => started(['u1', 'u2']),
			'u1',
			{ runId: 'RUN1', roundId: 2, startingHands: 4, blindKey: PVP_BLIND },
			'bad_round',
		],
	])('refuses: %s', (_name, make, from, payload, reason) => {
		const r = ask(make(), from, 'pvp.ready', payload)
		expect(refusal(r)).toBe(reason)
		expect(r.pushes).toEqual([])
	})

	it.each([[[]], [101], [-1], [1.5], ['4'], [null], [undefined]])(
		'ignores a leftover startingHands %j: the Ready is accepted',
		(hands) => {
			const r = ask(started(['u1', 'u2']), 'u1', 'pvp.ready', {
				runId: 'RUN1',
				roundId: 1,
				startingHands: hands,
				blindKey: PVP_BLIND,
			})
			expect(r.answer?.ok).toBe(true)
			expect(key(r.lobby)?.ready).toEqual({ u1: true })
			expect(key(r.lobby)).not.toHaveProperty('startingHands')
		},
	)

	it('refuses a Ready for a round that already started (round_over)', () => {
		let lobby = started(['u1', 'u2'])
		lobby = ready(lobby, 'u1').lobby
		lobby = ready(lobby, 'u2').lobby
		const late = ask(lobby, 'u1', 'pvp.ready', {
			runId: 'RUN1',
			roundId: 1,
			startingHands: 4,
			blindKey: PVP_BLIND,
		})
		expect(refusal(late)).toBe('round_over')
		expect(
			refusal(ask(lobby, 'u1', 'pvp.unready', { runId: 'RUN1', roundId: 1 })),
		).toBe('round_over')
		expect(
			refusal(ask(lobby, 'u1', 'pvp.unready', { runId: 'RUN1', roundId: 3 })),
		).toBe('bad_round')
	})
})

describe('readied', () => {
	it('starts empty', () => {
		expect(key(started(['u1', 'u2']))?.readied).toEqual([])
	})

	it('survives an Unready and a repeat Ready, in press order', () => {
		let lobby = started(['u1', 'u2', 'u3'])
		lobby = ready(lobby, 'u2').lobby
		lobby = ready(lobby, 'u1').lobby
		lobby = unready(lobby, 'u2').lobby
		expect(key(lobby)?.ready).toEqual({ u1: true })
		expect(key(lobby)?.readied).toEqual(['u2', 'u1'])
		lobby = ready(lobby, 'u2').lobby
		expect(key(lobby)?.readied).toEqual(['u2', 'u1'])
	})

	it('survives a disconnect that drops the Ready', () => {
		let lobby = started(['u1', 'u2'])
		lobby = ready(lobby, 'u1').lobby
		lobby = readyDroppedOnDisconnect(lobby, 'u1').lobby
		expect(key(lobby)?.ready).toEqual({})
		expect(key(lobby)?.readied).toEqual(['u1'])
	})

	it('is cleared by the round start', () => {
		let lobby = started(['u1', 'u2'])
		lobby = ready(lobby, 'u1').lobby
		lobby = unready(lobby, 'u1').lobby
		lobby = ready(lobby, 'u1').lobby
		lobby = ready(lobby, 'u2').lobby
		expect(key(lobby)?.round).toBe(1)
		expect(key(lobby)?.readied).toEqual([])
	})

	it('keeps a Ready for the next round that lands while this one is open', () => {
		let lobby = started(['u1', 'u2'])
		lobby = ready(lobby, 'u1').lobby
		lobby = ready(lobby, 'u2').lobby
		expect(key(lobby)?.round).toBe(1)
		lobby = ready(lobby, 'u1', 4, 2, 'RUN1', '3:Boss').lobby
		expect(key(lobby)?.readied).toEqual(['u1'])
	})

	it('tryStart clears it and nothing else does', () => {
		const pvp = {
			runId: 'RUN1',
			round: 0,
			ready: { u1: true, u2: true },
			firstReady: 'u1',
			blindKeys: { u1: PVP_BLIND, u2: PVP_BLIND },
			order: ['u1', 'u2'],
			readied: ['u1', 'u2'],
			lastStart: null,
		}
		expect(tryStart(pvp, ['u1', 'u2']).readied).toEqual([])
		expect(tryStart(pvp, ['u1', 'u2', 'u3']).readied).toEqual(['u1', 'u2'])
	})
})

describe('disconnect (#620)', () => {
	it('drops the Ready, announces it, and blocks a start against a player in grace', () => {
		let lobby = started(['u1', 'u2'])
		lobby = ready(lobby, 'u2').lobby
		const rev = revOf(lobby)
		const dropped = disconnect(lobby, 'u2', 'u2-s', 2000)
		expect(key(dropped.lobby)?.ready).toEqual({})
		expect(key(dropped.lobby)?.firstReady).toBeNull()
		expect(revOf(dropped.lobby)).toBe(rev + 1)
		expect(states(dropped.out)).toHaveLength(1)
		expect(states(dropped.out)[0].rev).toBe(rev + 1)

		const alone = ready(dropped.lobby, 'u1')
		expect(key(alone.lobby)?.round).toBe(0)
		expect(key(alone.lobby)?.ready).toEqual({ u1: true })

		// Back and ready again: now the round starts.
		const back = join(alone.lobby, 'u2', 'u2-s2', info('u2'), 3000).lobby
		const both = ready(back, 'u2')
		expect(key(both.lobby)?.round).toBe(1)
	})

	it('pushes nothing when the dropped player was not ready', () => {
		const lobby = ready(started(['u1', 'u2']), 'u1').lobby
		const dropped = disconnect(lobby, 'u2', 'u2-s', 2000)
		expect(states(dropped.out)).toEqual([])
		expect(revOf(dropped.lobby)).toBe(revOf(lobby))
	})
})

describe('seat removal', () => {
	it('N=3: two ready, the third grace runs out -> the round starts once', () => {
		let lobby = started(['u1', 'u2', 'u3'])
		lobby = ready(lobby, 'u1', 3).lobby
		lobby = ready(lobby, 'u2', 4).lobby
		lobby = disconnect(lobby, 'u3', 'u3-s', 2000).lobby
		expect(key(lobby)?.round).toBe(0)

		const expired = tick(lobby, 2000 + 10_000)
		const pvp = key(expired.lobby)
		expect(pvp?.round).toBe(1)
		expect(pvp?.lastStart).toEqual({
			roundId: 1,
			firstPlayer: 'u1',
			players: ['u1', 'u2'],
			blindKeys: { u1: PVP_BLIND, u2: PVP_BLIND },
		})
		expect(states(expired.out)).toHaveLength(1)
		const again = tick(expired.lobby, 2000 + 20_000)
		expect(key(again.lobby)?.round).toBe(1)
		expect(states(again.out)).toEqual([])
	})

	it('lastStart.players lists exactly the players who were ready; a rejoiner who was not in the start is not listed', () => {
		let lobby = started(['u1', 'u2', 'u3'])
		lobby = ready(lobby, 'u2').lobby
		lobby = ready(lobby, 'u1').lobby
		lobby = disconnect(lobby, 'u3', 'u3-s', 2000).lobby
		lobby = tick(lobby, 2000 + 10_000).lobby
		expect(key(lobby)?.lastStart?.players).toEqual(['u2', 'u1'])
		const back = join(lobby, 'u3', 'u3-s2', info('u3'), 13_000).lobby
		expect(key(back)?.lastStart?.players).toEqual(['u2', 'u1'])
		expect(projectReady(back)).toMatchObject({
			lastStart: { players: ['u2', 'u1'] },
		})
	})

	it('N=2: one leaves -> no solo round', () => {
		const lobby = ready(started(['u1', 'u2']), 'u1').lobby
		const left = leave(lobby, 'u2', 3000)
		const pvp = key(left.lobby)
		expect(pvp?.round).toBe(0)
		expect(pvp?.ready).toEqual({ u1: true })
		expect(states(left.out)).toEqual([])
	})

	it('a leaver that was ready loses their Ready and the others hear it', () => {
		let lobby = started(['u1', 'u2', 'u3'])
		lobby = ready(lobby, 'u3').lobby
		const left = leave(lobby, 'u3', 3000)
		expect(key(left.lobby)?.ready).toEqual({})
		const pushed = states(left.out)
		expect(pushed).toHaveLength(1)
		expect(
			left.out.find((o) => o.kind === 'send' && o.op === ServerOp.STATE),
		).toMatchObject({ to: ['u1', 'u2'] })
	})
})

describe('resume after a server restart', () => {
	it('clears Ready but keeps runId, round and lastStart; one Ready does not start', () => {
		let lobby = started(['u1', 'u2'])
		lobby = ready(lobby, 'u1').lobby
		lobby = ready(lobby, 'u2').lobby
		expect(key(lobby)?.round).toBe(1)
		lobby = ready(lobby, 'u2', 4, 2, 'RUN1', '3:Boss').lobby
		expect(key(lobby)?.ready).toEqual({ u2: true })

		const checkpoint = checkpointOf(lobby, 5000)
		expect(checkpoint).not.toBeNull()
		if (!checkpoint) throw new Error('no checkpoint')
		const resumed = resumeFrom(checkpoint, 6000)
		const pvp = key(resumed)
		expect(pvp).toMatchObject({
			runId: 'RUN1',
			round: 1,
			ready: {},
			firstReady: null,
			order: [],
		})
		expect(pvp?.lastStart?.roundId).toBe(1)

		const one = ready(resumed, 'u1', 4, 2, 'RUN1', '3:Boss')
		expect(key(one.lobby)?.round).toBe(1)
	})
})

// The referee's seats for a started game, as the tick leaves them.
function refereed(
	lobby: Lobby,
	seats: { [id: string]: Partial<PvpLifePlayer> },
	runId = lobby.game.started?.runId ?? '',
): Lobby {
	const base = pvpOf(lobby)
	if (!base) throw new Error('no game')
	const players: { [id: string]: PvpLifePlayer } = {}
	for (const p of lobby.game.started?.players ?? [])
		players[p.id] = {
			lives: 4,
			eliminated: false,
			forfeited: false,
			left: false,
			events: [],
			...seats[p.id],
		}
	const referee: NonNullable<StoredPvp['referee']> = {
		...emptyPvp(),
		facts: emptyFacts(),
		lives: { runId, players, teamLives: null, pending: [] },
	}
	const pvp: StoredPvp = { ...base, referee }
	return { ...lobby, game: { ...lobby.game, pvp } }
}

// pvp.out is gone: which players the round waits on is the referee's call (R31,
// below), never a client's. The request is answered like any unknown type.
describe('pvp.out is no longer a request', () => {
	it.each([
		['the host', 'u1'],
		['a guest', 'u2'],
	])(
		'%s asking for it is refused as unknown_type, and nothing changes',
		(_who, from) => {
			const lobby = ready(started(['u1', 'u2', 'u3']), 'u1').lobby
			const r = ask(lobby, from, 'pvp.out', { ids: ['u3'] })
			expect(refusal(r)).toBe('unknown_type')
			expect(r.pushes).toEqual([])
			expect(key(r.lobby)).toEqual(key(lobby))
		},
	)
})

// R31: a player the referee holds out of the run (eliminated, forfeited or left)
// is not waited on.
describe('pvp.ready and the referee (R31)', () => {
	const OUT: [string, Partial<PvpLifePlayer>][] = [
		['eliminated', { lives: 0, eliminated: true }],
		['forfeited', { forfeited: true }],
		['left but still seated', { left: true }],
	]

	it.each(OUT)(
		'%s: the other two are enough, the round starts on their Ready',
		(_what, seat) => {
			const lobby = refereed(started(['u1', 'u2', 'u3']), { u3: seat })
			const first = ready(lobby, 'u1')
			expect(key(first.lobby)?.round).toBe(0)
			const second = ready(first.lobby, 'u2')
			expect(key(second.lobby)?.round).toBe(1)
			expect(key(second.lobby)?.lastStart).toMatchObject({ roundId: 1 })
		},
	)

	it.each(OUT)('%s: requiredIds leaves them out', (_what, seat) => {
		const lobby = refereed(started(['u1', 'u2', 'u3']), { u3: seat })
		const pvp = pvpOf(lobby)
		if (!pvp) throw new Error('no game')
		expect(requiredIds(lobby)).toEqual(['u1', 'u2'])
	})

	it.each(OUT)(
		'%s: their own Ready is refused as eliminated',
		(_what, seat) => {
			const lobby = refereed(started(['u1', 'u2', 'u3']), { u3: seat })
			expect(refusal(ready(lobby, 'u3'))).toBe('eliminated')
			expect(key(lobby)?.ready).toEqual({})
		},
	)

	it('a Ready made before the player went out does not let a repeat through', () => {
		let lobby = ready(started(['u1', 'u2', 'u3']), 'u3').lobby
		lobby = refereed(lobby, { u3: { lives: 0, eliminated: true } })
		expect(refusal(ready(lobby, 'u3'))).toBe('eliminated')
	})

	it('a player still in the run is waited on', () => {
		let lobby = refereed(started(['u1', 'u2', 'u3']), {})
		lobby = ready(ready(lobby, 'u1').lobby, 'u2').lobby
		expect(key(lobby)?.round).toBe(0)
		expect(key(ready(lobby, 'u3').lobby)?.round).toBe(1)
	})

	it('a referee state of another run is never read', () => {
		const lobby = refereed(
			started(['u1', 'u2', 'u3']),
			{ u3: { lives: 0, eliminated: true } },
			'OTHER',
		)
		const pvp = pvpOf(lobby)
		if (!pvp) throw new Error('no game')
		expect(requiredIds(lobby)).toEqual(['u1', 'u2', 'u3'])
		expect(refusal(ready(lobby, 'u3'))).toBeNull()
	})

	it('a seat the referee has not written yet is waited on', () => {
		const lobby = started(['u1', 'u2', 'u3'])
		const pvp = pvpOf(lobby)
		if (!pvp) throw new Error('no game')
		expect(requiredIds(lobby)).toEqual(['u1', 'u2', 'u3'])
	})

	it('two players out of three leave one required: nothing starts', () => {
		let lobby = refereed(started(['u1', 'u2', 'u3']), {
			u2: { forfeited: true },
			u3: { lives: 0, eliminated: true },
		})
		lobby = ready(lobby, 'u1').lobby
		expect(key(lobby)?.round).toBe(0)
	})

	it('startIfReady starts the round once the out set has grown, and only then', () => {
		let lobby = ready(
			ready(started(['u1', 'u2', 'u3']), 'u1').lobby,
			'u2',
		).lobby
		expect(startIfReady(lobby)).toEqual(lobby)
		lobby = refereed(lobby, { u3: { lives: 0, eliminated: true } })
		const started1 = startIfReady(lobby)
		expect(key(started1)?.round).toBe(1)
		expect(startIfReady(started1)).toEqual(started1)
	})

	it('startIfReady clears the Ready, hands and firstReady of the player put out', () => {
		let lobby = started(['u1', 'u2', 'u3'])
		lobby = ready(lobby, 'u2', 7).lobby
		lobby = ready(lobby, 'u3', 6).lobby
		lobby = refereed(lobby, { u2: { forfeited: true } })
		const pvp = key(startIfReady(lobby, ['u2']))
		expect(pvp?.ready).toEqual({ u3: true })
		expect(pvp?.firstReady).toBe('u3')
		expect(pvp?.round).toBe(0)
	})

	it('with every other player out, no solo round starts', () => {
		let lobby = ready(started(['u1', 'u2', 'u3']), 'u1').lobby
		lobby = refereed(lobby, {
			u2: { forfeited: true },
			u3: { lives: 0, eliminated: true },
		})
		expect(key(startIfReady(lobby, ['u2', 'u3']))?.round).toBe(0)
	})

	it('a seat removed after a referee hold leaves the round to the others', () => {
		let lobby = ready(
			ready(started(['u1', 'u2', 'u3']), 'u1').lobby,
			'u2',
		).lobby
		lobby = refereed(lobby, { u3: { left: true } })
		const gone = leave(lobby, 'u3', 3000)
		expect(key(gone.lobby)?.round).toBe(1)
		expect(states(gone.out)).toHaveLength(1)
	})
})

// Each player's own blindKey of their Ready goes to the tick (the PvP guard
// key), and never to a client.
describe('pvp.ready blindKeys', () => {
	it("keeps each ready player's key, and starts the round with all of them", () => {
		let lobby = ready(
			started(['u1', 'u2', 'u3']),
			'u1',
			4,
			1,
			'RUN1',
			'3:Boss',
		).lobby
		lobby = ready(lobby, 'u2', 4, 1, 'RUN1', '2:Boss').lobby
		expect(key(lobby)?.blindKeys).toEqual({ u1: '3:Boss', u2: '2:Boss' })
		lobby = ready(lobby, 'u3', 4, 1, 'RUN1', '2:Boss').lobby
		expect(key(lobby)?.lastStart?.blindKeys).toEqual({
			u1: '3:Boss',
			u2: '2:Boss',
			u3: '2:Boss',
		})
		expect(key(lobby)?.blindKeys).toEqual({})
	})

	it('an Unready takes the key with it', () => {
		let lobby = ready(started(['u1', 'u2']), 'u1', 4, 1, 'RUN1', '3:Boss').lobby
		lobby = unready(lobby, 'u1').lobby
		expect(key(lobby)?.blindKeys).toEqual({})
	})

	it('a resume after a server restart voids the keys with the Ready', () => {
		const lobby = ready(started(['u1', 'u2']), 'u1').lobby
		const resumed = gameAfterResume(lobby.game)
		expect(resumed.pvp?.blindKeys).toEqual({})
	})

	it('pvp.ready does not project the keys, in the key or in lastStart', () => {
		let lobby = ready(started(['u1', 'u2']), 'u1', 4, 1, 'RUN1', '3:Boss').lobby
		lobby = ready(lobby, 'u2', 4, 1, 'RUN1', '2:Boss').lobby
		expect(projectReady(lobby)).toEqual({
			runId: 'RUN1',
			round: 1,
			ready: {},
			firstReady: null,
			lastStart: {
				roundId: 1,
				firstPlayer: 'u1',
				players: ['u1', 'u2'],
			},
		})
	})
})

describe('pvp.ready blindKey', () => {
	const lobbyOfTwo = (): Lobby => started(['u1', 'u2'])

	it.each([
		['a Boss blind', '3:Boss', true],
		// A Manhunt voucher lowers the ante after the PvP Boss was set.
		['a Boss blind below the PvP start ante', '1:Boss', true],
		['a Boss blind at ante 0', '0:Boss', true],
		['a Small blind', '3:Small', false],
		['a Big blind', '3:Big', false],
	])('%s', (_name, blindKey, accepted) => {
		const r = ready(lobbyOfTwo(), 'u1', 4, 1, 'RUN1', blindKey)
		expect(refusal(r)).toBe(accepted ? null : 'not_pvp_blind')
		expect(r.answer?.ok).toBe(accepted)
	})

	it('does not read the PvP start ante the host publishes', () => {
		const lobby = lobbyOfTwo()
		const late = {
			...lobby,
			metadata: { ...lobby.metadata, pvp_start_round: 5 },
		}
		expect(ready(late, 'u1', 4, 1, 'RUN1', '2:Boss').answer?.ok).toBe(true)
	})

	it.each([
		['missing', undefined],
		['a number', 5],
		['null', null],
		['an object', { ante: 2, blind: 'Boss' }],
		['only the blind', 'Boss'],
		['an unknown blind', '2:Bossy'],
		['wrong case', '2:boss'],
		['a negative ante', '-1:Boss'],
		['a fractional ante', '2.5:Boss'],
		['empty', ''],
		['a trailing newline', '2:Boss\n'],
	])('refuses a blindKey that is %s as bad_payload', (_name, blindKey) => {
		const payload = { runId: 'RUN1', roundId: 1, startingHands: 4 }
		const r = ask(
			started(['u1', 'u2']),
			'u1',
			'pvp.ready',
			blindKey === undefined ? payload : { ...payload, blindKey },
		)
		expect(refusal(r)).toBe('bad_payload')
		expect(r.pushes).toEqual([])
	})

	describe('a Ready for the blind the round just started on', () => {
		const running = (): Lobby => {
			const first = ready(lobbyOfTwo(), 'u1', 4, 1, 'RUN1', '2:Boss')
			return ready(first.lobby, 'u2', 4, 1, 'RUN1', '2:Boss').lobby
		}

		it('is refused as round_over and changes nothing', () => {
			const lobby = running()
			expect(pvpOf(lobby)?.round).toBe(1)
			const r = ready(lobby, 'u1', 4, 2, 'RUN1', '2:Boss')
			expect(refusal(r)).toBe('round_over')
			expect(r.pushes).toEqual([])
			expect(pvpOf(r.lobby)?.ready).toEqual({})
			expect(pvpOf(r.lobby)?.round).toBe(1)
		})

		it('starts no second round when both press it in the countdown', () => {
			let lobby = running()
			lobby = ready(lobby, 'u1', 4, 2, 'RUN1', '2:Boss').lobby
			lobby = ready(lobby, 'u2', 4, 2, 'RUN1', '2:Boss').lobby
			expect(pvpOf(lobby)?.round).toBe(1)
		})

		it('lets the next blind through, and the same key after another blind', () => {
			const lobby = running()
			const next = ready(lobby, 'u1', 4, 2, 'RUN1', '3:Boss')
			expect(next.answer?.ok).toBe(true)
			expect(pvpOf(next.lobby)?.blindKeys).toEqual({ u1: '3:Boss' })
		})

		it('compares each sender with their own started blind', () => {
			const first = ready(lobbyOfTwo(), 'u1', 4, 1, 'RUN1', '2:Boss')
			const lobby = ready(first.lobby, 'u2', 4, 1, 'RUN1', '1:Boss').lobby
			expect(pvpOf(lobby)?.lastStart?.blindKeys).toEqual({
				u1: '2:Boss',
				u2: '1:Boss',
			})
			expect(refusal(ready(lobby, 'u2', 4, 2, 'RUN1', '2:Boss'))).toBeNull()
			expect(refusal(ready(lobby, 'u2', 4, 2, 'RUN1', '1:Boss'))).toBe(
				'round_over',
			)
		})
	})

	it('checks the seat, then the round, then the blind', () => {
		const lobby = lobbyOfTwo()
		const smallBlind = '1:Small'
		expect(refusal(ready(lobby, 'u9', 4, 1, 'RUN1', smallBlind))).toBe(
			'no_seat',
		)
		expect(refusal(ready(lobby, 'u1', 4, 1, 'OLD', smallBlind))).toBe(
			'round_over',
		)
		expect(refusal(ready(lobby, 'u1', 4, 2, 'RUN1', smallBlind))).toBe(
			'bad_round',
		)
		expect(refusal(ready(lobby, 'u1', 4, 1, 'RUN1', smallBlind))).toBe(
			'not_pvp_blind',
		)
	})

	it('a refused Ready leaves the lobby unchanged and starts no round', () => {
		const lobby = ready(lobbyOfTwo(), 'u1', 4, 1, 'RUN1', '3:Boss').lobby
		const refused = ready(lobby, 'u2', 4, 1, 'RUN1', '3:Big')
		expect(refusal(refused)).toBe('not_pvp_blind')
		expect(refused.pushes).toEqual([])
		expect(revOf(refused.lobby)).toBe(revOf(lobby))
		expect(key(refused.lobby)).toEqual(key(lobby))
		expect(key(refused.lobby)?.round).toBe(0)
		expect(key(refused.lobby)?.lastStart).toBeNull()
		expect(key(refused.lobby)?.ready).toEqual({ u1: true })
	})

	it('a repeat Ready on a PvP blind stays a no-op', () => {
		const first = ready(lobbyOfTwo(), 'u1', 4, 1, 'RUN1', '4:Boss')
		const again = ready(first.lobby, 'u1', 9, 1, 'RUN1', '3:Boss')
		expect(again.answer?.ok).toBe(true)
		expect(again.pushes).toEqual([])
		expect(key(again.lobby)).toEqual(key(first.lobby))
	})

	it('the round starts once both players ready on Boss blinds', () => {
		let lobby = lobbyOfTwo()
		lobby = ready(lobby, 'u1', 4, 1, 'RUN1', '3:Boss').lobby
		lobby = ready(lobby, 'u2', 4, 1, 'RUN1', '1:Boss').lobby
		expect(key(lobby)?.round).toBe(1)
	})

	it('accepts a Ready exactly when the blind is a Boss blind, at any ante', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 40 }),
				fc.constantFrom('Small', 'Big', 'Boss'),
				(ante, blind) => {
					const r = ready(lobbyOfTwo(), 'u1', 4, 1, 'RUN1', `${ante}:${blind}`)
					const isPvp = blind === 'Boss'
					expect(r.answer?.ok).toBe(isPvp)
					expect(refusal(r)).toBe(isPvp ? null : 'not_pvp_blind')
				},
			),
			{ numRuns: 200 },
		)
	})
})

describe('socket drop', () => {
	it('answers a resent request from the stored answer; the round starts once', () => {
		let lobby = started(['u1', 'u2'])
		// Ready applied on the server, the answer never arrived.
		const lost = ask(
			lobby,
			'u1',
			'pvp.ready',
			{ runId: 'RUN1', roundId: 1, startingHands: 4, blindKey: PVP_BLIND },
			'c1:1',
		)
		lobby = lost.lobby
		// The socket drops and u1 rejoins on a new connection.
		lobby = disconnect(lobby, 'u1', 'u1-s', 2000).lobby
		const rejoined = join(lobby, 'u1', 'u1-s2', info('u1'), 3000)
		lobby = rejoined.lobby
		expect(lobby.connSeq).toBe(3)
		// The disconnect dropped the Ready, so the resend must NOT re-apply it.
		const resent = ask(
			lobby,
			'u1',
			'pvp.ready',
			{ runId: 'RUN1', roundId: 1, startingHands: 4, blindKey: PVP_BLIND },
			'c1:1',
		)
		expect(resent.answer).toEqual(lost.answer)
		expect(resent.pushes).toEqual([])
		expect(key(resent.lobby)?.ready).toEqual({})
		// u1 readies again on the new connection, then u2: one start.
		lobby = ready(resent.lobby, 'u1', 4).lobby
		lobby = ready(lobby, 'u2', 4).lobby
		expect(key(lobby)?.round).toBe(1)
		const replay = ask(
			lobby,
			'u1',
			'pvp.ready',
			{ runId: 'RUN1', roundId: 1, startingHands: 4, blindKey: PVP_BLIND },
			'c1:1',
		)
		expect(replay.answer).toEqual(lost.answer)
		expect(key(replay.lobby)?.round).toBe(1)
	})

	it('a lost answer with no drop: the resend returns the stored answer, nothing changes', () => {
		const first = ask(
			started(['u1', 'u2']),
			'u1',
			'pvp.ready',
			{ runId: 'RUN1', roundId: 1, startingHands: 4, blindKey: PVP_BLIND },
			'c1:1',
		)
		const lobby = ready(first.lobby, 'u2').lobby
		expect(key(lobby)?.round).toBe(1)
		const resent = ask(
			lobby,
			'u1',
			'pvp.ready',
			{ runId: 'RUN1', roundId: 1, startingHands: 4, blindKey: PVP_BLIND },
			'c1:1',
		)
		expect(resent.answer).toEqual(first.answer)
		expect(key(resent.lobby)?.round).toBe(1)
	})
})

describe('game start, restart and end', () => {
	const restart = (lobby: Lobby, runId: string): Step =>
		action(
			lobby,
			lobby.hostId,
			{ cid: 'x', action: 'mpapi_restart_game', to: 'server', params: {} },
			{ ...actionCtx(runId), now: tick1() },
		)

	it('a start announces the new key (round 0, new runId)', () => {
		const before = seated(['u1', 'u2'])
		const lobby = started(['u1', 'u2'])
		const step = announceDrift(before, { lobby, out: [] })
		expect(revOf(step.lobby)).toBe(2)
		expect(states(step.out)[0].changed['pvp.ready']).toMatchObject({
			runId: 'RUN1',
			round: 0,
			lastStart: null,
		})
	})

	it('a restart gives a new runId and round 0, announced once', () => {
		let lobby = started(['u1', 'u2'])
		lobby = ready(lobby, 'u1').lobby
		lobby = ready(lobby, 'u2').lobby
		expect(key(lobby)?.round).toBe(1)
		const restarted = restart(lobby, 'RUN2')
		const step = announceDrift(lobby, restarted)
		expect(key(step.lobby)).toMatchObject({
			runId: 'RUN2',
			round: 0,
			lastStart: null,
		})
		expect(revOf(step.lobby)).toBe(revOf(lobby) + 1)
		expect(states(step.out)).toHaveLength(1)
		// The old run's Ready is stale now.
		const stale = ask(step.lobby, 'u1', 'pvp.ready', {
			runId: 'RUN1',
			roundId: 2,
			startingHands: 4,
			blindKey: PVP_BLIND,
		})
		expect(refusal(stale)).toBe('round_over')
		expect(ready(step.lobby, 'u1').answer?.ok).toBe(true)
	})

	it('the end of the game announces the idle value, never null', () => {
		const lobby = ready(started(['u1', 'u2']), 'u1').lobby
		const finished = finishGame(lobby, 9000)
		const step = announceDrift(lobby, finished)
		expect(states(step.out)[0].changed['pvp.ready']).toEqual({
			runId: null,
			round: 0,
			ready: {},
			firstReady: null,
			lastStart: null,
		})
	})

	it('a request whose settle ends the game announces the idle value after its own change', () => {
		const base = started(['u1', 'u2'])
		// The result clock ran out long ago: the request's settle finishes the game.
		const lobby: Lobby = {
			...base,
			rev: 5,
			resultTimeoutMs: 1000,
			game: { ...base.game, settleFrom: 0 },
		}
		const step = requestStep(
			lobby,
			'u1',
			{
				v: 1,
				reqId: 'c1:1',
				type: 'pvp.ready',
				payload: {
					runId: 'RUN1',
					roundId: 1,
					startingHands: 4,
					blindKey: PVP_BLIND,
				},
			},
			testContext(50_000),
		)
		const pushed = states(step.out)
		expect(pushed.map((p) => p.rev)).toEqual([6, 7])
		expect((pushed[0].changed['pvp.ready'] as { runId: string }).runId).toBe(
			'RUN1',
		)
		expect(pushed[1].changed['pvp.ready']).toEqual(projectReady(seated(['u1'])))
		expect(revOf(step.lobby)).toBe(7)
		expect(step.lobby.game.started).toBeNull()
	})

	it('announces nothing when the key did not change, or the step announced itself', () => {
		const lobby = started(['u1', 'u2'])
		expect(announceDrift(lobby, { lobby, out: [] }).out).toEqual([])
		const r = ready(lobby, 'u1')
		expect(announceDrift(lobby, { lobby: r.lobby, out: r.pushes }).out).toEqual(
			r.pushes,
		)
	})
})

describe('properties', () => {
	type Op =
		| { kind: 'ready'; who: number; hands: number }
		| { kind: 'unready'; who: number }
		| { kind: 'disconnect'; who: number }
		| { kind: 'rejoin'; who: number }
		// The referee holds the player out of the run (R31).
		| { kind: 'hold'; who: number }

	const who = fc.integer({ min: 0, max: 2 })
	const op: fc.Arbitrary<Op> = fc.oneof(
		fc.record({
			kind: fc.constant('ready' as const),
			who,
			hands: fc.integer({ min: 1, max: 9 }),
		}),
		fc.record({ kind: fc.constant('unready' as const), who }),
		fc.record({ kind: fc.constant('disconnect' as const), who }),
		fc.record({ kind: fc.constant('rejoin' as const), who }),
		fc.record({ kind: fc.constant('hold' as const), who }),
	)
	const ids = ['u1', 'u2', 'u3']

	it('never starts a round with a required player not ready, and round never decreases', () => {
		fc.assert(
			fc.property(fc.array(op, { maxLength: 40 }), (ops) => {
				let lobby = started(ids)
				const sessions: { [id: string]: string } = {}
				for (const p of ids) sessions[p] = `${p}-s`
				let session = 0
				const held: { [id: string]: Partial<PvpLifePlayer> } = {}
				for (const o of ops) {
					const before = pvpOf(lobby)?.round ?? 0
					const id = ids[o.who]
					let after: Lobby
					let pushed = 0
					const request = (r: RequestResult): Lobby => {
						pushed = states(r.pushes).length
						return r.lobby
					}
					if (o.kind === 'ready') {
						// A request from an away player marks them back first (requestStep).
						const away =
							lobby.players.find((p) => p.id === id)?.awaySince !== null
						after = away ? lobby : request(ready(lobby, id, o.hands))
					} else if (o.kind === 'unready') {
						after = request(unready(lobby, id))
					} else if (o.kind === 'disconnect') {
						const step = disconnect(lobby, id, sessions[id], 2000)
						pushed = states(step.out).length
						after = step.lobby
					} else if (o.kind === 'rejoin') {
						session += 1
						sessions[id] = `${id}-s${session}`
						after = join(lobby, id, sessions[id], info(id), 3000).lobby
					} else {
						// What the tick does when the referee puts a player out: the
						// referee seats change, the Ready of the player put out is dropped
						// and the round starts if the rest are ready (readyAfterOut), then
						// the change is announced once.
						held[id] = { left: true }
						const next = startIfReady(refereed(lobby, held), [id])
						const step = announceChange(next, changedKeys(lobby, next))
						pushed = states(step.out).length
						after = step.lobby
					}
					// The rev goes up by exactly one when the key changed, and not otherwise;
					// every change is pushed once.
					const changed =
						o.kind === 'hold'
							? changedKeys(lobby, after).length > 0
							: JSON.stringify(projectReady(lobby)) !==
								JSON.stringify(projectReady(after))
					expect(revOf(after) - revOf(lobby)).toBe(changed ? 1 : 0)
					if (o.kind !== 'rejoin') expect(pushed).toBe(changed ? 1 : 0)
					const pvp = pvpOf(after)
					const round = pvp?.round ?? 0
					expect(round).toBeGreaterThanOrEqual(before)
					if (round > before && pvp?.lastStart) {
						// Every required player (seated, not held out by the referee) was in
						// the start.
						const required = ids.filter((p) => held[p] === undefined)
						expect(required.length).toBeGreaterThanOrEqual(2)
						for (const p of required)
							expect(pvp.lastStart.blindKeys?.[p]).toBeDefined()
						// A player in grace was never counted ready.
						for (const p of after.players)
							if (p.awaySince !== null && held[p.id] === undefined)
								throw new Error(`round started against ${p.id} in grace`)
					}
					lobby = after
				}
			}),
			{ numRuns: 300 },
		)
	})
})
