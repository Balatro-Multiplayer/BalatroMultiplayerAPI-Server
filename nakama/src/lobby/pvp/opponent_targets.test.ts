import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { atAnte, opponentState, withOut } from '../../testing/pvp_fixtures'
import {
	freezeNemesis,
	recordTargets,
	resolveTargets,
} from './opponent_targets'
import type { PvpMode, PvpTeam } from './state'

const four = ['a', 'b', 'c', 'd']

describe('resolveTargets, per mode', () => {
	it.each([
		{
			name: 'nemesis: the stored partner',
			state: () =>
				opponentState({
					mode: 'nemesis',
					ids: four,
					partners: { a: 'b', b: 'a', c: 'd', d: 'c' },
				}),
			actor: 'a',
			row: { each: ['b'], one: 'b' },
		},
		{
			name: 'nemesis: a bye has no opponent',
			state: () =>
				opponentState({
					mode: 'nemesis',
					ids: ['a', 'b', 'c'],
					partners: { a: 'b', b: 'a', c: null },
				}),
			actor: 'c',
			row: { each: [], one: null },
		},
		{
			name: 'nemesis: a dead partner is nobody',
			state: () =>
				opponentState({
					mode: 'nemesis',
					ids: four,
					partners: { a: 'b', b: 'a', c: 'd', d: 'c' },
					out: ['b'],
				}),
			actor: 'a',
			row: { each: [], one: null },
		},
		{
			name: 'duel (two-player nemesis): the other seat, no pairing needed',
			state: () => opponentState({ mode: 'nemesis', ids: ['a', 'b'] }),
			actor: 'a',
			row: { each: ['b'], one: 'b' },
		},
		{
			name: 'duel: a dead opponent is nobody',
			state: () =>
				opponentState({ mode: 'nemesis', ids: ['a', 'b'], out: ['b'] }),
			actor: 'a',
			row: { each: [], one: null },
		},
		{
			name: 'ranked ruleset (two-player nemesis): the other seat',
			state: () =>
				opponentState({
					mode: 'nemesis',
					ids: ['a', 'b'],
					ruleset: 'ruleset_mp_legacy_ranked',
				}),
			actor: 'b',
			row: { each: ['a'], one: 'a' },
		},
		{
			name: 'teams: before the first draw',
			state: () =>
				opponentState({
					mode: 'teams',
					ids: four,
					teams: { a: 'A', b: 'A', c: 'B', d: 'B' },
				}),
			actor: 'a',
			row: { each: [], one: null },
		},
		{
			name: 'teams: the drawn card target',
			state: () =>
				opponentState({
					mode: 'teams',
					ids: four,
					teams: { a: 'A', b: 'A', c: 'B', d: 'B' },
					cardTargets: { a: 'c', b: 'd', c: 'a', d: 'b' },
				}),
			actor: 'a',
			row: { each: ['c'], one: 'c' },
		},
		{
			name: 'manhunt: a hunter faces the runner',
			state: () =>
				opponentState({
					mode: 'manhunt',
					ids: four,
					teams: { a: 'RUNNER', b: 'HUNTER', c: 'HUNTER', d: 'HUNTER' },
				}),
			actor: 'b',
			row: { each: ['a'], one: 'a' },
		},
		{
			name: 'manhunt: the runner fans out to every alive hunter',
			state: () =>
				withOut(
					opponentState({
						mode: 'manhunt',
						ids: four,
						teams: { a: 'RUNNER', b: 'HUNTER', c: 'HUNTER', d: 'HUNTER' },
						scores: { b: '10', c: '30', d: '20' },
					}),
					'd',
				),
			actor: 'a',
			row: { each: ['b', 'c'], one: 'c' },
		},
	])('$name', ({ state, actor, row }) => {
		expect(resolveTargets(state(), actor)).toEqual(row)
	})

	it('royale: the neighbour in the ranking, never self', () => {
		const state = opponentState({
			mode: 'royale',
			ids: ['a', 'b', 'c'],
			scores: { a: '30', b: '20', c: '10' },
		})
		for (const id of ['a', 'b', 'c']) {
			const row = resolveTargets(state, id)
			expect(row.each).not.toContain(id)
			expect(row.each.length).toBe(row.one === null ? 0 : 1)
		}
	})

	it('is unmasked: it reads the real scores, not a projection', () => {
		const state = opponentState({
			mode: 'manhunt',
			ids: four,
			teams: { a: 'RUNNER', b: 'HUNTER', c: 'HUNTER', d: 'HUNTER' },
			scores: { b: '1', c: '2', d: '3' },
		})
		expect(resolveTargets(state, 'a').one).toBe('d')
	})
})

describe('freezeNemesis', () => {
	const paired = () =>
		opponentState({
			mode: 'nemesis',
			ids: four,
			partners: { a: 'b', b: 'a', c: 'd', d: 'c' },
		})

	it('freezes the current ante once its resolve is non-empty', () => {
		const out = freezeNemesis(paired())
		expect(out.changed).toBe(true)
		expect(out.state.facts.nemesis.a['1']).toEqual({ each: ['b'], one: 'b' })
	})

	it('does not freeze an empty resolve while the ante is current', () => {
		const state = opponentState({
			mode: 'nemesis',
			ids: ['a', 'b', 'c'],
			partners: { a: 'b', b: 'a', c: null },
		})
		const out = freezeNemesis(state)
		expect(out.state.facts.nemesis.c['1']).toBeUndefined()
	})

	it('freezes an empty resolve as a bye row once the ante has passed', () => {
		const bye = opponentState({
			mode: 'nemesis',
			ids: ['a', 'b', 'c'],
			partners: { a: 'b', b: 'a', c: null },
		})
		const seen = freezeNemesis(bye)
		expect(seen.state.facts.nemesis.c['1']).toBeUndefined()
		expect(seen.state.facts.server.players.c.seenAnte).toBe(1)
		const passed = freezeNemesis(atAnte(seen.state, 'c', 2))
		expect(passed.changed).toBe(true)
		expect(passed.state.facts.nemesis.c['1']).toEqual({ each: [], one: null })
		expect(passed.state.facts.nemesis.c['2']).toBeUndefined()
		expect(
			recordTargets(atAnte(passed.state, 'c', 1), 'c', 'each'),
		).toMatchObject({ ok: true, targets: [], changed: [] })
	})

	it('a bye row is not written for an ante the server never saw', () => {
		const bye = opponentState({
			mode: 'nemesis',
			ids: ['a', 'b', 'c'],
			partners: { a: 'b', b: 'a', c: null },
		})
		const out = freezeNemesis(atAnte(bye, 'c', 3))
		expect(out.state.facts.nemesis.c).toEqual({})
	})

	it('the last seen ante moving is not a pvp.nemesis change', () => {
		const once = freezeNemesis(paired()).state
		const out = freezeNemesis(atAnte(once, 'a', 1))
		expect(out.changed).toBe(false)
	})

	it('freezes only the ante that is current: a skipped ante stays absent', () => {
		// a is first seen at ante 3: antes 1 and 2 were never seen, so they are
		// unknown (absent), not an empty row
		const out = freezeNemesis(atAnte(paired(), 'a', 3))
		expect(Object.keys(out.state.facts.nemesis.a)).toEqual(['3'])
		expect(out.state.facts.nemesis.a['1']).toBeUndefined()
		expect(out.state.facts.nemesis.a['2']).toBeUndefined()
	})

	it('a forged ante writes one row, not one per ante below it', () => {
		const rows = freezeNemesis(atAnte(paired(), 'a', 10_000)).state.facts
			.nemesis.a
		expect(Object.keys(rows)).toEqual(['10000'])
	})

	it('an ante the player moves on from keeps the row it had, later ones are added', () => {
		const first = freezeNemesis(paired()).state
		const next = freezeNemesis(atAnte(first, 'a', 2)).state
		expect(Object.keys(next.facts.nemesis.a)).toEqual(['1', '2'])
	})

	it('a frozen entry survives a re-rank', () => {
		const frozen = freezeNemesis(paired()).state
		const repaired = {
			...frozen,
			pairing: {
				ante: 1,
				partners: { a: 'c', b: 'd', c: 'a', d: 'b' },
				usedPairs: [],
				lastBye: null,
			},
		}
		const again = freezeNemesis(repaired)
		expect(again.state.facts.nemesis.a['1']).toEqual({ each: ['b'], one: 'b' })
	})

	it('changes nothing when nothing is owed', () => {
		const once = freezeNemesis(paired()).state
		const twice = freezeNemesis(once)
		expect(twice.changed).toBe(false)
		expect(twice.state).toBe(once)
	})

	it('skips an actor with no known ante', () => {
		const state = atAnte(paired(), 'a', null)
		expect(freezeNemesis(state).state.facts.nemesis.a).toEqual({})
	})
})

describe('recordTargets', () => {
	const paired = () =>
		opponentState({
			mode: 'nemesis',
			ids: four,
			partners: { a: 'b', b: 'a', c: 'd', d: 'c' },
		})

	it('refuses an actor with no ante as no_progress', () => {
		expect(recordTargets(atAnte(paired(), 'a', null), 'a', 'each')).toEqual({
			ok: false,
			reason: 'no_progress',
		})
	})

	it('freezes a fresh non-empty resolve and reports the key', () => {
		const out = recordTargets(paired(), 'a', 'each')
		expect(out).toMatchObject({
			ok: true,
			targets: ['b'],
			changed: ['pvp.nemesis'],
		})
		if (out.ok)
			expect(out.state.facts.nemesis.a['1']).toEqual({ each: ['b'], one: 'b' })
	})

	it('reads the frozen row, not the current pairing', () => {
		const frozen = freezeNemesis(paired()).state
		const repaired = {
			...frozen,
			pairing: {
				ante: 1,
				partners: { a: 'c', b: 'd', c: 'a', d: 'b' },
				usedPairs: [],
				lastBye: null,
			},
		}
		const out = recordTargets(repaired, 'a', 'one')
		expect(out).toMatchObject({ ok: true, targets: ['b'], changed: [] })
	})

	it('an empty result is a fact, not a refusal', () => {
		const state = opponentState({
			mode: 'nemesis',
			ids: ['a', 'b', 'c'],
			partners: { a: 'b', b: 'a', c: null },
		})
		expect(recordTargets(state, 'c', 'each')).toMatchObject({
			ok: true,
			targets: [],
			changed: [],
		})
	})

	it('drops a frozen target who has since died', () => {
		const frozen = freezeNemesis(paired()).state
		const out = recordTargets(withOut(frozen, 'b'), 'a', 'each')
		expect(out).toMatchObject({ ok: true, targets: [] })
	})
})

describe('a duel and a ranked game, freeze and record', () => {
	it.each([
		['nemesis duel', undefined],
		['ranked ruleset', 'ruleset_mp_legacy_ranked'],
	])('%s: freezes the other seat and records it', (_name, ruleset) => {
		const state = opponentState({
			mode: 'nemesis',
			ids: ['a', 'b'],
			...(ruleset === undefined ? {} : { ruleset }),
		})
		const frozen = freezeNemesis(state)
		expect(frozen.changed).toBe(true)
		expect(frozen.state.facts.nemesis.a['1']).toEqual({ each: ['b'], one: 'b' })
		expect(frozen.state.facts.nemesis.b['1']).toEqual({ each: ['a'], one: 'a' })
		expect(recordTargets(state, 'a', 'each')).toMatchObject({
			ok: true,
			targets: ['b'],
			changed: ['pvp.nemesis'],
		})
		// the frozen row is what a later record reads
		expect(recordTargets(frozen.state, 'b', 'one')).toMatchObject({
			ok: true,
			targets: ['a'],
			changed: [],
		})
	})

	it('a dead opponent: nothing is frozen, and a frozen target who died is dropped', () => {
		const dead = opponentState({ mode: 'nemesis', ids: ['a', 'b'], out: ['b'] })
		expect(freezeNemesis(dead).state.facts.nemesis.a).toEqual({})
		expect(recordTargets(dead, 'a', 'each')).toMatchObject({
			ok: true,
			targets: [],
			changed: [],
		})
		const frozen = freezeNemesis(
			opponentState({ mode: 'nemesis', ids: ['a', 'b'] }),
		).state
		expect(recordTargets(withOut(frozen, 'b'), 'a', 'each')).toMatchObject({
			ok: true,
			targets: [],
		})
	})
})

describe('targets never include self, a teammate or the dead', () => {
	const modes: PvpMode[] = ['nemesis', 'royale', 'manhunt', 'teams']
	it('holds for every mode over random seats', () => {
		fc.assert(
			fc.property(
				fc.constantFrom(...modes),
				fc.boolean(),
				fc.array(fc.boolean(), { minLength: 4, maxLength: 4 }),
				fc.array(fc.nat({ max: 3 }), { minLength: 4, maxLength: 4 }),
				fc.array(fc.nat({ max: 99 }), { minLength: 4, maxLength: 4 }),
				(mode, twoPlayers, dead, picks, points) => {
					const ids = twoPlayers ? ['a', 'b'] : four
					const teamOf = (i: number): PvpTeam => {
						if (mode === 'manhunt') return i === 0 ? 'RUNNER' : 'HUNTER'
						return i < ids.length / 2 ? 'A' : 'B'
					}
					const teams: { [id: string]: PvpTeam } = Object.fromEntries(
						ids.map((id, i) => [id, teamOf(i)]),
					)
					const partners = Object.fromEntries(
						ids.map((id, i) => [id, ids[picks[i] % ids.length]]),
					)
					const cardTargets = partners
					const scores = Object.fromEntries(
						ids.map((id, i) => [id, String(points[i])]),
					)
					let state = opponentState({
						mode,
						ids,
						teams,
						partners,
						cardTargets,
						scores,
					})
					ids.forEach((id, i) => {
						if (dead[i]) state = withOut(state, id)
					})
					for (const actor of ids) {
						const row = resolveTargets(state, actor)
						const picked = [...row.each, ...(row.one === null ? [] : [row.one])]
						for (const t of picked) {
							expect(t).not.toBe(actor)
							expect(state.lives.players[t].eliminated).toBe(false)
							const mine = state.teams.teams[actor]
							if (mine !== undefined)
								expect(state.teams.teams[t]).not.toBe(mine)
						}
					}
				},
			),
		)
	})
})
