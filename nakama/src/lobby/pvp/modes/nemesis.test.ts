// The Nemesis rules (rules R27-R30 of docs/pvp-match.md).
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { raced } from '../../../testing/pvp_fixtures'
import { withRules } from '../../../testing/pvp_rules'
import { testContext } from '../../../testing/request_context'
import { fromRuntime } from '../../../testing/runtime_state'
import { ServerOp } from '../../protocol'
import { action } from '../../relay'
import {
	type Lobby,
	type Outbound,
	type Step,
	join,
	newLobby,
} from '../../state'
import { FACT_REDUCERS } from '../facts'
import { NO_ENDS, pvpTick as tickWith } from '../pvp_tick'
import { pvpOf, readyReducer } from '../ready'
import {
	type ModeView,
	type PvpPairing,
	emptyPvp,
	refereeOf,
	withReferee,
} from '../state'
import { aliveIds } from './common'
import { pickMode } from './index'
import { circleRound, nemesisMode, pairNemesis, shuffled } from './nemesis'

// These tests end no game, so the tick gets no ends: reaching one throws.
const pvpTick = (
	lobby: Parameters<typeof tickWith>[0],
	ctx: Parameters<typeof tickWith>[1],
) => tickWith(lobby, ctx, NO_ENDS)

const ctx = testContext(0)
const RUN = 'r1'
const rng = (seed: number) => testContext(0, seed).random

const ids = (n: number): string[] =>
	Array.from({ length: n }, (_, i) => `p${i + 1}`)

const key = (a: string, b: string): string =>
	a < b ? `${a}|${b}` : `${b}|${a}`

// ---------------------------------------------------------------- R27 pairing

const pairsOf = (p: PvpPairing): string[] =>
	Object.entries(p.partners)
		.filter(([id, partner]) => partner !== null && id < partner)
		.map(([id, partner]) => key(id, partner as string))
		.sort()

const byeOf = (p: PvpPairing): string | null =>
	Object.entries(p.partners).find(([, partner]) => partner === null)?.[0] ??
	null

// `antes` pairings in a row over the same alive set, one random stream.
function chain(alive: string[], antes: number, seed: number): PvpPairing[] {
	const random = rng(seed)
	const out: PvpPairing[] = []
	let previous: PvpPairing | null = null
	for (let ante = 1; ante <= antes; ante++) {
		previous = pairNemesis(alive, previous, ante, random)
		out.push(previous)
	}
	return out
}

const aliveCount = fc.integer({ min: 3, max: 8 })
const seeds = fc.integer({ min: 0, max: 1_000_000 })

describe('R27: pairNemesis (compute_nemesis_pairing 665-722)', () => {
	it('partners are symmetric, every alive id appears once, an odd count has one bye', () => {
		fc.assert(
			fc.property(aliveCount, seeds, (n, seed) => {
				const alive = ids(n)
				for (const p of chain(alive, 4, seed)) {
					expect(Object.keys(p.partners).sort()).toEqual(alive)
					for (const [id, partner] of Object.entries(p.partners))
						if (partner !== null) expect(p.partners[partner]).toBe(id)
					const byes = alive.filter((id) => p.partners[id] === null)
					expect(byes).toHaveLength(n % 2)
					expect(p.lastBye).toBe(byes[0] ?? null)
				}
			}),
		)
	})

	it('the bye is not last ante bye when another choice exists', () => {
		fc.assert(
			fc.property(fc.constantFrom(3, 5, 7), seeds, (n, seed) => {
				const list = chain(ids(n), 6, seed)
				for (let i = 1; i < list.length; i++)
					expect(byeOf(list[i])).not.toBe(byeOf(list[i - 1]))
			}),
		)
	})

	it('the bye is the first shuffled id that did not bye last ante', () => {
		// 3 alive, previous bye p2: the first shuffled id that is not p2 byes
		const previous: PvpPairing = {
			ante: 1,
			partners: {},
			usedPairs: [],
			lastBye: 'p2',
		}
		const alive = ids(3)
		const order = shuffled(alive, rng(5))
		const expected = order.find((id) => id !== 'p2')
		expect(byeOf(pairNemesis(alive, previous, 2, rng(5)))).toBe(expected)
	})

	// The reference: the same draw, the same bye, then the first rotation of the
	// circle method with no used pair (or none).
	it('takes the first fresh rotation; the used pairs start over only when none is fresh', () => {
		fc.assert(
			fc.property(aliveCount, seeds, (n, seed) => {
				const alive = ids(n)
				const random = rng(seed)
				const replay = rng(seed)
				let previous: PvpPairing | null = null
				for (let ante = 1; ante <= 8; ante++) {
					const next: PvpPairing = pairNemesis(alive, previous, ante, random)
					const order = shuffled(alive, replay).filter(
						(id) => id !== next.lastBye,
					)
					const used = new Set(previous?.usedPairs ?? [])
					const rotations = Array.from({ length: order.length - 1 }, (_, k) =>
						circleRound(order, k).map(([a, b]) => key(a, b)),
					)
					const fresh = rotations.find((r) => r.every((k) => !used.has(k)))
					if (fresh) {
						expect(pairsOf(next)).toEqual([...fresh].sort())
						expect([...next.usedPairs].sort()).toEqual(
							[...used, ...fresh].sort(),
						)
					} else {
						expect(pairsOf(next)).toEqual([...rotations[0]].sort())
						expect([...next.usedPairs].sort()).toEqual([...rotations[0]].sort())
					}
					previous = next
				}
			}),
		)
	})

	// Worked out by hand from the round-robin pairing (R27): with ids a..f,
	// rotated[1] = a and rotated[i + 1] = ids[((i - 1 + offset) % 5) + 2] (1-based),
	// then (1,2), (3,4), (5,6). Offset 2: d, e, f, b, c -> a,d,e,f,b,c.
	it.each<[number, [string, string][]]>([
		[
			0,
			[
				['a', 'b'],
				['c', 'd'],
				['e', 'f'],
			],
		],
		[
			1,
			[
				['a', 'c'],
				['d', 'e'],
				['f', 'b'],
			],
		],
		[
			2,
			[
				['a', 'd'],
				['e', 'f'],
				['b', 'c'],
			],
		],
		[
			3,
			[
				['a', 'e'],
				['f', 'b'],
				['c', 'd'],
			],
		],
		[
			4,
			[
				['a', 'f'],
				['b', 'c'],
				['d', 'e'],
			],
		],
	])('circle method, 6 ids, offset %i', (offset, expected) => {
		expect(circleRound(['a', 'b', 'c', 'd', 'e', 'f'], offset)).toEqual(
			expected,
		)
	})

	// Same derivation with `% 3`: offset 1 rotates to a,c,d,b; offset 2 to a,d,b,c.
	it.each<[number, [string, string][]]>([
		[
			0,
			[
				['a', 'b'],
				['c', 'd'],
			],
		],
		[
			1,
			[
				['a', 'c'],
				['d', 'b'],
			],
		],
		[
			2,
			[
				['a', 'd'],
				['b', 'c'],
			],
		],
	])('circle method, 4 ids, offset %i', (offset, expected) => {
		expect(circleRound(['a', 'b', 'c', 'd'], offset)).toEqual(expected)
	})

	// A scripted random, consumed in order; the shuffle goes i = n-1 down to 1 and
	// swaps out[i] with out[floor(r * (i + 1))].
	const scripted = (...draws: number[]) => {
		let next = 0
		return () => {
			if (next >= draws.length) throw new Error('more draws than scripted')
			return draws[next++]
		}
	}

	it.each<
		[
			string,
			string[],
			PvpPairing | null,
			number[],
			PvpPairing['partners'],
			string[],
		]
	>([
		[
			// a,b,c,d -> r=.5: j=2, swap 3<->2: a,b,d,c; r=.9: j=2, stays; r=.1: j=0,
			// swap 1<->0: b,a,d,c. Rotation 0 of b,a,d,c: (b,a), (d,c).
			'4 alive, nothing used: rotation 0 of the shuffle',
			['a', 'b', 'c', 'd'],
			null,
			[0.5, 0.9, 0.1],
			{ a: 'b', b: 'a', c: 'd', d: 'c' },
			['a|b', 'c|d'],
		],
		[
			// same shuffle b,a,d,c; rotation 0 holds a|b (used), rotation 1 of
			// b,a,d,c is b,d,c,a -> (b,d), (c,a), both fresh.
			'4 alive, a|b used: rotation 1',
			['a', 'b', 'c', 'd'],
			{ ante: 1, partners: {}, usedPairs: ['a|b'], lastBye: null },
			[0.5, 0.9, 0.1],
			{ a: 'c', c: 'a', b: 'd', d: 'b' },
			['a|b', 'b|d', 'a|c'],
		],
		[
			// a,b,c -> r=.99: j=2, stays; r=0: j=0, swap 1<->0: b,a,c. a byed last
			// time; the first shuffled id is b, not a, so b byes. Left a,c: (a,c).
			'3 alive: the bye is the first shuffled id that is not last ante bye',
			['a', 'b', 'c'],
			{ ante: 1, partners: {}, usedPairs: [], lastBye: 'a' },
			[0.99, 0],
			{ b: null, a: 'c', c: 'a' },
			['a|c'],
		],
		[
			// the shuffle is b,a,c; last bye b, so the first id that is not b is a
			'3 alive: a repeat bye is skipped',
			['a', 'b', 'c'],
			{ ante: 1, partners: {}, usedPairs: [], lastBye: 'b' },
			[0.99, 0],
			{ a: null, b: 'c', c: 'b' },
			['b|c'],
		],
	])(
		'scripted draw: %s',
		(_what, alive, previous, draws, partners, usedPairs) => {
			const out = pairNemesis(alive, previous, 2, scripted(...draws))
			expect(out.partners).toEqual(partners)
			expect([...out.usedPairs].sort()).toEqual([...usedPairs].sort())
			expect(out.ante).toBe(2)
		},
	)

	it('4 alive: three antes use all 6 pairs, none twice', () => {
		fc.assert(
			fc.property(seeds, (seed) => {
				const list = chain(ids(4), 3, seed)
				const all = list.flatMap(pairsOf)
				expect(new Set(all).size).toBe(6)
				expect(list[2].usedPairs).toHaveLength(6)
			}),
		)
	})

	it('a repeat happens only after a reset (4 alive, fourth ante)', () => {
		const list = chain(ids(4), 4, 3)
		expect(list[3].usedPairs).toHaveLength(2)
	})

	it.each<[string, string[]]>([
		['none alive', []],
		['one alive', ['p1']],
	])('R27: %s -> no partners', (_what, alive) => {
		expect(pairNemesis(alive, null, 2, rng(1))).toEqual({
			ante: 2,
			partners: {},
			usedPairs: [],
			lastBye: null,
		})
	})

	it('fewer than 2 alive keeps the used pairs and the last bye, and draws nothing', () => {
		const previous: PvpPairing = {
			ante: 1,
			partners: { a: 'b', b: 'a' },
			usedPairs: ['a|b'],
			lastBye: 'c',
		}
		const random = () => {
			throw new Error('no draw wanted')
		}
		expect(pairNemesis(['a'], previous, 2, random)).toEqual({
			ante: 2,
			partners: {},
			usedPairs: ['a|b'],
			lastBye: 'c',
		})
	})

	it('the same seed gives the same pairing', () => {
		fc.assert(
			fc.property(aliveCount, seeds, (n, seed) => {
				expect(chain(ids(n), 3, seed)).toEqual(chain(ids(n), 3, seed))
			}),
		)
	})

	it('the input order of the alive ids does not matter', () => {
		fc.assert(
			fc.property(aliveCount, seeds, (n, seed) => {
				const alive = ids(n)
				expect(pairNemesis([...alive].reverse(), null, 1, rng(seed))).toEqual(
					pairNemesis(alive, null, 1, rng(seed)),
				)
			}),
		)
	})
})

// ------------------------------------------------------------ state builders

// A game of `players` that has just started: init has run, round 1 not open.
function started(players: string[], ante = 1): ModeView {
	const s = emptyPvp()
	s.rules = {
		runId: RUN,
		mode: 'nemesis',
		startedCount: players.length,
		startingLives: 4,
		hunterLives: 7,
		deathOnRoundLoss: true,
		pvpStartAnte: 2,
		clocks: { ante: 'none', pvp: null, personal: null },
		timerBaseMs: 150_000,
		timerForgiveness: 0,
		timerIncrementMs: 60_000,
		skipTimeRule: 'lead',
	}
	for (const id of players)
		s.lives.players[id] = {
			lives: 0,
			eliminated: false,
			forfeited: false,
			left: false,
			events: [],
		}
	const inited = nemesisMode.init(s, ctx, {
		startedIds: [],
		picks: {},
		teamPlan: null,
	})
	const round = { ...inited.round.players }
	for (const id of players) round[id] = { ...round[id], ante }
	return { ...inited, round: { ...inited.round, players: round } }
}

const withPairing = (
	state: ModeView,
	partners: { [id: string]: string | null },
	ante = 1,
): ModeView => ({
	...state,
	pairing: { ante, partners, usedPairs: [], lastBye: null },
})

// Round 1 open, then each player's (score, hands) as the hand facts leave them.
function playing(
	state: ModeView,
	scores: { [id: string]: [string, number] },
): ModeView {
	const open = nemesisMode.roundReady(state, ctx)
	const players = { ...open.round.players }
	for (const [id, [score, handsLeft]] of Object.entries(scores))
		players[id] = { ...players[id], score, handsLeft }
	return { ...open, round: { ...open.round, roundId: 1, players } }
}

const kill = (state: ModeView, id: string): ModeView => ({
	...state,
	lives: {
		...state.lives,
		players: {
			...state.lives.players,
			[id]: { ...state.lives.players[id], lives: 0, eliminated: true },
		},
	},
})

// ---------------------------------------------------------------- R28 onAnte

describe('R28: onAnte pairs once per ante', () => {
	const run = (players: string[], ante = 1) => started(players, ante)

	it('with no pairing yet, pairs the alive players at the highest ante', () => {
		const s = nemesisMode.onAnte?.(
			run(['a', 'b', 'c', 'd'], 2),
			testContext(0, 9),
		)
		expect(s?.pairing?.ante).toBe(2)
		expect(Object.keys(s?.pairing?.partners ?? {}).sort()).toEqual([
			'a',
			'b',
			'c',
			'd',
		])
	})

	it('the same seed gives the same pairing', () => {
		const a = nemesisMode.onAnte?.(run(['a', 'b', 'c', 'd']), testContext(0, 4))
		const b = nemesisMode.onAnte?.(run(['a', 'b', 'c', 'd']), testContext(0, 4))
		expect(a?.pairing).toEqual(b?.pairing)
	})

	it('a second call at the same ante returns the same state and draws nothing', () => {
		const first = nemesisMode.onAnte?.(run(['a', 'b', 'c']), ctx)
		if (!first) throw new Error('no onAnte')
		let draws = 0
		const counting = {
			...ctx,
			random: () => {
				draws++
				return 0.5
			},
		}
		const again = nemesisMode.onAnte?.(first, counting)
		expect(again).toBe(first)
		expect(draws).toBe(0)
	})

	it('a higher ante re-pairs from the players alive then', () => {
		const first = nemesisMode.onAnte?.(run(['a', 'b', 'c', 'd']), ctx)
		if (!first) throw new Error('no onAnte')
		const dead = kill(first, 'd')
		const players = { ...dead.round.players }
		for (const id of Object.keys(players))
			players[id] = { ...players[id], ante: 2 }
		const next = nemesisMode.onAnte?.(
			{ ...dead, round: { ...dead.round, players } },
			ctx,
		)
		expect(next?.pairing?.ante).toBe(2)
		expect(Object.keys(next?.pairing?.partners ?? {}).sort()).toEqual([
			'a',
			'b',
			'c',
		])
	})

	it('a partner who dies later stays in the stored pairing', () => {
		const first = nemesisMode.onAnte?.(run(['a', 'b', 'c', 'd']), ctx)
		if (!first) throw new Error('no onAnte')
		const dead = kill(first, 'd')
		expect(nemesisMode.onAnte?.(dead, ctx)).toBe(dead)
		expect(dead.pairing).toEqual(first.pairing)
	})

	it('the ante is read from the highest player, not the first', () => {
		const s = run(['a', 'b', 'c'])
		const players = { ...s.round.players, b: { ...s.round.players.b, ante: 3 } }
		const next = nemesisMode.onAnte?.(
			{ ...s, round: { ...s.round, players } },
			ctx,
		)
		expect(next?.pairing?.ante).toBe(3)
	})
})

// ------------------------------------------------------------ R29 resolution

describe('R29: resolveRound resolves each pair on its own', () => {
	const P = ['a', 'b', 'c', 'd']
	const PAIRED = { a: 'b', b: 'a', c: 'd', d: 'c' }
	const resolve = (s: ModeView) => nemesisMode.resolveRound(s, ctx)

	it.each<[string, { [id: string]: [string, number] }, string[]]>([
		[
			'each pair loses its lower score',
			{ a: ['10', 0], b: ['5', 0], c: ['3', 0], d: ['7', 0] },
			['c', 'b'].sort(),
		],
		[
			'Talisman strings compare as numbers, not as text',
			{ a: ['9', 0], b: ['10', 0], c: ['1', 0], d: ['1', 0] },
			['a'],
		],
		[
			'an exact tie in one pair loses nobody there',
			{ a: ['5', 0], b: ['5', 0], c: ['3', 0], d: ['7', 0] },
			['c'],
		],
		[
			'every pair tied: no loser',
			{ a: ['5', 0], b: ['5', 0], c: ['7', 0], d: ['7', 0] },
			[],
		],
	])('%s', (_what, scores, losers) => {
		const s = resolve(playing(withPairing(started(P), PAIRED), scores))
		expect(s.round.phase).toBe('resolved')
		expect(s.round.lastResult).toEqual({ roundId: 1, losers })
	})

	it('waits while an alive player still has hands', () => {
		const s = playing(withPairing(started(P), PAIRED), {
			a: ['10', 0],
			b: ['5', 0],
			c: ['3', 1],
			d: ['7', 0],
		})
		expect(resolve(s)).toBe(s)
	})

	it('waits for a player of another pair too (no early resolve of the finished pair)', () => {
		const s = playing(withPairing(started(P), PAIRED), {
			a: ['10', 0],
			b: ['5', 0],
			c: ['3', 4],
			d: ['7', 4],
		})
		expect(resolve(s).round.phase).toBe('playing')
	})

	it('the byed player never loses', () => {
		const s = playing(
			withPairing(started(['a', 'b', 'c']), { a: 'b', b: 'a', c: null }),
			{
				a: ['10', 0],
				b: ['5', 0],
				c: ['0', 0],
			},
		)
		expect(resolve(s).round.lastResult?.losers).toEqual(['b'])
	})

	it('a dead partner counts as a bye', () => {
		const s = kill(
			playing(
				withPairing(started(['a', 'b', 'c']), { a: 'b', b: 'a', c: null }),
				{
					a: ['1', 0],
					b: ['9', 0],
					c: ['5', 0],
				},
			),
			'b',
		)
		// a and c are alive, a's partner b is dead, c byes: nobody loses
		expect(resolve(s).round.lastResult).toEqual({ roundId: 1, losers: [] })
	})

	it('two alive who are each paired with a dead player: no loser', () => {
		const s = kill(
			kill(
				playing(withPairing(started(P), PAIRED), {
					a: ['1', 0],
					b: ['9', 0],
					c: ['5', 0],
					d: ['2', 0],
				}),
				'b',
			),
			'd',
		)
		const out = resolve(s)
		expect(out.round.phase).toBe('resolved')
		expect(out.round.lastResult?.losers).toEqual([])
	})

	it('a player who left (not in the pairing as alive) loses nothing', () => {
		const base = playing(
			withPairing(started(['a', 'b', 'c']), { a: 'b', b: 'a', c: null }),
			{
				a: ['1', 0],
				b: ['9', 0],
				c: ['5', 0],
			},
		)
		const s: ModeView = {
			...base,
			lives: {
				...base.lives,
				players: {
					...base.lives.players,
					b: { ...base.lives.players.b, left: true, eliminated: true },
				},
			},
		}
		expect(resolve(s).round.lastResult?.losers).toEqual([])
	})

	it('with no pairing the round still resolves with no loser', () => {
		const s = playing(started(['a', 'b', 'c']), {
			a: ['1', 0],
			b: ['9', 0],
			c: ['5', 0],
		})
		expect(resolve(s).round.lastResult?.losers).toEqual([])
	})

	it.each<[string, (s: ModeView) => ModeView]>([
		['not playing', (s) => ({ ...s, round: { ...s.round, phase: 'shop' } })],
		[
			'already resolved',
			(s) => ({ ...s, round: { ...s.round, phase: 'resolved' } }),
		],
		[
			'a result is set',
			(s) => ({
				...s,
				result: { ...s.result, runId: RUN, kind: 'draw', places: [] },
			}),
		],
		['fewer than 2 alive', (s) => kill(kill(s, 'b'), 'c')],
	])('no resolution: %s', (_what, mutate) => {
		const s = mutate(
			playing(
				withPairing(started(['a', 'b', 'c']), { a: 'b', b: 'a', c: null }),
				{
					a: ['1', 0],
					b: ['9', 0],
					c: ['5', 0],
				},
			),
		)
		expect(resolve(s)).toBe(s)
	})

	it('never writes roundId or lives', () => {
		const before = playing(withPairing(started(P), PAIRED), {
			a: ['1', 0],
			b: ['2', 0],
			c: ['3', 0],
			d: ['4', 0],
		})
		const after = resolve(before)
		expect(after.round.roundId).toBe(before.round.roundId)
		expect(after.lives).toEqual(before.lives)
	})

	it('losers are one per pair, never the bye, whatever the scores', () => {
		fc.assert(
			fc.property(
				aliveCount,
				seeds,
				fc.array(fc.integer({ min: 0, max: 5 }), {
					minLength: 8,
					maxLength: 8,
				}),
				(n, seed, nums) => {
					const alive = ids(n)
					const pairing = pairNemesis(alive, null, 1, rng(seed))
					const scores: { [id: string]: [string, number] } = {}
					alive.forEach((id, i) => {
						scores[id] = [String(nums[i]), 0]
					})
					const out = resolve(
						playing(withPairing(started(alive), pairing.partners), scores),
					)
					const losers = out.round.lastResult?.losers ?? []
					const bye = byeOf(pairing)
					expect(losers).not.toContain(bye)
					expect(losers.length).toBeLessThanOrEqual(Math.floor(n / 2))
					expect([...losers].sort()).toEqual(losers)
					for (const loser of losers) {
						const partner = pairing.partners[loser] as string
						expect(Number(scores[loser][0])).toBeLessThan(
							Number(scores[partner][0]),
						)
					}
				},
			),
		)
	})
})

// ------------------------------------------------------- R30 winner and view

describe('R30: the match ends at 1 alive (win) or 0 alive (draw)', () => {
	it('three alive: no result', () => {
		const s = started(['a', 'b', 'c'])
		expect(nemesisMode.checkWinner(s, ctx)).toBe(s)
	})

	it('one alive wins', () => {
		const s = nemesisMode.checkWinner(
			kill(kill(started(['a', 'b', 'c']), 'a'), 'b'),
			ctx,
		)
		expect(s.result).toMatchObject({ kind: 'win', winnerId: 'c' })
	})

	it('none alive is a draw', () => {
		const s = nemesisMode.checkWinner(
			kill(kill(kill(started(['a', 'b', 'c']), 'a'), 'b'), 'c'),
			ctx,
		)
		expect(s.result).toMatchObject({ kind: 'draw', winnerId: null })
	})

	it('picks the nemesis rules for a started count of 3 and more', () => {
		expect(pickMode('nemesis', 3)).toBe(nemesisMode)
		expect(pickMode('nemesis', 5)).toBe(nemesisMode)
	})
})

describe('view', () => {
	const view = (s: ModeView) => nemesisMode.view?.(s)

	it('shows the stored partner of each alive player, null for the bye', () => {
		const s = withPairing(
			started(['a', 'b', 'c']),
			{ a: 'b', b: 'a', c: null },
			2,
		)
		expect(view(s)).toEqual({
			opponents: { a: 'b', b: 'a', c: null },
			pairingAnte: 2,
		})
	})

	it('a partner who died is still the target of the survivor, and the dead are left out', () => {
		const s = kill(
			withPairing(started(['a', 'b', 'c']), { a: 'b', b: 'a', c: null }),
			'b',
		)
		expect(view(s)?.opponents).toEqual({ a: 'b', c: null })
	})

	it('with no pairing: every alive player null, pairingAnte null', () => {
		expect(view(started(['a', 'b', 'c']))).toEqual({
			opponents: { a: null, b: null, c: null },
			pairingAnte: null,
		})
	})

	it('the view has no safe', () => {
		expect(view(started(['a', 'b', 'c']))).not.toHaveProperty('safe')
	})

	it('reads the same on state read back from the runtime', () => {
		const s = withPairing(started(['a', 'b', 'c']), { a: 'b', b: 'a', c: null })
		expect(view(fromRuntime(s))).toEqual(view(s))
		expect(aliveIds(fromRuntime(s))).toEqual(['a', 'b', 'c'])
	})
})

// ----------------------------------------------------------- tick, 3 players

describe('through the tick (3 players, queue_mode pvp_nemesis)', () => {
	const info = (name: string) => ({
		displayName: name,
		preferredJoker: null,
		mods: null,
	})
	const tickCtx = testContext(1000)
	let counter = 0
	const actionCtx = () => ({
		now: 1000,
		newSeed: () => `SEED${++counter}`,
		newId: () => `RUN${++counter}`,
		random: () => 0,
	})
	const send = (
		lobby: Lobby,
		from: string,
		name: string,
		params: unknown = {},
	) =>
		action(
			lobby,
			from,
			{ cid: `${name}-${from}`, action: name, to: 'server', params },
			actionCtx(),
		)

	type Send = Extract<Outbound, { kind: 'send' }>
	const changedOf = (step: Step): { [k: string]: unknown } => {
		const state = step.out.find(
			(o): o is Send => o.kind === 'send' && o.op === ServerOp.STATE,
		)
		return (state?.payload as { changed: { [k: string]: unknown } }).changed
	}

	const PLAYERS = ['a', 'b', 'c']

	// The lobby with the game started, before the first tick.
	function beforeFirstTick(): Lobby {
		let lobby = newLobby({
			code: 'ABC123',
			modId: 'MultiplayerPvP',
			maxPlayers: 8,
			creatorId: 'a',
			now: 0,
			graceMs: 10_000,
			resultTimeoutMs: 60_000,
		})
		for (const id of PLAYERS)
			lobby = join(lobby, id, `${id}-s1`, info(id)).lobby
		lobby = { ...lobby, metadata: withRules({ ruleset: 'ruleset_mp_traditional', queue_mode: 'pvp_nemesis' }) }
		for (const id of PLAYERS.slice(1))
			lobby = send(lobby, id, 'mpapi_ready', { ready: true }).lobby
		return raced(send(lobby, 'a', 'mpapi_start_game', { stake: 2 }).lobby)
	}

	const stateOf = (lobby: Lobby) => {
		const s = refereeOf(lobby)
		if (!s) throw new Error('no referee state')
		return s
	}

	function ready(lobby: Lobby, id: string): Lobby {
		const pvp = pvpOf(lobby)
		if (!pvp) throw new Error('no pvp state')
		const r = readyReducer.reduce(
			lobby,
			id,
			{
				runId: pvp.runId,
				roundId: pvp.round + 1,
				startingHands: 4,
				blindKey: '2:Boss',
			},
			tickCtx,
		)
		if (!r.ok) throw new Error(`refused: ${r.reason}`)
		return r.lobby
	}

	function fact(lobby: Lobby, type: string, from: string, args: object): Lobby {
		const result = FACT_REDUCERS[type](stateOf(lobby), from, {
			runId: stateOf(lobby).runId,
			...args,
		})
		if (!result.ok) throw new Error(`refused: ${result.reason}`)
		return withReferee(lobby, result.state)
	}

	const tick = (lobby: Lobby): Step => pvpTick(fromRuntime(lobby), tickCtx)

	// The first tick seats the players with nothing reported, so nobody can be
	// paired; once every player has reported ante 1 the next tick pairs it.
	function firstPairing(): Step {
		let l = tick(beforeFirstTick()).lobby
		expect(stateOf(l).pairing).toBeNull()
		for (const id of PLAYERS)
			l = fact(l, 'pvp.progress', id, { ante: 1, furthestBlind: 0 })
		return tick(l)
	}

	it('pairs ante 1 on the first tick, takes one life from the lower of the pair, then re-pairs at ante 2', () => {
		const first = firstPairing()
		const pairing = stateOf(first.lobby).pairing
		if (!pairing) throw new Error('ante 1 was not paired on the first tick')
		expect(pairing.ante).toBe(1)
		const bye = byeOf(pairing)
		if (bye === null) throw new Error('3 players must have a bye')
		const [x, y] = PLAYERS.filter((id) => id !== bye)
		expect(pairing.partners).toEqual({ [x]: y, [y]: x, [bye]: null })

		// the announced pvp.targets carries the opponents and the pairing ante
		expect(changedOf(first)['pvp.targets']).toMatchObject({
			opponents: { [x]: y, [y]: x, [bye]: null },
			pairingAnte: 1,
		})

		// a full PvP round: x scores more than y, the bye scores nothing at all
		let l = first.lobby
		for (const id of PLAYERS) l = ready(l, id)
		l = tick(l).lobby
		expect(stateOf(l).round.phase).toBe('playing')
		l = fact(l, 'pvp.hand', x, { roundId: 1, score: '10', handsLeft: 0, timerLossesApplied: 0 })
		l = fact(l, 'pvp.hand', y, { roundId: 1, score: '9', handsLeft: 0, timerLossesApplied: 0 })
		l = fact(l, 'pvp.hand', bye, { roundId: 1, score: '0', handsLeft: 0, timerLossesApplied: 0 })
		const resolved = tick(l)
		const lives = stateOf(resolved.lobby).lives.players
		expect(lives[y].lives).toBe(3)
		expect(lives[x].lives).toBe(4)
		expect(lives[bye].lives).toBe(4)
		expect(stateOf(resolved.lobby).pairing).toEqual(pairing)

		// ante 2: the pairing is made again and announced
		l = fact(resolved.lobby, 'pvp.progress', x, { ante: 2, furthestBlind: 1 })
		const second = tick(l)
		expect(stateOf(second.lobby).pairing?.ante).toBe(2)
		expect(changedOf(second)['pvp.targets']).toMatchObject({ pairingAnte: 2 })

		// and a later tick at the same ante changes nothing
		expect(tick(second.lobby).lobby).toEqual(second.lobby)
	})

	// No honest client reports a new ante during a PvP round (the Boss ends only
	// when the server resolves it), so this is a wrong or cheating client.
	it('a new ante reported during an open round re-pairs only once the round resolves', () => {
		const first = firstPairing()
		const pairing = stateOf(first.lobby).pairing
		if (!pairing) throw new Error('ante 1 was not paired on the first tick')
		const bye = byeOf(pairing)
		if (bye === null) throw new Error('3 players must have a bye')
		const [x, y] = PLAYERS.filter((id) => id !== bye)

		let l = first.lobby
		for (const id of PLAYERS) l = ready(l, id)
		l = tick(l).lobby
		expect(stateOf(l).round.phase).toBe('playing')

		// the round is open: the pairing stays
		l = fact(l, 'pvp.progress', y, { ante: 2, furthestBlind: 1 })
		l = tick(l).lobby
		expect(stateOf(l).round.phase).toBe('playing')
		expect(stateOf(l).pairing).toEqual(pairing)

		// the round resolves on the pairing it was played with, then ante 2 is paired
		l = fact(l, 'pvp.hand', x, { roundId: 1, score: '10', handsLeft: 0, timerLossesApplied: 0 })
		l = fact(l, 'pvp.hand', y, { roundId: 1, score: '9', handsLeft: 0, timerLossesApplied: 0 })
		l = fact(l, 'pvp.hand', bye, { roundId: 1, score: '0', handsLeft: 0, timerLossesApplied: 0 })
		const resolved = tick(l)
		const after = stateOf(resolved.lobby)
		expect(after.round.lastResult).toEqual({ roundId: 1, losers: [y] })
		expect(after.lives.players[y].lives).toBe(3)
		expect(after.lives.players[x].lives).toBe(4)
		expect(after.lives.players[bye].lives).toBe(4)
		expect(after.pairing?.ante).toBe(2)
		expect(changedOf(resolved)['pvp.targets']).toMatchObject({ pairingAnte: 2 })
	})

	// The round close pins each player's skip lead to the ante 1 partner; the
	// ante 2 re-pair must move the pin, or the lead counts a player not faced.
	it('the ante 2 re-pair moves the skip-lead pin to the new partner', () => {
		const first = firstPairing()
		const pairing = stateOf(first.lobby).pairing
		if (!pairing) throw new Error('ante 1 was not paired on the first tick')
		const bye = byeOf(pairing)
		if (bye === null) throw new Error('3 players must have a bye')
		const [x, y] = PLAYERS.filter((id) => id !== bye)

		let l = first.lobby
		for (const id of PLAYERS) l = ready(l, id)
		l = tick(l).lobby
		l = fact(l, 'pvp.hand', x, { roundId: 1, score: '10', handsLeft: 0, timerLossesApplied: 0 })
		l = fact(l, 'pvp.hand', y, { roundId: 1, score: '9', handsLeft: 0, timerLossesApplied: 0 })
		l = fact(l, 'pvp.hand', bye, { roundId: 1, score: '0', handsLeft: 0, timerLossesApplied: 0 })
		l = tick(l).lobby
		expect(stateOf(l).facts.skips[x].facing).toBe(y)

		l = fact(l, 'pvp.progress', x, { ante: 2, furthestBlind: 1 })
		const after = stateOf(tick(l).lobby)
		const partners = after.pairing?.partners
		if (!partners || after.pairing?.ante !== 2) throw new Error('ante 2 was not paired')
		expect(partners[x]).not.toBe(y)
		// A null pin (the ante 1 bye) means the live opponent, so the one counted is:
		for (const id of PLAYERS)
			expect(after.facts.skips[id].facing ?? partners[id]).toBe(partners[id])
	})
})
