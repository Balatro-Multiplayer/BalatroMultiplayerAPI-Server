import { describe, expect, it } from 'vitest'
import {
	atAnte,
	opponentState,
	withOut,
} from '../../testing/pvp_fixtures'
import {
	EFFECT_KINDS,
	MAX_EFFECTS_PER_ACTOR,
	MAX_SLOTS_PER_PLAYER,
	MAX_SPEND,
	isEffectKind,
	reduceEffect,
	reduceSell,
	reduceShop,
	syncClosed,
} from './opponent_facts'
import {
	type OpponentResult,
	type OpponentState,
	PVP_OPPONENT_KEY,
	type Slot,
} from './opponent_state'

const RUN = 'run-1'

const duel = (over: Parameters<typeof opponentState>[0] = {}): OpponentState =>
	opponentState({
		mode: 'nemesis',
		ids: ['a', 'b'],
		partners: { a: 'b', b: 'a' },
		pvpStartAnte: 2,
		...over,
	})

// The state after a request that must be accepted.
function must(result: OpponentResult): OpponentState {
	if (!result.ok) throw new Error(`refused: ${result.reason}`)
	return result.state
}

const replyOf = (result: OpponentResult): unknown =>
	result.ok ? result.reply : result.reason

// The state with `id`'s recorded blind slots replaced.
const withPlayerSlots = (
	state: OpponentState,
	id: string,
	slots: Slot[],
): OpponentState => ({
	...state,
	facts: {
		...state.facts,
		opponent: {
			players: {
				...state.facts.opponent.players,
				[id]: { ...state.facts.opponent.players[id], slots },
			},
		},
	},
})

describe('every request: refusals that record nothing', () => {
	it.each([
		['sell', reduceSell, { runId: RUN, ante: 1 }],
		['effect', reduceEffect, { runId: RUN, kind: 'pizza' }],
		['shop', reduceShop, { runId: RUN, spent: 0 }],
	] as const)('%s: missing runId is bad_payload', (_n, reduce, args) => {
		const { runId: _drop, ...rest } = args
		expect(reduce(duel(), 'a', rest)).toEqual({
			ok: false,
			reason: 'bad_payload',
		})
	})

	it('a stale runId is round_over', () => {
		expect(reduceSell(duel(), 'a', { runId: 'old', ante: 1 })).toEqual({
			ok: false,
			reason: 'round_over',
		})
	})

	it('a player who is out is eliminated', () => {
		expect(
			reduceSell(withOut(duel(), 'a'), 'a', { runId: RUN, ante: 1 }),
		).toEqual({ ok: false, reason: 'eliminated' })
	})

	it('an actor the run never seeded is not_running', () => {
		expect(reduceSell(duel(), 'z', { runId: RUN, ante: 1 })).toEqual({
			ok: false,
			reason: 'not_running',
		})
		expect(reduceShop(duel(), 'z', { runId: RUN, spent: 1 })).toEqual({
			ok: false,
			reason: 'not_running',
		})
	})

	it('a game whose rules are not frozen is not_running', () => {
		const state = duel()
		const unfrozen = { ...state, rules: { ...state.rules, runId: null } }
		expect(
			reduceSell(unfrozen as OpponentState, 'a', { runId: RUN, ante: 1 }),
		).toEqual({ ok: false, reason: 'not_running' })
	})
})

describe('pvp.sell', () => {
	it.each([
		[1, 'accepted'],
		[4, 'accepted'],
		[5, 'accepted'],
		[6, 'accepted'],
		[0, 'bad_ante'],
		[7, 'bad_ante'],
	])('progress ante 5: sold in ante %i is %s', (ante, want) => {
		const state = atAnte(duel(), 'a', 5)
		const r = reduceSell(state, 'a', { runId: RUN, ante })
		expect(replyOf(r)).toEqual(want === 'accepted' ? { kind: 'accepted' } : want)
		if (want === 'accepted')
			expect(must(r).facts.opponent.players.a.sells).toEqual({ [ante]: 1 })
	})

	it('counts sells per ante', () => {
		let state = duel()
		for (const ante of [1, 1, 2])
			state = must(reduceSell(state, 'a', { runId: RUN, ante }))
		expect(state.facts.opponent.players.a.sells).toEqual({ 1: 2, 2: 1 })
	})

	it('a client field beyond ante is bad_payload', () => {
		expect(
			reduceSell(duel(), 'a', { runId: RUN, ante: 1, extra: true }),
		).toEqual({ ok: false, reason: 'bad_payload' })
	})

	it('publishes the opponent key', () => {
		const r = reduceSell(duel(), 'a', { runId: RUN, ante: 1 })
		expect(r).toMatchObject({ ok: true })
		if (r.ok) expect(r.changed).toEqual([PVP_OPPONENT_KEY])
	})
})

describe('pvp.effect', () => {
	const effect = (kind: string, extra: object = {}) => ({
		runId: RUN,
		kind,
		...extra,
	})

	it.each(Object.entries(EFFECT_KINDS))(
		'%s: the amount is the server table and the target the frozen row',
		(kind, { amount }) => {
			const state = must(reduceEffect(duel({ roundId: 1 }), 'a', effect(kind)))
			expect(state.facts.effects.players.b.incoming).toEqual([
				{ from: 'a', n: 1, kind, amount },
			])
			expect(state.facts.effects.players.a.incoming).toEqual([])
		},
	)

	it('an unknown kind is unknown_kind', () => {
		expect(reduceEffect(duel(), 'a', effect('magnet'))).toEqual({
			ok: false,
			reason: 'unknown_kind',
		})
	})

	it('a prototype name is not a kind', () => {
		expect(reduceEffect(duel(), 'a', effect('constructor'))).toEqual({
			ok: false,
			reason: 'unknown_kind',
		})
	})

	it('a client amount is bad_payload', () => {
		expect(reduceEffect(duel(), 'a', effect('pizza', { amount: 99 }))).toEqual({
			ok: false,
			reason: 'bad_payload',
		})
	})

	it('no progress is no_progress', () => {
		expect(
			reduceEffect(atAnte(duel(), 'a', null), 'a', effect('pizza')),
		).toEqual({ ok: false, reason: 'no_progress' })
	})

	it('an empty target list records against nobody', () => {
		const state = opponentState({
			mode: 'nemesis',
			ids: ['a', 'b', 'c'],
			partners: { a: 'b', b: 'a', c: null },
		})
		const after = must(reduceEffect(state, 'c', effect('asteroid')))
		for (const id of ['a', 'b', 'c'])
			expect(after.facts.effects.players[id].incoming).toEqual([])
	})

	it('a dead target gets nothing', () => {
		const state = withOut(duel(), 'b')
		const after = must(reduceEffect(state, 'a', effect('pizza')))
		expect(after.facts.effects.players.b.incoming).toEqual([])
	})

	// Pizza and Gambling reach every other alive opponent, as the broadcast did before
	// the server owned them; Asteroid reaches the frozen Nemesis only.
	it.each([
		{
			name: 'royale',
			state: () =>
				opponentState({
					mode: 'royale',
					ids: ['a', 'b', 'c'],
					scores: { a: '30', b: '20', c: '10' },
					roundId: 1,
				}),
		},
		{
			name: 'nemesis with a bye',
			state: () =>
				opponentState({
					mode: 'nemesis',
					ids: ['a', 'b', 'c'],
					partners: { a: 'b', b: 'a', c: null },
					roundId: 1,
				}),
		},
	])(
		'$name: pizza and gambling hit every other alive player once',
		({ state }) => {
			for (const kind of ['pizza', 'gambling']) {
				const after = must(
					reduceEffect(withOut(state(), 'b'), 'c', effect(kind)),
				)
				expect(after.facts.effects.players.a.incoming).toEqual([
					{
						from: 'c',
						n: 1,
						kind,
						amount: EFFECT_KINDS[kind as 'pizza'].amount,
					},
				])
				expect(after.facts.effects.players.b.incoming).toEqual([])
				expect(after.facts.effects.players.c.incoming).toEqual([])
				const all = must(reduceEffect(state(), 'c', effect(kind)))
				expect(all.facts.effects.players.a.incoming).toHaveLength(1)
				expect(all.facts.effects.players.b.incoming).toHaveLength(1)
			}
		},
	)

	// Asteroid hits every alive player whose target for the ante is the sender: the
	// receivers' frozen rows (Royale and Nemesis rows, Manhunt's Runner's top Hunter,
	// Teams card targets), read inverted.
	const hitBy = (state: OpponentState, ids: string[]): string[] =>
		ids.filter((id) => state.facts.effects.players[id].incoming.length > 0)

	it.each([
		// ranked c < b < a: c is cut. Targets a->b, b->c, c->b.
		{ sender: 'c', hits: ['b'] },
		{ sender: 'b', hits: ['a', 'c'] },
		{ sender: 'a', hits: [] },
	])('royale: $sender asteroid hits the players targeting it', ({ sender, hits }) => {
		const state = opponentState({
			mode: 'royale',
			ids: ['a', 'b', 'c'],
			scores: { a: '30', b: '20', c: '10' },
			roundId: 1,
		})
		const after = must(reduceEffect(state, sender, effect('asteroid')))
		expect(hitBy(after, ['a', 'b', 'c'])).toEqual(hits)
	})

	it('royale: a row frozen for the ante is read, not the live ranking', () => {
		const state = opponentState({
			mode: 'royale',
			ids: ['a', 'b', 'c'],
			scores: { a: '30', b: '20', c: '10' },
			roundId: 1,
		})
		// b's row was frozen on c; the live ranking now says b targets c as well, so
		// swap the frozen one to a to tell the two apart.
		const frozen: OpponentState = {
			...state,
			facts: {
				...state.facts,
				nemesis: {
					...state.facts.nemesis,
					b: { 1: { each: ['a'], one: 'a' } },
				},
			},
		}
		const after = must(reduceEffect(frozen, 'a', effect('asteroid')))
		expect(hitBy(after, ['b', 'c'])).toEqual(['b'])
	})

	it('royale: each receiver is read at its own ante and no row is written for a receiver', () => {
		const state = opponentState({
			mode: 'royale',
			ids: ['a', 'b', 'c'],
			antes: { a: 1, b: 2, c: 3 },
			scores: { a: '30', b: '20', c: '10' },
			roundId: 1,
		})
		// b is a step ahead: its ante-1 row (c) is stale, its ante-2 row names a.
		const seeded: OpponentState = {
			...state,
			facts: {
				...state.facts,
				nemesis: {
					...state.facts.nemesis,
					b: {
						1: { each: ['c'], one: 'c' },
						2: { each: ['a'], one: 'a' },
					},
				},
			},
		}
		const after = must(reduceEffect(seeded, 'a', effect('asteroid')))
		expect(hitBy(after, ['b', 'c'])).toEqual(['b'])
		expect(after.facts.nemesis.b).toEqual(seeded.facts.nemesis.b)
		expect(after.facts.nemesis.c).toEqual(seeded.facts.nemesis.c)
	})

	it('royale: in the final two the view decides, not a row frozen on a player who left', () => {
		const state = opponentState({
			mode: 'royale',
			ids: ['a', 'b', 'c'],
			scores: { a: '30', b: '20', c: '10' },
			roundId: 1,
		})
		const frozen: OpponentState = {
			...state,
			lives: {
				...state.lives,
				players: {
					...state.lives.players,
					c: { ...state.lives.players.c, left: true },
				},
			},
			facts: {
				...state.facts,
				nemesis: {
					...state.facts.nemesis,
					a: { 1: { each: ['b'], one: 'b' } },
					b: { 1: { each: ['c'], one: 'c' } },
					c: { 1: { each: ['b'], one: 'b' } },
				},
			},
		}
		const after = must(reduceEffect(frozen, 'a', effect('asteroid')))
		expect(hitBy(after, ['b', 'c'])).toEqual(['b'])
	})

	it('nemesis: the partner, and a bye is hit by nobody', () => {
		const state = opponentState({
			mode: 'nemesis',
			ids: ['a', 'b', 'c'],
			partners: { a: 'b', b: 'a', c: null },
			roundId: 1,
		})
		expect(
			hitBy(must(reduceEffect(state, 'a', effect('asteroid'))), ['b', 'c']),
		).toEqual(['b'])
		expect(
			hitBy(must(reduceEffect(state, 'c', effect('asteroid'))), ['a', 'b']),
		).toEqual([])
	})

	it.each([
		// a Hunter hits the Runner only when it is the Runner's top Hunter (c)
		{ sender: 'b', hits: [] },
		{ sender: 'c', hits: ['a'] },
		// the Runner hits every Hunter, each of which targets it
		{ sender: 'a', hits: ['b', 'c', 'd'] },
	])('manhunt: $sender asteroid', ({ sender, hits }) => {
		const state = opponentState({
			mode: 'manhunt',
			ids: ['a', 'b', 'c', 'd'],
			teams: { a: 'RUNNER', b: 'HUNTER', c: 'HUNTER', d: 'HUNTER' },
			scores: { b: '10', c: '30', d: '20' },
			roundId: 1,
		})
		const after = must(reduceEffect(state, sender, effect('asteroid')))
		expect(hitBy(after, ['a', 'b', 'c', 'd'])).toEqual(hits)
	})

	it.each([
		{ sender: 'a', hits: ['c'] },
		{ sender: 'c', hits: ['a', 'b'] },
		{ sender: 'd', hits: [] },
	])('teams: $sender asteroid hits the players whose card target it is', ({
		sender,
		hits,
	}) => {
		const state = opponentState({
			mode: 'teams',
			ids: ['a', 'b', 'c', 'd'],
			teams: { a: 'A', b: 'A', c: 'B', d: 'B' },
			cardTargets: { a: 'c', b: 'c', c: 'a', d: 'b' },
			roundId: 1,
		})
		const after = must(reduceEffect(state, sender, effect('asteroid')))
		expect(hitBy(after, ['a', 'b', 'c', 'd'])).toEqual(hits)
	})

	it('an asteroid never hits a player who is out', () => {
		const state = withOut(
			opponentState({
				mode: 'nemesis',
				ids: ['a', 'b', 'c', 'd'],
				partners: { a: 'b', b: 'a', c: 'd', d: 'c' },
				roundId: 1,
			}),
			'b',
		)
		const after = must(reduceEffect(state, 'a', effect('asteroid')))
		expect(hitBy(after, ['b', 'c', 'd'])).toEqual([])
	})

	// Pizza and Gambling reach every other alive player, a teammate included.
	it.each(['pizza', 'gambling'])(
		'teams: %s hits every other alive player, teammates too',
		(kind) => {
			const state = opponentState({
				mode: 'teams',
				ids: ['a', 'b', 'c', 'd'],
				teams: { a: 'A', b: 'A', c: 'B', d: 'B' },
				cardTargets: { a: 'c', b: 'd', c: 'a', d: 'b' },
				roundId: 1,
			})
			const after = must(reduceEffect(withOut(state, 'd'), 'a', effect(kind)))
			expect(hitBy(after, ['a', 'b', 'c', 'd'])).toEqual(['b', 'c'])
		},
	)

	it.each(['pizza', 'gambling'])(
		'manhunt: a hunter %s hits the runner and the other alive hunters',
		(kind) => {
			const state = opponentState({
				mode: 'manhunt',
				ids: ['a', 'b', 'c', 'd'],
				teams: { a: 'RUNNER', b: 'HUNTER', c: 'HUNTER', d: 'HUNTER' },
				roundId: 1,
			})
			const after = must(reduceEffect(withOut(state, 'd'), 'b', effect(kind)))
			expect(hitBy(after, ['a', 'b', 'c', 'd'])).toEqual(['a', 'c'])
		},
	)

	it('a manhunt runner hits every alive hunter', () => {
		const state = opponentState({
			mode: 'manhunt',
			ids: ['a', 'b', 'c', 'd'],
			teams: { a: 'RUNNER', b: 'HUNTER', c: 'HUNTER', d: 'HUNTER' },
			roundId: 1,
		})
		const after = must(reduceEffect(withOut(state, 'd'), 'a', effect('pizza')))
		expect(after.facts.effects.players.b.incoming).toHaveLength(1)
		expect(after.facts.effects.players.c.incoming).toHaveLength(1)
		expect(after.facts.effects.players.d.incoming).toHaveLength(0)
	})

	it('the incoming list numbers effects by position', () => {
		let state = duel({ roundId: 1 })
		for (const kind of ['pizza', 'gambling', 'asteroid'])
			state = must(reduceEffect(state, 'a', effect(kind)))
		expect(state.facts.effects.players.b.incoming.map((e) => e.n)).toEqual([
			1, 2, 3,
		])
	})

	it('MAX_EFFECTS_PER_ACTOR sent to one target: the next is over_cap and changes nothing', () => {
		let state = duel({ roundId: 1 })
		for (let i = 0; i < MAX_EFFECTS_PER_ACTOR; i++)
			state = must(reduceEffect(state, 'a', effect('pizza')))
		expect(reduceEffect(state, 'a', effect('pizza'))).toEqual({
			ok: false,
			reason: 'over_cap',
		})
	})

	it('freezes the target row it used', () => {
		const state = must(
			reduceEffect(duel({ roundId: 1 }), 'a', effect('asteroid')),
		)
		expect(state.facts.nemesis.a['1']).toEqual({ each: ['b'], one: 'b' })
	})
})

describe('pvp.shop', () => {
	const shop = (rest: object) => ({ runId: RUN, ...rest })

	it('records slots in order', () => {
		let state = duel({ skips: { a: 1 } })
		state = must(reduceShop(state, 'a', shop({ spent: 7 })))
		state = must(reduceShop(state, 'a', shop({ skipped: true })))
		expect(state.facts.opponent.players.a.slots).toEqual([
			{ ante: 1, spent: 7 },
			{ ante: 1, skipped: true },
		])
	})

	it('a spend of 0 records a normal slot', () => {
		const state = must(reduceShop(duel(), 'a', shop({ spent: 0 })))
		expect(state.facts.opponent.players.a.slots).toEqual([{ ante: 1, spent: 0 }])
	})

	it.each([
		['both', { spent: 1, skipped: true }],
		['skipped false', { skipped: false }],
		['negative spend', { spent: -1 }],
		['fractional spend', { spent: 1.5 }],
		['an extra field', { spent: 1, extra: 1 }],
	])('%s is bad_payload and records no slot', (_n, rest) => {
		expect(reduceShop(duel(), 'a', shop(rest))).toEqual({
			ok: false,
			reason: 'bad_payload',
		})
	})

	it('neither spent nor skipped is a bad_spend slot: it happened, its spend is unknown', () => {
		const r = reduceShop(duel(), 'a', shop({}))
		expect(replyOf(r)).toEqual({ kind: 'refused', reason: 'bad_spend' })
		expect(must(r).facts.opponent.players.a.slots).toEqual([
			{ ante: 1, refused: 'bad_spend' },
		])
	})

	it('a skip with no recorded pvp.skip (unknown total) is a skip_missing slot', () => {
		const r = reduceShop(duel({ skips: { a: null } }), 'a', shop({ skipped: true }))
		expect(replyOf(r)).toEqual({ kind: 'refused', reason: 'skip_missing' })
		expect(must(r).facts.opponent.players.a.slots).toEqual([
			{ ante: 1, refused: 'skip_missing' },
		])
	})

	it('a skip with a known total of 0 is skip_missing too', () => {
		const r = reduceShop(duel({ skips: { a: 0 } }), 'a', shop({ skipped: true }))
		expect(replyOf(r)).toEqual({ kind: 'refused', reason: 'skip_missing' })
	})

	it('a skip with no skip entry at all is skip_missing', () => {
		const state = duel()
		const bare: OpponentState = {
			...state,
			facts: { ...state.facts, skips: {} },
		}
		expect(replyOf(reduceShop(bare, 'a', shop({ skipped: true })))).toEqual({
			kind: 'refused',
			reason: 'skip_missing',
		})
	})

	it('a skip is accepted only while the total exceeds the accepted skips', () => {
		let state = duel({ skips: { a: 1 } })
		state = must(reduceShop(state, 'a', shop({ skipped: true })))
		expect(replyOf(reduceShop(state, 'a', shop({ skipped: true })))).toEqual({
			kind: 'refused',
			reason: 'skip_missing',
		})
	})

	it('a spend above MAX_SPEND is implausible, and says what it counted', () => {
		expect(replyOf(reduceShop(duel(), 'a', shop({ spent: 1_000_001 })))).toEqual({
			kind: 'refused',
			reason: 'implausible',
			detail: { count: 1_000_001, cap: MAX_SPEND, window: 'slot' },
		})
	})

	it('no progress is recorded as no_progress', () => {
		const r = reduceShop(atAnte(duel(), 'a', null), 'a', shop({ spent: 1 }))
		expect(replyOf(r)).toEqual({ kind: 'refused', reason: 'no_progress' })
		expect(must(r).facts.opponent.players.a.slots[0]).toMatchObject({
			ante: null,
			refused: 'no_progress',
		})
	})

	it('past MAX_SLOTS_PER_PLAYER the slot is over_cap and not recorded', () => {
		const slots = Array.from({ length: MAX_SLOTS_PER_PLAYER }, () => ({
			ante: 1,
			spent: 0,
		}))
		const full = withPlayerSlots(duel(), 'a', slots)
		expect(reduceShop(full, 'a', shop({ spent: 0 }))).toEqual({
			ok: false,
			reason: 'over_cap',
		})
	})
})

describe('wiring helpers', () => {
	it('syncClosed follows the lives facts and reports a change once', () => {
		const out = syncClosed(withOut(duel(), 'b'))
		expect(out.changed).toBe(true)
		expect(out.state.facts.opponent.players.b.closed).toBe(true)
		expect(out.state.facts.opponent.players.a.closed).toBe(false)
		const again = syncClosed(out.state)
		expect(again.changed).toBe(false)
		expect(again.state).toBe(out.state)
	})
})
