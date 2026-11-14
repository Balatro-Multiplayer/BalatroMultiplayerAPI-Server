// The tick's team seams: a team's life pool is lost once per team for a non-PvP
// blind (a lost PvP round once per team too), the guard is the team's, and a voucher names
// its gainers. No real team mode has
// landed, so the rules here are a stub: the teams come from a fixed plan and
// the team with the lower score total loses the round. Every state read goes
// through `fromRuntime`, so nothing relies on object identity.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { PvpLastStart } from '../protocol'
import { testContext } from '../../testing/request_context'
import { reportedPlayer } from '../../testing/pvp_fixtures'
import { fromRuntime } from '../../testing/runtime_state'
import { FACT_REDUCERS } from './facts'
import { gainVoucherLives, runOut as ledgerRunOut } from './lives'
import { handsDone } from './modes/common'
import { duelMode } from './modes/duel'
import { teamsMode } from './modes/teams'
import { inertMode } from './modes/testing'
import type { Mode } from './modes/types'
import {
	type PvpFact,
	type PvpLifeEvent,
	type PvpTeam,
	type RefereeState,
	emptyFacts,
	emptyPvp,
} from './state'
import { type ModeFor, type TickEnv, decide } from './tick'
import { withRules } from '../../testing/pvp_rules'

const ctx = testContext(1000)

type Plan = [string[], string[]]
const TWO_V_TWO: Plan = [
	['a', 'b'],
	['c', 'd'],
]
const TWO_V_ONE: Plan = [['a', 'b'], ['c']]

interface StubOptions {
	// false: no team pool, every loser pays their own lives
	pooled?: boolean
	// the order the losing team's members are named in `lastResult`
	order?: 'asc' | 'desc'
}

const teamsOf = (plan: Plan): { [id: string]: PvpTeam } => {
	const teams: { [id: string]: PvpTeam } = {}
	for (const id of plan[0]) teams[id] = 'A'
	for (const id of plan[1]) teams[id] = 'B'
	return teams
}

// Teams A and B from a fixed plan, a pool of the starting lives each, and a
// round that the team with the lower score total loses (a tie loses nothing).
function stubRules(plan: Plan, options: StubOptions = {}): Mode {
	const { pooled = true, order = 'asc' } = options
	const teams = teamsOf(plan)
	const members = (team: PvpTeam): string[] =>
		Object.keys(teams).filter((id) => teams[id] === team)
	return {
		...inertMode('teams'),
		lifePool: pooled ? teamsMode.lifePool : undefined,
		init: (state) => {
			const { rules } = state
			if (rules.runId === null || state.round.runId === rules.runId)
				return state
			const n = rules.startingLives
			const players: RefereeState['round']['players'] = {}
			for (const id of Object.keys(teams))
				players[id] = reportedPlayer()
			return {
				...state,
				round: { ...state.round, players },
				teams: { ...state.teams, teams },
				lives: {
					...state.lives,
					teamLives: pooled ? { A: n, B: n } : null,
				},
			}
		},
		roundReady: duelMode.roundReady,
		resolveRound: (state) => {
			if (state.round.phase !== 'playing') return state
			const out = (id: string): boolean => {
				const seat = state.lives.players[id]
				return seat.forfeited || seat.left
			}
			const standing = Object.keys(teams).filter((id) => !out(id))
			// With nobody left a real mode ends the game; this stub has no winner
			// rule, so it leaves the round alone (a re-tick would resolve a round the
			// tick has just opened).
			if (standing.length === 0) return state
			if (standing.some((id) => !handsDone(state.round.players[id])))
				return state
			const total = (team: PvpTeam): number =>
				members(team).reduce(
					(sum, id) => sum + Number(state.round.players[id].score),
					0,
				)
			const a = total('A')
			const b = total('B')
			const losing = a === b ? [] : members(a < b ? 'A' : 'B')
			return {
				...state,
				round: {
					...state.round,
					phase: 'resolved',
					lastResult: {
						roundId: state.round.roundId,
						losers: order === 'asc' ? losing : [...losing].reverse(),
					},
				},
			}
		},
	}
}

const modeFor =
	(plan: Plan, options: StubOptions = {}): ModeFor =>
	() =>
		stubRules(plan, options)

const envOf = (plan: Plan, gone: string[] = []): TickEnv => {
	const ids = [...plan[0], ...plan[1]]
	return {
		runId: 'r1',
		startedIds: ids,
		seatedIds: ids.filter((id) => !gone.includes(id)),
		readyIds: [],
		readiedIds: [],
		raceStarted: true,
		ranked: false,
		requiredIds: ids.filter((id) => !gone.includes(id)),
		awayIds: [],
		metadata: withRules({ ruleset: 'ruleset_mp_traditional' }),
		picks: {},
		teamPlan: null,
	}
}

const idsOf = (plan: Plan): string[] => [...plan[0], ...plan[1]]
const startFor = (
	plan: Plan,
	blindKeys: { [id: string]: string },
	roundId = 1,
): PvpLastStart => ({
	roundId,
	firstPlayer: 'a',
	players: idsOf(plan),
	blindKeys,
})
const bossKeys = (plan: Plan, key: string): { [id: string]: string } => {
	const keys: { [id: string]: string } = {}
	for (const id of [...plan[0], ...plan[1]]) keys[id] = key
	return keys
}

// A frozen team game with round 1 open (the blind keys of the Readies are
// `blindKey` for everyone, or one key per player when a map is given; absent
// keys fall back to the ante's Boss).
function open(
	plan: Plan = TWO_V_TWO,
	options: StubOptions = {},
	blindKey?: string | { [id: string]: string },
): RefereeState {
	const idle: RefereeState = {
		...emptyPvp(),
		facts: emptyFacts(),
		runId: 'r1',
		lastStart: startFor(
			plan,
			blindKey === undefined
				? bossKeys(plan, '1:Boss')
				: typeof blindKey === 'string'
					? bossKeys(plan, blindKey)
					: blindKey,
		),
	}
	return decide(idle, envOf(plan), ctx, modeFor(plan, options)).state
}

// The next start has arrived: everyone Readied `blindKey` for round n+1.
function nextRound(
	state: RefereeState,
	plan: Plan,
	blindKey: string,
): RefereeState {
	const start = state.lastStart
	if (start === null) throw new Error('no start')
	return {
		...state,
		lastStart: {
			...start,
			roundId: start.roundId + 1,
			blindKeys: bossKeys(plan, blindKey),
		},
	}
}

const step = (
	state: RefereeState,
	plan: Plan = TWO_V_TWO,
	options: StubOptions = {},
	gone: string[] = [],
): RefereeState =>
	fromRuntime(
		decide(fromRuntime(state), envOf(plan, gone), ctx, modeFor(plan, options))
			.state,
	)

function post(
	state: RefereeState,
	type: string,
	id: string,
	args: object = {},
): RefereeState {
	const r = FACT_REDUCERS[type](state, id, { runId: 'r1', ...args })
	if (!r.ok) throw new Error(`refused: ${r.reason}`)
	return r.state
}
const failBlind = (state: RefereeState, id: string, blindKey: string) =>
	post(state, 'pvp.blind', id, { blindKey, beaten: false, roundLost: true })
// the server's own run-out of `id`: it knows no blind, so no blind is recorded failed
const runOut = (state: RefereeState, id: string) =>
	ledgerRunOut(state, teamsMode, id)

// Every started seat scores `scores[team]` with no hands left: the round ends.
function played(
	state: RefereeState,
	plan: Plan,
	scoreA: number,
	scoreB: number,
): RefereeState {
	const teams = teamsOf(plan)
	const players = { ...state.round.players }
	for (const id of Object.keys(teams))
		players[id] = {
			...players[id],
			score: String(teams[id] === 'A' ? scoreA : scoreB),
			handsLeft: 0,
		}
	return { ...state, round: { ...state.round, players } }
}
// Team A scores less than team B, so team A loses the round.
const aLoses = (state: RefereeState, plan: Plan = TWO_V_TWO): RefereeState =>
	played(state, plan, 1, 9)

const withSeat = (
	state: RefereeState,
	id: string,
	seat: Partial<RefereeState['lives']['players'][string]>,
): RefereeState => ({
	...state,
	lives: {
		...state.lives,
		players: {
			...state.lives.players,
			[id]: { ...state.lives.players[id], ...seat },
		},
	},
})
const withPool = (
	state: RefereeState,
	pool: { A: number; B: number },
): RefereeState => {
	let next: RefereeState = {
		...state,
		lives: { ...state.lives, teamLives: pool },
	}
	const teams = state.teams.teams
	for (const id of Object.keys(teams))
		next = withSeat(next, id, {
			lives: pool[teams[id] === 'A' ? 'A' : 'B'],
			eliminated: pool[teams[id] === 'A' ? 'A' : 'B'] <= 0,
		})
	return next
}

const pool = (s: RefereeState) => s.lives.teamLives
const livesOf = (s: RefereeState, id: string): number =>
	s.lives.players[id].lives
const eventsOf = (s: RefereeState, id: string): PvpLifeEvent[] =>
	s.lives.players[id].events
const LOSS = (key: string): PvpLifeEvent => ({ delta: -1, key })

describe('a team loses one life, not one per member (R47, R48)', () => {
	it('a lost PvP round drops the losing pool by one; every member shows the pool and the same event', () => {
		const s = step(aLoses(open()))
		expect(pool(s)).toEqual({ A: 3, B: 4 })
		for (const id of ['a', 'b']) {
			expect(livesOf(s, id)).toBe(3)
			expect(eventsOf(s, id)).toEqual([LOSS('pvp:1')])
		}
		for (const id of ['c', 'd']) {
			expect(livesOf(s, id)).toBe(4)
			expect(eventsOf(s, id)).toEqual([])
		}
	})

	it('the losers named in either order cost the same single life', () => {
		const asc = step(aLoses(open()), TWO_V_TWO, { order: 'asc' })
		const desc = step(aLoses(open(TWO_V_TWO, { order: 'desc' })), TWO_V_TWO, {
			order: 'desc',
		})
		expect(desc.lives).toEqual(asc.lives)
		expect(pool(desc)).toEqual({ A: 3, B: 4 })
	})

	// The members Readied on different blinds and only b failed its own: the
	// team's charge goes through the smallest id (a, on 2:Boss), so whichever way
	// the losers are named the PvP loss is not blocked by b's roundLost.
	it('the losers in either order cost the same when the members Readied on different blinds', () => {
		const keys = { a: '2:Boss', b: '3:Boss', c: '2:Boss', d: '3:Boss' }
		const outcome = (order: 'asc' | 'desc'): RefereeState => {
			const options = { order }
			const s = failBlind(open(TWO_V_TWO, options, keys), 'b', '3:Boss')
			return step(aLoses(s), TWO_V_TWO, options)
		}
		const asc = outcome('asc')
		const desc = outcome('desc')
		expect(pool(asc)).toEqual({ A: 2, B: 4 })
		expect(desc.lives).toEqual(asc.lives)
		expect(eventsOf(desc, 'b')).toEqual([LOSS('3:Boss'), LOSS('pvp:1')])
	})

	it('a tie costs nobody a life', () => {
		const s = step(played(open(), TWO_V_TWO, 5, 5))
		expect(pool(s)).toEqual({ A: 4, B: 4 })
	})

	it.each<
		[string, (s: RefereeState) => RefereeState, { A: number; B: number }]
	>([
		[
			'two members failing the same blind cost the team one life',
			(s) => failBlind(failBlind(s, 'a', '1:Small'), 'b', '1:Small'),
			{ A: 3, B: 4 },
		],
		[
			'one member failing the same blind twice costs one life',
			(s) => failBlind(failBlind(s, 'a', '1:Small'), 'a', '1:Small'),
			{ A: 3, B: 4 },
		],
		[
			'one member failing a second blind before anyone moves on costs one life',
			(s) => failBlind(failBlind(s, 'a', '1:Small'), 'a', '1:Big'),
			{ A: 3, B: 4 },
		],
		[
			'both teams failing the same blind cost one life each',
			(s) => failBlind(failBlind(s, 'a', '1:Small'), 'c', '1:Small'),
			{ A: 3, B: 3 },
		],
		[
			'two members running out of ante time cost two lives',
			(s) => runOut(runOut(s, 'a'), 'b'),
			{ A: 2, B: 4 },
		],
		[
			'one member running out twice in a blind costs two lives',
			(s) => runOut(runOut(s, 'a'), 'a'),
			{ A: 2, B: 4 },
		],
		[
			'a run-out and a failed blind on the same blind cost two lives',
			(s) => failBlind(runOut(s, 'a'), 'b', '1:Small'),
			{ A: 2, B: 4 },
		],
		[
			'a failed blind that is not roundLost costs nothing',
			(s) =>
				post(s, 'pvp.blind', 'a', {
					blindKey: '1:Small',
					beaten: false,
					roundLost: false,
				}),
			{ A: 4, B: 4 },
		],
	])('%s', (_name, act, expected) => {
		expect(pool(step(act(open())))).toEqual(expected)
	})

	describe('a non-PvP blind failed by several teammates costs the pool one life', () => {
		const THREE_V_ONE: Plan = [['a', 'b', 'e'], ['c']]

		it('two teammates failing the same non-PvP Boss: the pool drops by one and each seat shows the one loss', () => {
			const s = step(failBlind(failBlind(open(), 'a', '2:Boss'), 'b', '2:Boss'))
			expect(pool(s)).toEqual({ A: 3, B: 4 })
			for (const id of ['a', 'b'])
				expect(eventsOf(s, id)).toEqual([LOSS('2:Boss')])
		})

		it('three teammates failing a non-PvP blind cost one', () => {
			let s = open(THREE_V_ONE)
			for (const id of ['a', 'b', 'e']) s = failBlind(s, id, '1:Small')
			expect(pool(step(s, THREE_V_ONE))).toEqual({ A: 3, B: 4 })
		})

		// The client sends pvp.progress with furthestBlind = ante * 10 + the blind index
		// (Small 1, Big 2, Boss 3) when a blind is selected; the facts are consumed in
		// the order they arrived, so one tick holds the whole sequence.
		const select = (s: RefereeState, id: string, blind: number): RefereeState =>
			post(s, 'pvp.progress', id, { ante: 3, furthestBlind: 30 + blind })

		it('a fails 3:Big, b selects 3:Big, b fails it: two lives', () => {
			let s = failBlind(open(), 'a', '3:Big')
			s = failBlind(select(s, 'b', 2), 'b', '3:Big')
			expect(pool(step(s))).toEqual({ A: 2, B: 4 })
		})

		it('the same sequence over separate ticks costs two lives too', () => {
			let s = step(failBlind(open(), 'a', '3:Big'))
			s = step(select(s, 'b', 2))
			s = step(failBlind(s, 'b', '3:Big'))
			expect(pool(s)).toEqual({ A: 2, B: 4 })
		})

		it('no progress fact stays in the log once the tick has read it', () => {
			const s = step(select(failBlind(open(), 'a', '3:Big'), 'b', 2))
			expect(s.facts.log.filter((f) => f.type === 'progress')).toEqual([])
		})

		it('a duplicate or stale pvp.progress does not re-arm the guard: one life', () => {
			let s = step(select(open(), 'b', 2))
			s = step(failBlind(s, 'a', '3:Big'))
			expect(pool(s)).toEqual({ A: 3, B: 4 })
			// b re-sends the same furthestBlind, then a lower one: both change nothing
			s = step(select(s, 'b', 2))
			s = step(select(s, 'b', 1))
			s = step(failBlind(s, 'b', '3:Big'))
			expect(pool(s)).toEqual({ A: 3, B: 4 })
		})

		it('a and b both select Big, then both fail it: one life', () => {
			let s = select(select(open(), 'a', 2), 'b', 2)
			s = failBlind(failBlind(s, 'a', '3:Big'), 'b', '3:Big')
			expect(pool(step(s))).toEqual({ A: 3, B: 4 })
		})

		it('one player fails 3:Small, selects Big, then fails it: two lives', () => {
			let s = failBlind(open(), 'a', '3:Small')
			s = failBlind(select(s, 'a', 2), 'a', '3:Big')
			expect(pool(step(s))).toEqual({ A: 2, B: 4 })
		})

		it('a fails 3:Big, then b fails 3:Small before anyone selects a blind: one life', () => {
			let s = step(failBlind(open(), 'a', '3:Big'))
			s = step(failBlind(s, 'b', '3:Small'))
			expect(pool(s)).toEqual({ A: 3, B: 4 })
		})

		it('a failure followed by a teammate select in one tick is charged before the select', () => {
			const s = step(select(failBlind(open(), 'a', '3:Big'), 'b', 2))
			expect(pool(s)).toEqual({ A: 3, B: 4 })
			// the select re-armed the guard: the next failure costs again
			expect(pool(step(failBlind(s, 'b', '3:Big')))).toEqual({ A: 2, B: 4 })
		})

		it('the same player failing the same blind twice, in two ticks, costs one', () => {
			let s = step(failBlind(open(), 'a', '1:Small'))
			s = step(failBlind(s, 'a', '1:Small'))
			expect(pool(s)).toEqual({ A: 3, B: 4 })
		})

		it('a pool of one with two failures goes to 0, not below', () => {
			const s = step(
				failBlind(
					failBlind(withPool(open(), { A: 1, B: 4 }), 'a', '1:Small'),
					'b',
					'1:Small',
				),
			)
			expect(pool(s)).toEqual({ A: 0, B: 4 })
			expect(eventsOf(s, 'b')).toEqual([LOSS('1:Small')])
		})

		it('two teammates failing the same blind in two ticks cost one', () => {
			let s = step(failBlind(open(), 'a', '1:Small'))
			s = step(failBlind(s, 'b', '1:Small'))
			expect(pool(s)).toEqual({ A: 3, B: 4 })
		})
	})

	describe('a PvP loss spends the guard on the blind the team Readied', () => {
		it('a roundLost on that Boss from either member then costs nothing', () => {
			let s = step(aLoses(open(TWO_V_TWO, {}, '2:Boss')))
			expect(pool(s)).toEqual({ A: 3, B: 4 })
			s = step(failBlind(s, 'a', '2:Boss'))
			s = step(failBlind(s, 'b', '2:Boss'))
			expect(pool(s)).toEqual({ A: 3, B: 4 })
			expect(eventsOf(s, 'a')).toEqual([LOSS('pvp:1')])
		})

		it('a roundLost on another blind costs the team one life', () => {
			let s = step(aLoses(open(TWO_V_TWO, {}, '2:Boss')))
			s = step(failBlind(s, 'a', '2:Big'))
			expect(pool(s)).toEqual({ A: 2, B: 4 })
			expect(eventsOf(s, 'b')).toEqual([LOSS('pvp:1'), LOSS('2:Big')])
		})

		it('a fails the Boss, the team loses the round on it, then b fails it: one life in all', () => {
			let s = step(failBlind(open(TWO_V_TWO, {}, '2:Boss'), 'a', '2:Boss'))
			s = step(aLoses(s))
			s = step(failBlind(s, 'b', '2:Boss'))
			expect(pool(s)).toEqual({ A: 3, B: 4 })
			expect(eventsOf(s, 'b')).toEqual([LOSS('2:Boss')])
		})

		it('the team loses the round on the Boss, then a and b fail it: one life in all', () => {
			let s = step(aLoses(open(TWO_V_TWO, {}, '2:Boss')))
			s = step(failBlind(s, 'a', '2:Boss'))
			s = step(failBlind(s, 'b', '2:Boss'))
			expect(pool(s)).toEqual({ A: 3, B: 4 })
			expect(eventsOf(s, 'b')).toEqual([LOSS('pvp:1')])
		})

		it('a and b fail the Boss, then the team loses the round on it: the loss costs nothing more', () => {
			let s = step(failBlind(open(TWO_V_TWO, {}, '2:Boss'), 'a', '2:Boss'))
			s = step(failBlind(s, 'b', '2:Boss'))
			s = step(aLoses(s))
			expect(pool(s)).toEqual({ A: 2, B: 4 })
		})

		it("the other team's guard is its own", () => {
			let s = step(aLoses(open(TWO_V_TWO, {}, '2:Boss')))
			s = step(failBlind(s, 'c', '2:Boss'))
			expect(pool(s)).toEqual({ A: 3, B: 3 })
		})
	})

	// R2, R49: each member's guard on the PvP blind is re-armed when a round opens.
	describe("each member's guard on the PvP blind is re-armed when a round opens", () => {
		const next = (s: RefereeState): RefereeState =>
			step(nextRound(s, TWO_V_TWO, '2:Boss'))

		it('a roundLost on the Boss, then the same Boss Readied in two more rounds: one life per round lost', () => {
			let s = step(failBlind(open(TWO_V_TWO, {}, '2:Boss'), 'a', '2:Boss'))
			expect(pool(s)).toEqual({ A: 3, B: 4 })
			s = step(aLoses(s))
			// round 1's PvP loss is the roundLost already charged on the blind
			expect(pool(s)).toEqual({ A: 3, B: 4 })
			s = step(aLoses(next(s)))
			expect(pool(s)).toEqual({ A: 2, B: 4 })
			s = step(aLoses(next(s)))
			expect(pool(s)).toEqual({ A: 1, B: 4 })
			expect(livesOf(s, 'b')).toBe(1)
		})

		it('a roundLost on the Boss, then the PvP loss on it in the same round, costs the team one life', () => {
			const s = step(
				aLoses(failBlind(open(TWO_V_TWO, {}, '2:Boss'), 'a', '2:Boss')),
			)
			expect(pool(s)).toEqual({ A: 3, B: 4 })
		})

		it('the PvP loss, then a roundLost on the same Boss from the other member, costs the team one life', () => {
			let s = step(aLoses(open(TWO_V_TWO, {}, '2:Boss')))
			s = step(failBlind(s, 'b', '2:Boss'))
			expect(pool(s)).toEqual({ A: 3, B: 4 })
		})
	})

	describe('a pool at 0', () => {
		const lastLife = (): RefereeState => withPool(open(), { A: 1, B: 4 })

		it('marks every member eliminated', () => {
			const s = step(aLoses(lastLife()))
			expect(pool(s)).toEqual({ A: 0, B: 4 })
			for (const id of ['a', 'b'])
				expect(s.lives.players[id]).toMatchObject({
					lives: 0,
					eliminated: true,
				})
			for (const id of ['c', 'd'])
				expect(s.lives.players[id]).toMatchObject({
					lives: 4,
					eliminated: false,
				})
		})

		it('loses nothing more, and adds no event', () => {
			const dead = step(aLoses(lastLife()))
			// an eliminated seat can no longer post, so the loss goes straight to the log
			const lateLoss: PvpFact = {
				type: 'blind',
				playerId: 'a',
				blindKey: '3:Small',
				beaten: false,
				roundLost: true,
			}
			const again = step({
				...dead,
				facts: { ...dead.facts, log: [...dead.facts.log, lateLoss] },
			})
			expect(again.lives).toEqual(dead.lives)
			expect(eventsOf(again, 'a')).toHaveLength(1)
		})
	})

	it('a forfeited member still shows the event and the pool value', () => {
		let s = open()
		s = post(s, 'pvp.forfeit', 'a')
		s = step(aLoses(s))
		expect(pool(s)).toEqual({ A: 3, B: 4 })
		expect(s.lives.players.a.forfeited).toBe(true)
		expect(livesOf(s, 'a')).toBe(3)
		expect(eventsOf(s, 'a')).toEqual([LOSS('pvp:1')])
		expect(eventsOf(s, 'b')).toEqual([LOSS('pvp:1')])
	})

	it('2v1: the lone member and a pair each lose one life per lost round', () => {
		let s = step(played(open(TWO_V_ONE), TWO_V_ONE, 9, 1), TWO_V_ONE)
		expect(pool(s)).toEqual({ A: 4, B: 3 })
		expect(eventsOf(s, 'c')).toEqual([LOSS('pvp:1')])
		s = step(aLoses(open(TWO_V_ONE), TWO_V_ONE), TWO_V_ONE)
		expect(pool(s)).toEqual({ A: 3, B: 4 })
	})

	it('with no team pool every loser pays their own life', () => {
		const solo = { pooled: false }
		const s = step(aLoses(open(TWO_V_TWO, solo)), TWO_V_TWO, solo)
		expect(s.lives.teamLives).toBeNull()
		expect([livesOf(s, 'a'), livesOf(s, 'b')]).toEqual([3, 3])
		expect([livesOf(s, 'c'), livesOf(s, 'd')]).toEqual([4, 4])
	})
})

describe('a voucher gives the named seats one life (R42)', () => {
	const voucher = (gainers: string[]): Mode => ({
		...inertMode('manhunt'),
		voucherGainers: () => gainers,
	})
	const FACT = { playerId: 'a', voucherKey: 'v_hone' }
	// no team pool: a gain only moves lives that belong to one seat
	const SOLO = { pooled: false }
	const base = (): RefereeState => open(TWO_V_TWO, SOLO)

	it.each<[string, string[], (s: RefereeState) => RefereeState, number[]]>([
		['two named seats get one life each', ['a', 'b'], (s) => s, [5, 5, 4, 4]],
		['a seat named twice gets one life', ['a', 'a'], (s) => s, [5, 4, 4, 4]],
		['nobody named, nobody gains', [], (s) => s, [4, 4, 4, 4]],
		[
			'a seat not in the run is not named a gainer',
			['zz'],
			(s) => s,
			[4, 4, 4, 4],
		],
		[
			'a seat at 0 lives gets nothing',
			['a', 'b'],
			(s) => withSeat(s, 'a', { lives: 0, eliminated: true }),
			[0, 5, 4, 4],
		],
		[
			'a seat that left gets nothing',
			['a', 'b'],
			(s) => withSeat(s, 'a', { left: true }),
			[4, 5, 4, 4],
		],
		[
			'a forfeited seat gets nothing',
			['a', 'b'],
			(s) => withSeat(s, 'a', { forfeited: true }),
			[4, 5, 4, 4],
		],
		[
			'an eliminated seat with lives left gets nothing',
			['a', 'b'],
			(s) => withSeat(s, 'a', { eliminated: true }),
			[4, 5, 4, 4],
		],
	])('%s', (_name, gainers, setup, expected) => {
		const s = gainVoucherLives(setup(base()), voucher(gainers), FACT)
		expect(['a', 'b', 'c', 'd'].map((id) => livesOf(s, id))).toEqual(expected)
	})

	it('a gain is the event {delta 1, key null}, once per named seat', () => {
		const s = gainVoucherLives(base(), voucher(['a', 'a', 'c']), FACT)
		expect(eventsOf(s, 'a')).toEqual([{ delta: 1, key: null }])
		expect(eventsOf(s, 'c')).toEqual([{ delta: 1, key: null }])
		expect(eventsOf(s, 'b')).toEqual([])
	})

	it('a mode with no voucherGainers leaves the same state object', () => {
		const s = base()
		expect(gainVoucherLives(s, inertMode('duel'), FACT)).toBe(s)
	})

	it('the mode is asked with the fact and the state', () => {
		const seen: unknown[] = []
		const rules: Mode = {
			...inertMode('manhunt'),
			voucherGainers: (state, fact) => {
				seen.push([state.rules.runId, fact])
				return []
			},
		}
		gainVoucherLives(base(), rules, FACT)
		expect(seen).toEqual([['r1', FACT]])
	})

	describe('a voucher fact in the log', () => {
		const log: PvpFact = { type: 'voucher', playerId: 'c', voucherKey: 'v_x' }
		const withFact = (s: RefereeState): RefereeState => ({
			...s,
			facts: { ...s.facts, log: [...s.facts.log, log] },
		})
		const rulesOf =
			(options: StubOptions): ModeFor =>
			() => ({
				...stubRules(TWO_V_TWO, options),
				voucherGainers: (_s, fact) => [fact.playerId],
			})

		it('is decided on once, by the tick', () => {
			const rules = rulesOf(SOLO)
			const env = envOf(TWO_V_TWO)
			const once = decide(withFact(base()), env, ctx, rules).state
			expect(livesOf(once, 'c')).toBe(5)
			const twice = decide(fromRuntime(once), env, ctx, rules).state
			expect(livesOf(twice, 'c')).toBe(5)
			expect(eventsOf(twice, 'c')).toEqual([{ delta: 1, key: null }])
		})

		it('gives nothing in a game with a team pool: no pool moves, no member moves away from it', () => {
			const rules = rulesOf({})
			const once = decide(withFact(open()), envOf(TWO_V_TWO), ctx, rules).state
			expect(pool(once)).toEqual({ A: 4, B: 4 })
			for (const id of ['a', 'b', 'c', 'd']) {
				expect(livesOf(once, id)).toBe(4)
				expect(eventsOf(once, id)).toEqual([])
			}
		})
	})

	it('gainVoucherLives names seats of a pooled game and changes nothing', () => {
		const s = gainVoucherLives(
			open(),
			{ ...voucher(['a', 'b', 'c']), lifePool: teamsMode.lifePool },
			FACT,
		)
		expect(pool(s)).toEqual({ A: 4, B: 4 })
		expect(['a', 'b', 'c', 'd'].map((id) => livesOf(s, id))).toEqual([
			4, 4, 4, 4,
		])
		expect(eventsOf(s, 'a')).toEqual([])
	})
})

// The laws, run through `fromRuntime` after every operation.
describe('team life invariants', () => {
	type Op =
		| { kind: 'blind'; who: number; blind: number }
		| { kind: 'runOut'; who: number; blind: number }
		| { kind: 'voucher'; who: number }
		| { kind: 'forfeit'; who: number }
		| { kind: 'round'; a: number; b: number }
		| { kind: 'next'; key: number }

	const KEYS = ['1:Small', '1:Big', '1:Boss', '2:Small', '2:Boss']
	const op: fc.Arbitrary<Op> = fc.oneof(
		fc.record({
			kind: fc.constant('blind' as const),
			who: fc.nat(3),
			blind: fc.nat(KEYS.length - 1),
		}),
		fc.record({
			kind: fc.constant('runOut' as const),
			who: fc.nat(3),
			blind: fc.nat(KEYS.length - 1),
		}),
		fc.record({ kind: fc.constant('voucher' as const), who: fc.nat(3) }),
		fc.record({ kind: fc.constant('forfeit' as const), who: fc.nat(3) }),
		fc.record({
			kind: fc.constant('round' as const),
			a: fc.nat(3),
			b: fc.nat(3),
		}),
		fc.record({
			kind: fc.constant('next' as const),
			key: fc.nat(KEYS.length - 1),
		}),
	)

	const rules =
		(plan: Plan): ModeFor =>
		() => ({
			...stubRules(plan),
			// the voucher op names its sender: in a pooled game the tick must still
			// move neither the pool nor one member away from it
			voucherGainers: (_s, fact) => [fact.playerId],
		})

	function apply(
		state: RefereeState,
		plan: Plan,
		o: Op,
	): RefereeState {
		const ids = [...plan[0], ...plan[1]]
		const id = ids[('who' in o ? o.who : 0) % ids.length]
		const tryPost = (type: string, args: object): RefereeState => {
			const r = FACT_REDUCERS[type](state, id, { runId: 'r1', ...args })
			return r.ok ? r.state : state
		}
		switch (o.kind) {
			case 'blind':
				return tryPost('pvp.blind', {
					blindKey: KEYS[o.blind],
					beaten: false,
					roundLost: true,
				})
			case 'runOut':
				return ledgerRunOut(state, stubRules(plan), id)
			case 'voucher':
				return {
					...state,
					facts: {
						...state.facts,
						log: [
							...state.facts.log,
							{ type: 'voucher', playerId: id, voucherKey: 'v_x' },
						],
					},
				}
			case 'forfeit':
				return tryPost('pvp.forfeit', {})
			case 'round':
				return state.round.phase === 'playing'
					? played(state, plan, o.a, o.b)
					: state
			case 'next': {
				const start = state.lastStart
				if (start === null) return state
				return {
					...state,
					lastStart: {
						...start,
						roundId: start.roundId + 1,
						blindKeys: bossKeys(plan, KEYS[o.key]),
					},
				}
			}
		}
	}

	it.each<[string, Plan]>([
		['2v2', TWO_V_TWO],
		['2v1', TWO_V_ONE],
	])('%s: pools, seats and events stay consistent', (_name, plan) => {
		const teams = teamsOf(plan)
		const ids = Object.keys(teams)
		fc.assert(
			fc.property(fc.array(op, { maxLength: 24 }), (ops) => {
				let s = open(plan)
				const start = open(plan).lives.players.a.lives
				for (const o of ops) {
					s = fromRuntime(
						decide(
							fromRuntime(apply(s, plan, o)),
							envOf(plan),
							ctx,
							rules(plan),
						).state,
					)
					const teamPool = s.lives.teamLives
					expect(teamPool).not.toBeNull()
					if (teamPool === null) return
					for (const id of ids) {
						const seat = s.lives.players[id]
						const team = teams[id] === 'A' ? 'A' : 'B'
						// member lives = pool
						expect(seat.lives).toBe(teamPool[team])
						// nothing below 0
						expect(seat.lives).toBeGreaterThanOrEqual(0)
						// event deltas account for every life gained or lost
						expect(seat.events.reduce((sum, e) => sum + e.delta, 0)).toBe(
							seat.lives - start,
						)
					}
					// teammates show the same events
					for (const team of ['A', 'B'] as const) {
						const mates = ids.filter((id) => teams[id] === team)
						for (const id of mates)
							expect(s.lives.players[id].events).toEqual(
								s.lives.players[mates[0]].events,
							)
					}
					// a re-tick changes nothing
					const again = decide(fromRuntime(s), envOf(plan), ctx, rules(plan))
					expect(again.state).toEqual(s)
				}
			}),
			{
				numRuns: 150,
				// everyone forfeits, then a round is started anyway
				examples: [
					[
						[
							{ kind: 'forfeit', who: 1 },
							{ kind: 'forfeit', who: 0 },
							{ kind: 'forfeit', who: 2 },
							{ kind: 'next', key: 0 },
						],
					],
				],
			},
		)
	}, 20_000)

	it('a state is the same whether or not the runtime wraps it', () => {
		fc.assert(
			fc.property(fc.array(op, { maxLength: 16 }), (ops) => {
				const plan = TWO_V_TWO
				let plain = open(plan)
				let wrapped = open(plan)
				for (const o of ops) {
					plain = decide(
						apply(plain, plan, o),
						envOf(plan),
						ctx,
						rules(plan),
					).state
					wrapped = decide(
						fromRuntime(apply(wrapped, plan, o)),
						envOf(plan),
						ctx,
						rules(plan),
					).state
					expect(wrapped).toEqual(plain)
				}
			}),
			{ numRuns: 80 },
		)
	})
})
