import { describe, expect, it } from 'vitest'
import { opponentState, withOut } from '../../testing/pvp_fixtures'
import { MAX_PLANTS_PER_PLANTER } from './opponent_facts'
import type { OpponentResult, OpponentState } from './opponent_state'
import {
	ARCANE_LOCK_KEY,
	reduceTrapFire,
	reduceTrapLost,
	reduceTrapPlant,
} from './traps'

const RUN = 'run-1'

const duel = (): OpponentState =>
	opponentState({
		mode: 'nemesis',
		ids: ['a', 'b'],
		partners: { a: 'b', b: 'a' },
		pvpStartAnte: 2,
		roundId: 1,
	})

function must(result: OpponentResult): OpponentState {
	if (!result.ok) throw new Error(`refused: ${result.reason}`)
	return result.state
}

const reply = (r: OpponentResult): unknown => (r.ok ? r.reply : r.reason)

const plant = (
	state: OpponentState,
	id: string,
	key: string,
	extra: object = {},
): OpponentResult =>
	reduceTrapPlant(state, id, {
		runId: RUN,
		key,
		...extra,
	})

describe('pvp.trap_plant', () => {
	it('the server assigns the id, owner and holder', () => {
		const state = must(plant(duel(), 'a', 'c_mp_trap_web'))
		expect(state.facts.traps).toEqual({
			trapSeq: 1,
			traps: [
				{ id: 0, key: 'c_mp_trap_web', owner: 'a', holder: 'b', state: 'live' },
			],
		})
	})

	it('trap ids are unique across plants', () => {
		let state = duel()
		// two plants fit the window before any paid shop slot
		for (let i = 0; i < 2; i++) state = must(plant(state, 'a', 'c_mp_trap_web'))
		const ids = state.facts.traps.traps.map((t) => t.id)
		expect(new Set(ids).size).toBe(2)
		expect(state.facts.traps.trapSeq).toBe(2)
	})

	it('a client-serialized card is bad_payload', () => {
		const r = plant(duel(), 'a', 'c_mp_trap_web', { card: { ability: {} } })
		expect(reply(r)).toBe('bad_payload')
	})

	it.each([
		['not a trap card', 'j_joker'],
		['empty', ''],
		['too long', `c_mp_${'x'.repeat(64)}`],
	])('a key that is %s is unknown_trap', (_name, key) => {
		expect(reply(plant(duel(), 'a', key))).toBe('unknown_trap')
	})

	it('a trap key the server has no table for can be planted', () => {
		expect(reply(plant(duel(), 'a', 'c_mp_trap_new_card'))).toEqual({
			kind: 'accepted',
		})
	})

	it('no progress is recorded as no_progress', () => {
		const state = duel()
		const noAnte: OpponentState = {
			...state,
			round: {
				...state.round,
				players: {
					...state.round.players,
					a: { ...state.round.players.a, ante: null },
				},
			},
		}
		expect(reply(plant(noAnte, 'a', 'c_mp_trap_web'))).toBe('no_progress')
	})

	it('a bye plants against nobody', () => {
		const state = opponentState({
			mode: 'nemesis',
			ids: ['a', 'b', 'c'],
			partners: { a: 'b', b: 'a', c: null },
			pvpStartAnte: 2,
			roundId: 1,
		})
		const after = must(plant(state, 'c', 'c_mp_trap_web'))
		expect(after.facts.traps.traps).toEqual([])
	})

	it('a manhunt runner plants one trap per alive hunter', () => {
		const state = withOut(
			opponentState({
				mode: 'manhunt',
				ids: ['a', 'b', 'c', 'd'],
				teams: { a: 'RUNNER', b: 'HUNTER', c: 'HUNTER', d: 'HUNTER' },
				pvpStartAnte: 2,
				roundId: 1,
			}),
			'd',
		)
		const after = must(plant(state, 'a', 'c_mp_trap_web'))
		expect(
			after.facts.traps.traps.map((t) => [t.id, t.owner, t.holder]),
		).toEqual([
			[0, 'a', 'b'],
			[1, 'a', 'c'],
		])
	})

	it('MAX_PLANTS_PER_PLANTER plants on one holder: the next is over_cap and plants nothing', () => {
		const state = duel()
		const traps = Array.from({ length: MAX_PLANTS_PER_PLANTER }, (_, id) => ({
			id,
			key: 'c_mp_trap_web',
			owner: 'a',
			holder: 'b',
			state: 'live' as const,
		}))
		const filled: OpponentState = {
			...state,
			facts: {
				...state.facts,
				traps: { trapSeq: traps.length, traps },
			},
		}
		const r = plant(filled, 'a', 'c_mp_trap_web')
		expect(reply(r)).toBe('over_cap')
		expect(filled.facts.traps.traps).toHaveLength(MAX_PLANTS_PER_PLANTER)
	})
})

describe('Arcane Lock', () => {
	// b plants a lock on a; a then plants and bounces.
	const locked = (): OpponentState => {
		let state = duel()
		state = must(plant(state, 'b', ARCANE_LOCK_KEY))
		return state
	}

	it('a planter who holds a lock bounces: exactly one record, the lock spent', () => {
		const state = locked()
		const lock = state.facts.traps.traps[0]
		expect(lock).toMatchObject({ owner: 'b', holder: 'a', state: 'live' })
		const after = must(plant(state, 'a', 'c_mp_trap_web'))
		expect(after.facts.traps.traps).toEqual([
			{ ...lock, state: { fired: { bounced: 1 } } },
			{ id: 1, key: 'c_mp_trap_web', owner: 'b', holder: 'a', state: 'live' },
		])
	})

	it('the oldest lock is the one spent', () => {
		let state = duel()
		state = must(plant(state, 'b', ARCANE_LOCK_KEY))
		state = must(plant(state, 'b', ARCANE_LOCK_KEY))
		const after = must(plant(state, 'a', 'c_mp_trap_web'))
		const [first, second] = after.facts.traps.traps
		expect(first.state).toEqual({ fired: { bounced: 2 } })
		expect(second.state).toBe('live')
	})

	it('a plant that bounces makes one record even for a runner', () => {
		let state = opponentState({
			mode: 'manhunt',
			ids: ['a', 'b', 'c', 'd'],
			teams: { a: 'RUNNER', b: 'HUNTER', c: 'HUNTER', d: 'HUNTER' },
			pvpStartAnte: 2,
			roundId: 1,
		})
		state = must(plant(state, 'b', ARCANE_LOCK_KEY))
		// the runner holds a lock (planted by hunter b)
		expect(
			state.facts.traps.traps.some(
				(t) => t.holder === 'a' && t.key === ARCANE_LOCK_KEY,
			),
		).toBe(true)
		const before = state.facts.traps.traps.length
		const after = must(plant(state, 'a', 'c_mp_trap_web'))
		expect(after.facts.traps.traps).toHaveLength(before + 1)
	})

	it('a client fire of an Arcane Lock is bad_payload', () => {
		const state = locked()
		expect(
			reply(reduceTrapFire(state, 'a', { runId: RUN, trapId: 0, data: {} })),
		).toBe('bad_payload')
	})
})

describe('pvp.trap_fire', () => {
	const planted = (): OpponentState => must(plant(duel(), 'a', 'c_mp_trap_web'))
	const fire = (
		state: OpponentState,
		id: string,
		trapId: number,
		data?: unknown,
	) =>
		reduceTrapFire(
			state,
			id,
			data === undefined
				? { runId: RUN, trapId }
				: { runId: RUN, trapId, data },
		)

	it('the holder fires a live trap with no data', () => {
		const state = must(
			fire(must(plant(duel(), 'a', 'c_mp_trap_alarm')), 'b', 0),
		)
		expect(state.facts.traps.traps[0].state).toEqual({ fired: {} })
	})

	it('the data is recorded as the holder sent it', () => {
		const data = { key: 'c_fool', set: 'Tarot', extra: [1, 2] }
		const state = must(fire(planted(), 'b', 0, data))
		expect(state.facts.traps.traps[0].state).toEqual({ fired: data })
	})

	it.each([
		['an array', []],
		['a string', 'x'],
		['over the size cap', { blob: 'x'.repeat(600) }],
	])('data that is %s is bad_payload and the trap stays live', (_name, data) => {
		const state = planted()
		expect(reply(fire(state, 'b', 0, data))).toBe('bad_payload')
		expect(state.facts.traps.traps[0].state).toBe('live')
	})

	it('only the holder may fire', () => {
		expect(
			reply(fire(planted(), 'a', 0, { key: 'c_fool', set: 'Tarot' })),
		).toBe('not_holder')
	})

	it('an unknown trap is not_holder', () => {
		expect(reply(fire(planted(), 'b', 99))).toBe('not_holder')
	})

	it('a trap fires once only', () => {
		const state = must(fire(planted(), 'b', 0, { key: 'c_fool', set: 'Tarot' }))
		expect(reply(fire(state, 'b', 0, { key: 'c_fool', set: 'Tarot' }))).toBe(
			'already_fired',
		)
	})

	it.each([
		['a bad trapId', { runId: RUN, trapId: -1, data: {} }],
		['an extra field', { runId: RUN, trapId: 0, data: {}, extra: 1 }],
		['no runId', { trapId: 0, data: {} }],
	])('%s is bad_payload', (_n, args) => {
		expect(reply(reduceTrapFire(planted(), 'b', args))).toBe('bad_payload')
	})

	it('a lost trap cannot fire', () => {
		const lost = must(reduceTrapLost(planted(), 'b', { runId: RUN, trapId: 0 }))
		expect(reply(fire(lost, 'b', 0, { key: 'c_fool', set: 'Tarot' }))).toBe(
			'already_fired',
		)
	})
})

describe('pvp.trap_lost', () => {
	const planted = (): OpponentState => must(plant(duel(), 'a', 'c_mp_trap_web'))

	it('the holder reports an unfired trap lost', () => {
		const state = must(
			reduceTrapLost(planted(), 'b', { runId: RUN, trapId: 0 }),
		)
		expect(state.facts.traps.traps[0].state).toBe('lost')
	})

	it('only the holder may report it', () => {
		expect(
			reply(reduceTrapLost(planted(), 'a', { runId: RUN, trapId: 0 })),
		).toBe('not_holder')
	})

	it('a fired trap cannot be lost', () => {
		const fired = must(
			reduceTrapFire(planted(), 'b', {
				runId: RUN,
				trapId: 0,
				data: { key: 'c_fool', set: 'Tarot' },
			}),
		)
		expect(reply(reduceTrapLost(fired, 'b', { runId: RUN, trapId: 0 }))).toBe(
			'already_fired',
		)
	})

	it('a repeat is already_fired', () => {
		const lost = must(reduceTrapLost(planted(), 'b', { runId: RUN, trapId: 0 }))
		expect(reply(reduceTrapLost(lost, 'b', { runId: RUN, trapId: 0 }))).toBe(
			'already_fired',
		)
	})

	it('a bad payload is bad_payload', () => {
		expect(reply(reduceTrapLost(planted(), 'b', { runId: RUN }))).toBe(
			'bad_payload',
		)
	})
})
