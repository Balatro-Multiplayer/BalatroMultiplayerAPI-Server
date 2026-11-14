// The opponent facts as the live match runs them: the six requests through
// handleRequest, how a refusal reaches the client, per-viewer announcements, and the
// crash rejoin. Real modes and the real tick: only the lobby's start is scripted.
import { describe, expect, it } from 'vitest'
import { seedFromHex } from '../../actions/registry'
import { raced } from '../../testing/pvp_fixtures'
import { withRules } from '../../testing/pvp_rules'
import { testContext } from '../../testing/request_context'
import { type Checkpoint, checkpointOf, resumeFrom } from '../checkpoint'
import {
	announceChange,
	changedKeys,
	matchKeys,
	matchStateOf,
} from '../match_state'
import { ServerOp, type StateMessage } from '../protocol'
import { action } from '../relay'
import { handleRequest } from '../requests'
import {
	type Lobby,
	type Outbound,
	join,
	newLobby,
	snapshotFor,
} from '../state'
import {
	MAX_EFFECTS_PER_ACTOR,
	MAX_PLANTS_PER_PLANTER,
	MAX_SLOTS_PER_PLAYER,
} from './opponent_facts'
import {
	PVP_EFFECTS_KEY,
	PVP_NEMESIS_KEY,
	PVP_OPPONENT_KEY,
	PVP_TRAPS_KEY,
	type TrapRecord,
} from './opponent_state'
import { NO_ENDS, pvpTick as tickWith } from './pvp_tick'
import { PVP_REQUESTS } from './register'
import { refereeOf, withReferee } from './state'
import { projectNemesisFor } from './view'

// These tests end no game, so the tick gets no ends: reaching one throws.
const pvpTick = (
	lobby: Parameters<typeof tickWith>[0],
	ctx: Parameters<typeof tickWith>[1],
) => tickWith(lobby, ctx, NO_ENDS)

const info = (name: string) => ({
	displayName: name,
	preferredJoker: null,
	mods: null,
})

const actionCtx = {
	now: 1000,
	newSeed: () => seedFromHex('ab'.repeat(16)),
	newId: () => 'r1',
	random: () => 0,
}
const ctx = testContext(1000)

// A started Nemesis game (two players unless told otherwise) with the tick's first pass done (the rules are
// frozen and the opponent records seeded).
function running(
	ids: string[] = ['a', 'b'],
	queueMode = 'pvp_nemesis',
): Lobby {
	let lobby = newLobby({
		code: 'ABCD',
		modId: 'MultiplayerPvP',
		maxPlayers: 8,
		creatorId: ids[0],
		now: 0,
		graceMs: 10_000,
	})
	lobby = {
		...lobby,
		metadata: withRules({ ruleset: 'ruleset_mp_traditional', queue_mode: queueMode }),
	}
	for (const id of ids) lobby = join(lobby, id, `${id}-s`, info(id), 0).lobby
	for (const id of ids.slice(1))
		lobby = action(
			lobby,
			id,
			{ cid: 'r', action: 'mpapi_ready', to: 'server', params: { ready: true } },
			actionCtx,
		).lobby
	lobby = action(
		lobby,
		ids[0],
		{ cid: 's', action: 'mpapi_start_game', to: 'server', params: {} },
		actionCtx,
	).lobby
	return pvpTick(raced(lobby), ctx).lobby
}

function checkpointed(lobby: Lobby): Checkpoint {
	const cp = checkpointOf(lobby, 2000)
	if (cp === null) throw new Error('no checkpoint')
	return cp
}

const runIdOf = (lobby: Lobby): string => {
	const state = refereeOf(lobby)
	if (!state) throw new Error('no game')
	return state.runId
}

let reqs = 0
function ask(
	lobby: Lobby,
	sender: string,
	type: string,
	payload: { [key: string]: unknown },
	reqId = `q${++reqs}`,
) {
	// A fresh request budget each time: the rate limit is not under test here.
	return handleRequest(
		{ ...lobby, actionBudget: {} },
		sender,
		{ reqId, type, payload: { runId: runIdOf(lobby), ...payload } },
		ctx,
	)
}

// Both players at `ante` (pvp.progress), so a sell or effect has a progress to read.
function atAnte(lobby: Lobby, ante: number): Lobby {
	let next = lobby
	for (const id of lobby.players.map((p) => p.id)) {
		const r = ask(next, id, 'pvp.progress', { ante, furthestBlind: 0 })
		expect(r.answer).toMatchObject({ ok: true })
		next = r.lobby
	}
	return next
}

const statesTo = (pushes: Outbound[], to: string): StateMessage[] =>
	pushes
		.filter(
			(o) => o.kind === 'send' && o.op === ServerOp.STATE && o.to.includes(to),
		)
		.map(
			(o) => (o as Extract<Outbound, { kind: 'send' }>).payload as StateMessage,
		)

describe('the requests are registered', () => {
	it.each([
		'pvp.sell',
		'pvp.shop',
		'pvp.effect',
		'pvp.trap_plant',
		'pvp.trap_fire',
		'pvp.trap_lost',
	])('%s has a reducer', (type) => {
		expect(PVP_REQUESTS[type]).toBeDefined()
	})

	it.each([
		['pvp.sell', { ante: 1 }],
		['pvp.shop', { spent: 0 }],
		['pvp.effect', { kind: 'asteroid' }],
		['pvp.trap_plant', { key: 'c_x' }],
		['pvp.trap_fire', { trapId: 0 }],
		['pvp.trap_lost', { trapId: 0 }],
	])('%s with no game running is not_running', (type, payload) => {
		const lobby = newLobby({
			code: 'ABCD',
			modId: 'MultiplayerPvP',
			maxPlayers: 8,
			creatorId: 'a',
			now: 0,
			graceMs: 10_000,
		})
		const joined = join(lobby, 'a', 'a-s', info('a'), 0).lobby
		const r = handleRequest(
			joined,
			'a',
			{ reqId: 'x', type, payload: { runId: 'r', ...payload } },
			ctx,
		)
		expect(r.answer).toEqual({ reqId: 'x', ok: false, reason: 'not_running' })
	})

	it('a seated player who is not in the running game is no_seat', () => {
		const lobby = running()
		const late = join(lobby, 'c', 'c-s', info('c'), 5).lobby
		const r = ask(late, 'c', 'pvp.sell', { ante: 1 })
		expect(r.answer).toEqual({
			ok: false,
			reqId: r.answer?.reqId,
			reason: 'no_seat',
		})
	})
})

describe('a recorded sell', () => {
	it('is answered ok and shown in pvp.opponent to every viewer', () => {
		const lobby = atAnte(running(), 2)
		const r = ask(lobby, 'a', 'pvp.sell', { ante: 2 })
		expect(r.answer).toMatchObject({ ok: true })
		const op = refereeOf(r.lobby)?.facts.opponent.players.a
		expect(op?.sells).toEqual({ '2': 1 })
		const toA = statesTo(r.pushes, 'a')[0]
		const toB = statesTo(r.pushes, 'b')[0]
		expect(toA.changed[PVP_OPPONENT_KEY]).toMatchObject({
			players: { a: { sells: { '2': 1 }, closed: false } },
		})
		expect(toB.changed[PVP_OPPONENT_KEY]).toBeDefined()
		expect(toA.changed[PVP_EFFECTS_KEY]).toBeUndefined()
		expect(toB.changed[PVP_EFFECTS_KEY]).toBeUndefined()
		expect(toB.rev).toBe(toA.rev)
	})

	it('a resend of an accepted request by its reqId is ok and changes nothing', () => {
		const lobby = atAnte(running(), 2)
		const first = ask(lobby, 'a', 'pvp.sell', { ante: 2 }, 'rq')
		const again = ask(first.lobby, 'a', 'pvp.sell', { ante: 2 }, 'rq')
		expect(again.answer).toMatchObject({ ok: true })
		expect(again.pushes).toEqual([])
		expect(refereeOf(again.lobby)?.facts.opponent.players.a.sells).toEqual({
			'2': 1,
		})
	})
})

describe('how a refusal reaches the client', () => {
	it('is ok:false with the reason, and records nothing', () => {
		const lobby = atAnte(running(), 2)
		const r = ask(lobby, 'a', 'pvp.sell', { ante: 9 }, 'rq')
		expect(r.answer).toEqual({ reqId: 'rq', ok: false, reason: 'bad_ante' })
		expect(r.refused).toEqual({ type: 'pvp.sell', reason: 'bad_ante' })
		expect(r.changed).toBe(false)
		expect(refereeOf(r.lobby)?.facts.opponent.players.a.sells).toEqual({})
	})

	it('a resend of the same reqId gets the stored answer, once', () => {
		const lobby = atAnte(running(), 2)
		const first = ask(lobby, 'a', 'pvp.sell', { ante: 9 }, 'rq')
		const second = ask(first.lobby, 'a', 'pvp.sell', { ante: 9 }, 'rq')
		expect(second.answer).toEqual(first.answer)
		expect(second.pushes).toEqual([])
	})
})

describe('a crash rejoin', () => {
	it('every player comes back away, the tick does not set left, and requests are not eliminated', () => {
		const lobby = atAnte(running(), 2)
		const resumed = resumeFrom(checkpointed(lobby), 9000)
		expect(resumed.players.every((p) => p.awaySince !== null)).toBe(true)
		// A tick while everyone is away: seated, so not left.
		const ticked = pvpTick(resumed, testContext(9500)).lobby
		for (const id of ['a', 'b'])
			expect(refereeOf(ticked)?.lives.players[id].left).toBe(false)
		const back = join(ticked, 'a', 'a-s2', info('a'), 9600).lobby
		const r = ask(back, 'a', 'pvp.sell', { ante: 2 })
		expect(r.answer).toMatchObject({ ok: true })
	})

	it('the records ride through the checkpoint', () => {
		const lobby = atAnte(running(), 2)
		const sold = ask(lobby, 'a', 'pvp.sell', { ante: 2 }).lobby
		const stored = JSON.parse(JSON.stringify(checkpointOf(sold, 2000)))
		const back = join(
			pvpTick(resumeFrom(stored, 9000), testContext(9500)).lobby,
			'a',
			'a-s2',
			info('a'),
			9600,
		).lobby
		expect(refereeOf(back)?.facts.opponent.players.a.sells).toEqual({ '2': 1 })
	})
})

describe('pvp.nemesis and pvp.effects per viewer', () => {
	it('each viewer is sent their own value, and a viewer whose value did not change is sent no key', () => {
		const lobby = atAnte(running(), 2)
		const r = ask(lobby, 'a', 'pvp.effect', { kind: 'pizza' })
		expect(r.answer).toMatchObject({ ok: true })
		const toA = statesTo(r.pushes, 'a')[0]
		const toB = statesTo(r.pushes, 'b')[0]
		// The target is sent the incoming effect; the sender's own list did not move,
		// so it is sent no effects key.
		expect(toA.changed[PVP_EFFECTS_KEY]).toBeUndefined()
		expect(toB.changed[PVP_EFFECTS_KEY]).toMatchObject({
			me: { incoming: [{ from: 'a', n: 1, kind: 'pizza', amount: 1 }] },
		})
		expect(toA.rev).toBe(toB.rev)
		// A sell moves no effects list: nobody is sent the key.
		const sold = ask(lobby, 'a', 'pvp.sell', { ante: 2 })
		for (const id of ['a', 'b'])
			expect(
				statesTo(sold.pushes, id)[0].changed[PVP_EFFECTS_KEY],
			).toBeUndefined()
	})

	it('a viewer is sent only their own nemesis rows, and each message equals the projection', () => {
		const lobby = atAnte(running(), 2)
		const ticked = pvpTick(lobby, testContext(1500))
		const facts = refereeOf(ticked.lobby)?.facts
		expect(facts?.nemesis.a?.[2]).toBeDefined()
		const announced = announceChange(
			ticked.lobby,
			changedKeys(lobby, ticked.lobby),
			lobby,
		).out
		const toA = statesTo(announced, 'a')[0]
		const toB = statesTo(announced, 'b')[0]
		expect(toA.changed[PVP_NEMESIS_KEY]).toEqual(
			projectNemesisFor(ticked.lobby, 'a'),
		)
		expect(toB.changed[PVP_NEMESIS_KEY]).toEqual(
			projectNemesisFor(ticked.lobby, 'b'),
		)
		// Each side's rows target the other seat, so the two messages differ and
		// neither carries the other's row.
		expect(toA.changed[PVP_NEMESIS_KEY]).toMatchObject({
			byAnte: { 2: { each: ['b'] } },
		})
		expect(toB.changed[PVP_NEMESIS_KEY]).toMatchObject({
			byAnte: { 2: { each: ['a'] } },
		})
		expect(JSON.stringify(toA.changed[PVP_NEMESIS_KEY])).not.toEqual(
			JSON.stringify(toB.changed[PVP_NEMESIS_KEY]),
		)
	})
})

describe('the tick seeds the records at the start of the run', () => {
	it('every started player has every opponent record', () => {
		const facts = refereeOf(running())?.facts
		if (!facts) throw new Error('no game')
		for (const id of ['a', 'b']) {
			expect(facts.opponent.players[id]).toBeDefined()
			expect(facts.effects.players[id]).toEqual({ incoming: [] })
			expect(facts.nemesis[id]).toBeDefined()
			expect(facts.server.players[id]).toBeDefined()
		}
		expect(facts.traps.traps).toEqual([])
	})

	it('the first pass freezes the pairing for the ante the player reports', () => {
		const lobby = pvpTick(atAnte(running(), 2), ctx).lobby
		const rows = refereeOf(lobby)?.facts.nemesis.a
		expect(rows?.[2]).toEqual({ each: ['b'], one: 'b' })
	})
})

describe('the four keys in the projection', () => {
	it('are registered, and the per-viewer two are named but sent only with a viewer', () => {
		const keys = matchKeys()
		for (const k of [
			PVP_NEMESIS_KEY,
			PVP_OPPONENT_KEY,
			PVP_EFFECTS_KEY,
			PVP_TRAPS_KEY,
		])
			expect(keys).toContain(k)
		const lobby = atAnte(running(), 2)
		const blind = matchStateOf(lobby)
		expect(blind[PVP_OPPONENT_KEY]).toBeDefined()
		expect(blind[PVP_TRAPS_KEY]).toBeDefined()
		expect(blind[PVP_NEMESIS_KEY]).toBeUndefined()
		expect(blind[PVP_EFFECTS_KEY]).toBeUndefined()
	})

	it('a viewer gets their own rows; a non-player gets null', () => {
		const lobby = pvpTick(atAnte(running(), 2), ctx).lobby
		const own = matchStateOf(lobby, matchKeys(), false, 'a')
		expect(own[PVP_NEMESIS_KEY]).toMatchObject({ byAnte: { 2: { one: 'b' } } })
		expect(own[PVP_EFFECTS_KEY]).toMatchObject({ me: { incoming: [] } })
		const out = matchStateOf(lobby, matchKeys(), false, 'nobody')
		expect(out[PVP_NEMESIS_KEY]).toMatchObject({ byAnte: null })
		expect(out[PVP_EFFECTS_KEY]).toMatchObject({ me: null })
	})

	it('the snapshot a player joins with carries the viewer own value', () => {
		const lobby = atAnte(running(), 2)
		const sold = ask(lobby, 'a', 'pvp.effect', { kind: 'pizza' }).lobby
		const toB = snapshotFor(sold, 'b', 1000).match[PVP_EFFECTS_KEY]
		const toA = snapshotFor(sold, 'a', 1000).match[PVP_EFFECTS_KEY]
		expect(toB).toMatchObject({ me: { incoming: [{ from: 'a' }] } })
		expect(toA).toMatchObject({ me: { incoming: [] } })
	})

	it('the detection projections see a change to either per-viewer key', () => {
		const lobby = atAnte(running(), 2)
		const effect = ask(lobby, 'a', 'pvp.effect', { kind: 'pizza' }).lobby
		expect(changedKeys(lobby, effect)).toContain(PVP_EFFECTS_KEY)
		const frozen = ask(lobby, 'a', 'pvp.progress', {
			ante: 3,
			furthestBlind: 0,
		}).lobby
		expect(changedKeys(lobby, pvpTick(frozen, ctx).lobby)).toContain(
			PVP_NEMESIS_KEY,
		)
	})

	it('a refused slot is projected with its reason', () => {
		const lobby = atAnte(running(), 2)
		const r = ask(lobby, 'a', 'pvp.shop', { skipped: true })
		const shown = JSON.stringify(matchStateOf(r.lobby)[PVP_OPPONENT_KEY])
		expect(shown).toContain('"slots":[{"ante":2,"refused":"skip_missing"}]')
	})
})

describe('the tick closes the opponent record of a player who is out', () => {
	it('a forfeit closes the record on the next tick, announced once', () => {
		const lobby = atAnte(running(['a', 'b', 'c']), 2)
		const forfeited = ask(lobby, 'a', 'pvp.forfeit', {}).lobby
		expect(refereeOf(forfeited)?.facts.opponent.players.a.closed).toBe(false)
		const ticked = pvpTick(forfeited, ctx).lobby
		expect(refereeOf(ticked)?.facts.opponent.players.a.closed).toBe(true)
		expect(refereeOf(ticked)?.facts.opponent.players.b.closed).toBe(false)
		expect(changedKeys(forfeited, ticked)).toContain(PVP_OPPONENT_KEY)
		const again = pvpTick(ticked, ctx).lobby
		expect(changedKeys(ticked, again)).not.toContain(PVP_OPPONENT_KEY)
	})

	it('a player who left the lobby is closed too', () => {
		const lobby = atAnte(running(['a', 'b', 'c']), 2)
		const gone = { ...lobby, players: lobby.players.filter((p) => p.id !== 'c') }
		const ticked = pvpTick(gone, ctx).lobby
		expect(refereeOf(ticked)?.facts.opponent.players.c.closed).toBe(true)
		expect(changedKeys(gone, ticked)).toContain(PVP_OPPONENT_KEY)
	})
})

describe('a rejoin keeps the records', () => {
	it('a player who goes away and comes back within grace is not answered eliminated', () => {
		const lobby = atAnte(running(['a', 'b', 'c']), 2)
		const away = {
			...lobby,
			players: lobby.players.map((p) =>
				p.id === 'a' ? { ...p, awaySince: 2000 } : p,
			),
		}
		const ticked = pvpTick(away, testContext(5000)).lobby
		expect(refereeOf(ticked)?.lives.players.a.left).toBe(false)
		const back = join(ticked, 'a', 'a-s2', info('a'), 6000).lobby
		expect(back.players.find((p) => p.id === 'a')?.awaySince).toBeNull()
		const r = ask(back, 'a', 'pvp.sell', { ante: 2 })
		expect(r.answer).toMatchObject({ ok: true })
	})

	it('the resumed snapshot replays the effect, the trap and the nemesis rows unchanged', () => {
		let lobby = pvpTick(atAnte(running(), 2), testContext(1500)).lobby
		// a hits b with an effect, and a trap a plants is held by b.
		const effect = ask(lobby, 'a', 'pvp.effect', { kind: 'pizza' })
		expect(effect.answer).toMatchObject({ ok: true })
		const plant = ask(effect.lobby, 'a', 'pvp.trap_plant', {
			key: 'c_mp_trap_web',
		})
		expect(plant.answer).toMatchObject({ ok: true })
		lobby = plant.lobby
		const before = snapshotFor(lobby, 'b', 1500)
		const beforeMatch = before.match as { [key: string]: unknown }
		expect(beforeMatch[PVP_EFFECTS_KEY]).toMatchObject({
			me: { incoming: [{ from: 'a', n: 1, kind: 'pizza' }] },
		})
		expect(beforeMatch[PVP_TRAPS_KEY]).toMatchObject({
			traps: [{ key: 'c_mp_trap_web', owner: 'a', holder: 'b', state: 'live' }],
		})
		const stored = JSON.parse(JSON.stringify(checkpointOf(lobby, 2000)))
		const back = join(
			pvpTick(resumeFrom(stored, 9000), testContext(9500)).lobby,
			'b',
			'b-s2',
			info('b'),
			9600,
		).lobby
		const after = snapshotFor(back, 'b', 9600).match as { [key: string]: unknown }
		for (const key of [PVP_EFFECTS_KEY, PVP_TRAPS_KEY, PVP_NEMESIS_KEY])
			expect(after[key]).toEqual(beforeMatch[key])
		expect(after[PVP_NEMESIS_KEY]).toMatchObject({ byAnte: { 2: { each: ['a'] } } })
	})
})

describe('the size of the records at the worst case', () => {
	// A Manhunt runner with 7 hunters, 36-char ids, every actor at every cap.
	const id = (name: string): string => name.padEnd(36, '0')
	const runner = id('runner')
	const hunters = Array.from({ length: 7 }, (_, i) => id(`hunter${i}`))
	const seats = [runner, ...hunters]
	const ANTES = 54
	// The longest Web fire data the validators accept: a 64-char consumable key and a
	// 32-char set name.
	const WEB_DATA = { key: `c_${'x'.repeat(62)}`, set: 'y'.repeat(32) }
	const LONGEST_TRAP_KEY = 'c_mp_trap_programmed_illusion'

	function full(): Lobby {
		const lobby = running(seats, 'pvp_manhunt')
		const state = refereeOf(lobby)
		if (!state) throw new Error('no game')
		const opponent: typeof state.facts.opponent = { players: {} }
		const effects: typeof state.facts.effects = { players: {} }
		const nemesis: typeof state.facts.nemesis = {}
		const traps: TrapRecord[] = []
		for (const seat of seats) {
			const others = seats.filter((o) => o !== seat)
			const sells: { [ante: string]: number } = {}
			const rows: (typeof state.facts.nemesis)[string] = {}
			for (let ante = 1; ante <= ANTES; ante++) {
				sells[String(ante)] = 999
				rows[ante] = {
					each: seat === runner ? hunters : [runner],
					one: others[0],
				}
			}
			opponent.players[seat] = {
				sells,
				slots: Array.from({ length: MAX_SLOTS_PER_PLAYER }, (_, i) => ({
					ante: 10 + (i % 40),
					refused: 'skip_missing',
				})),
				closed: false,
			}
			// The runner is hit by every hunter up to the cap each; a hunter by the runner.
			const senders = seat === runner ? hunters : [runner]
			effects.players[seat] = {
				incoming: senders.flatMap((from) =>
					Array.from({ length: MAX_EFFECTS_PER_ACTOR }, (_, i) => ({
						from,
						n: i + 1,
						kind: 'gambling' as const,
						amount: 10,
					})),
				),
			}
			nemesis[seat] = rows
			// 448 traps: the runner plants 32 for each hunter, each hunter 32 for the runner.
			for (const holder of seat === runner ? hunters : [runner])
				for (let i = 0; i < MAX_PLANTS_PER_PLANTER; i++)
					traps.push({
						id: traps.length,
						key: LONGEST_TRAP_KEY,
						owner: seat,
						holder,
						state: { fired: WEB_DATA },
					})
		}
		expect(traps).toHaveLength(448)
		return withReferee(lobby, {
			...state,
			facts: {
				...state.facts,
				opponent,
				effects,
				nemesis,
				traps: { trapSeq: traps.length, traps },
			},
		})
	}

	const bytes = (value: unknown): number =>
		new TextEncoder().encode(JSON.stringify(value)).length

	it('the four keys are under 512 KiB and the whole STATE under 640 KiB, for the runner', () => {
		const lobby = full()
		const match = matchStateOf(lobby, matchKeys(), false, runner)
		const four = bytes({
			[PVP_NEMESIS_KEY]: match[PVP_NEMESIS_KEY],
			[PVP_OPPONENT_KEY]: match[PVP_OPPONENT_KEY],
			[PVP_EFFECTS_KEY]: match[PVP_EFFECTS_KEY],
			[PVP_TRAPS_KEY]: match[PVP_TRAPS_KEY],
		})
		const whole = bytes(snapshotFor(lobby, runner, 1000))
		// The fixture is the worst case and may not quietly shrink: nemesis 18,052 +
		// opponent 51,810 + effects 230,457 + traps 124,472 = 424,851 B measured.
		expect(four).toBeGreaterThanOrEqual(420_000)
		expect(four).toBeLessThan(524_288)
		expect(whole).toBeLessThan(655_360)
	})

})

describe('changedKeys projects only the keys whose facts moved', () => {
	it('a tick that changes one fact names that key and does not re-read the others', () => {
		const before = running(['a', 'b', 'c'])
		const state = refereeOf(before)
		if (!state) throw new Error('no game')
		// Only the traps record is replaced: the opponent record is the same object,
		// so a change made behind the reducers' backs to it is not looked at.
		const moved = withReferee(before, {
			...state,
			facts: {
				...state.facts,
				traps: {
					trapSeq: 1,
					traps: [
						{ id: 0, key: 'c_mp_trap_web', owner: 'a', holder: 'b', state: 'live' },
					],
				},
			},
		})
		expect(changedKeys(before, moved)).toEqual([PVP_TRAPS_KEY])
		state.facts.opponent.players.a.closed = true
		expect(changedKeys(before, moved)).toEqual([PVP_TRAPS_KEY])
		// A new opponent record is seen.
		const opened = withReferee(before, {
			...state,
			facts: {
				...state.facts,
				opponent: { players: { ...state.facts.opponent.players } },
			},
		})
		expect(changedKeys(before, opened)).toEqual([])
		expect(
			changedKeys(
				before,
				withReferee(before, {
					...state,
					facts: {
						...state.facts,
						opponent: {
							players: {
								...state.facts.opponent.players,
								a: { ...state.facts.opponent.players.a, closed: false },
							},
						},
					},
				}),
			),
		).toEqual([PVP_OPPONENT_KEY])
	})
})
