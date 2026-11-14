// The Teams rules (R46-R54), through the tick: `decide` with `teamsMode`, every
// state read through `fromRuntime` so nothing relies on object identity. Rows
// that need no tick call a hook directly.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import type { StepContext } from '../../../actions/registry'
import { testContext } from '../../../testing/request_context'
import { startOf, reportAll } from '../../../testing/pvp_fixtures'
import { fromRuntime } from '../../../testing/runtime_state'
import { FACT_REDUCERS } from '../facts'
import { runOut as ledgerRunOut } from '../lives'
import {
	type PvpLifeEvent,
	type PvpTeam,
	type RefereeState,
	emptyFacts,
	emptyPvp,
} from '../state'
import { type ModeFor, type TickEnv, decide } from '../tick'
import { aliveIds } from './common'
import { withRules } from '../../../testing/pvp_rules'
import {
	assignTeams,
	drawCardTargets,
	repairCardTargets,
	teamsMode,
} from './teams'

const TEAMS: ModeFor = () => teamsMode

type Plan = [string[], string[]]
const TWO_V_TWO: Plan = [
	['a', 'b'],
	['c', 'd'],
]
const TWO_V_ONE: Plan = [['a', 'b'], ['c']]
const THREE_V_THREE: Plan = [
	['a', 'b', 'c'],
	['d', 'e', 'f'],
]

interface Setup {
	ids: string[]
	picks?: { [id: string]: PvpTeam }
	plan?: string[][] | null
	lives?: number
}

const planned = (plan: Plan): Setup => ({ ids: [...plan[0], ...plan[1]], plan })

const envOf = (setup: Setup, gone: string[] = []): TickEnv => ({
	runId: 'r1',
	startedIds: setup.ids,
	seatedIds: setup.ids.filter((id) => !gone.includes(id)),
	readyIds: [],
	readiedIds: [],
	raceStarted: true,
	ranked: false,
	requiredIds: setup.ids.filter((id) => !gone.includes(id)),
	awayIds: [],
	metadata: withRules({
		ruleset: 'ruleset_mp_traditional',
		queue_mode: 'pvp_teams',
		...(setup.lives === undefined ? {} : { starting_lives: setup.lives }),
	}),
	picks: setup.picks ?? {},
	teamPlan: setup.plan ?? null,
})

const idle = (setup: Setup, roundId = 1): RefereeState => ({
	...emptyPvp(),
	facts: emptyFacts(),
	runId: 'r1',
	lastStart:
		roundId === 0 ? null : startOf(setup.ids, roundId, setup.ids[0]),
})

// The first tick: the mode settles the run and the first round opens.
const begin = (
	setup: Setup,
	ctx: StepContext = testContext(1000),
): RefereeState =>
	reportAll(decide(idle(setup), envOf(setup), ctx, TEAMS).state)

// The first tick with no round started: only the run is settled.
const settle = (setup: Setup): RefereeState =>
	decide(idle(setup, 0), envOf(setup), testContext(1000), TEAMS).state

const step = (
	state: RefereeState,
	setup: Setup,
	options: { gone?: string[]; ctx?: StepContext } = {},
): RefereeState =>
	reportAll(
		fromRuntime(
			decide(
				fromRuntime(state),
				envOf(setup, options.gone),
				options.ctx ?? testContext(1000),
				TEAMS,
			).state,
		),
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
const forfeit = (state: RefereeState, id: string) =>
	post(state, 'pvp.forfeit', id)

// Each seat's round score and hands.
// Every player has reported no score (null).
function unreported(state: RefereeState): RefereeState {
	const players = { ...state.round.players }
	for (const id of Object.keys(players))
		players[id] = { ...players[id], score: null, handsLeft: 0 }
	return { ...state, round: { ...state.round, players } }
}

function scored(
	state: RefereeState,
	scores: { [id: string]: string },
	handsLeft = 0,
): RefereeState {
	const players = { ...state.round.players }
	for (const id of Object.keys(players))
		players[id] = {
			...players[id],
			score: scores[id] ?? players[id].score,
			handsLeft,
		}
	return { ...state, round: { ...state.round, players } }
}

const withScore = (
	state: RefereeState,
	id: string,
	score: string,
): RefereeState => ({
	...state,
	round: {
		...state.round,
		players: {
			...state.round.players,
			[id]: { ...state.round.players[id], score },
		},
	},
})

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

function withPool(
	state: RefereeState,
	pool: { A: number; B: number },
): RefereeState {
	let next: RefereeState = {
		...state,
		lives: { ...state.lives, teamLives: pool },
	}
	const teams = state.teams.teams
	for (const id of Object.keys(teams)) {
		const lives = pool[teams[id] === 'A' ? 'A' : 'B']
		next = withSeat(next, id, { lives, eliminated: lives <= 0 })
	}
	return next
}

const withAnte = (state: RefereeState, ante: number): RefereeState => {
	const players = { ...state.round.players }
	for (const id of Object.keys(players)) players[id] = { ...players[id], ante }
	return { ...state, round: { ...state.round, players } }
}

const pool = (s: RefereeState) => s.lives.teamLives
const livesOf = (s: RefereeState, id: string): number =>
	s.lives.players[id].lives
const eventsOf = (s: RefereeState, id: string): PvpLifeEvent[] =>
	s.lives.players[id].events
const LOSS = (key: string): PvpLifeEvent => ({ delta: -1, key })
const viewOf = (s: RefereeState) => teamsMode.view?.(s)

describe('R46 the teams at the start', () => {
	it.each<[string, Setup, { [id: string]: PvpTeam }]>([
		[
			'the plan overrides the picks',
			{
				ids: ['a', 'b', 'c', 'd'],
				picks: { a: 'B', b: 'B', c: 'A', d: 'A' },
				plan: [
					['a', 'b'],
					['c', 'd'],
				],
			},
			{ a: 'A', b: 'A', c: 'B', d: 'B' },
		],
		[
			'a pick is kept, so everyone may be on one team',
			{ ids: ['a', 'b', 'c'], picks: { a: 'A', b: 'A', c: 'B' } },
			{ a: 'A', b: 'A', c: 'B' },
		],
		[
			'an unpicked player goes to the smaller team, a tie to A',
			{ ids: ['a', 'b', 'c', 'd'], picks: { a: 'A' } },
			{ a: 'A', b: 'B', c: 'A', d: 'B' },
		],
		[
			'unpicked players count the picks made by players later in the order',
			{ ids: ['a', 'b', 'c', 'd'], picks: { d: 'A' } },
			{ a: 'B', b: 'A', c: 'B', d: 'A' },
		],
		[
			'a plan id that did not start is ignored',
			{
				ids: ['a', 'b', 'c'],
				plan: [
					['a', 'ghost'],
					['b', 'c'],
				],
			},
			{ a: 'A', b: 'B', c: 'B' },
		],
		[
			'a Manhunt role is not a team pick',
			{ ids: ['a', 'b'], picks: { a: 'RUNNER', b: 'HUNTER' } },
			{ a: 'A', b: 'B' },
		],
		[
			'a plan fills part of the roster and the rest balance',
			{
				ids: ['a', 'b', 'c', 'd'],
				plan: [['a', 'b', 'c'], []],
			},
			{ a: 'A', b: 'A', c: 'A', d: 'B' },
		],
	])('%s', (_name, setup, expected) => {
		expect(settle(setup).teams.teams).toEqual(expected)
	})

	it('the teams are stamped with the run id', () => {
		expect(settle(planned(TWO_V_TWO)).teams.runId).toBe('r1')
	})

	it('an unpicked 5-player start splits 3 against 2', () => {
		const teams = settle({ ids: ['a', 'b', 'c', 'd', 'e'] }).teams.teams
		expect(Object.values(teams).filter((t) => t === 'A')).toHaveLength(3)
		expect(Object.values(teams).filter((t) => t === 'B')).toHaveLength(2)
	})
})

describe('R47 the pools', () => {
	it('both pools are the starting lives and every member mirrors its pool', () => {
		const s = settle({ ...planned(TWO_V_ONE), lives: 3 })
		expect(pool(s)).toEqual({ A: 3, B: 3 })
		for (const id of ['a', 'b', 'c']) {
			expect(livesOf(s, id)).toBe(3)
			expect(eventsOf(s, id)).toEqual([])
		}
	})

	it('the default is 4 lives', () => {
		expect(pool(settle(planned(TWO_V_TWO)))).toEqual({ A: 4, B: 4 })
	})

	it('a second tick does not settle the run again', () => {
		const setup = planned(TWO_V_TWO)
		let s = settle(setup)
		s = scored(withPool(s, { A: 2, B: 4 }), {})
		const again = step(s, setup)
		expect(pool(again)).toEqual({ A: 2, B: 4 })
		expect(again.teams.teams).toEqual({ a: 'A', b: 'A', c: 'B', d: 'B' })
		expect(again.teams.teams).toEqual(s.teams.teams)
	})
})

describe('R48 a round is decided by team score', () => {
	const setup = planned(TWO_V_TWO)

	it('equal sums cost nothing', () => {
		const s = step(
			scored(begin(setup), { a: '3', b: '2', c: '5', d: '0' }),
			setup,
		)
		expect(s.round.phase).toBe('resolved')
		expect(s.round.lastResult).toEqual({ roundId: 1, losers: [] })
		expect(pool(s)).toEqual({ A: 4, B: 4 })
		for (const id of setup.ids) expect(eventsOf(s, id)).toEqual([])
	})

	it('the lower sum loses exactly 1 from its pool and both members show it once', () => {
		const s = step(
			scored(begin(setup), { a: '1', b: '1', c: '9', d: '0' }),
			setup,
		)
		expect(pool(s)).toEqual({ A: 3, B: 4 })
		expect(s.round.lastResult).toEqual({ roundId: 1, losers: ['a', 'b'] })
		for (const id of ['a', 'b']) {
			expect(livesOf(s, id)).toBe(3)
			expect(eventsOf(s, id)).toEqual([LOSS('pvp:1')])
		}
		for (const id of ['c', 'd']) {
			expect(livesOf(s, id)).toBe(4)
			expect(eventsOf(s, id)).toEqual([])
		}
	})

	it('a score is compared as a Talisman number, not as text', () => {
		const s = step(
			scored(begin(setup), { a: '9', b: '9', c: '10', d: '0' }),
			setup,
		)
		expect(pool(s)).toEqual({ A: 4, B: 3 })
	})

	it('2v1 works: a 2-member sum against 1 score', () => {
		const two = planned(TWO_V_ONE)
		const s = step(scored(begin(two), { a: '3', b: '3', c: '5' }), two)
		expect(pool(s)).toEqual({ A: 4, B: 3 })
		expect(eventsOf(s, 'c')).toEqual([LOSS('pvp:1')])
		expect(eventsOf(s, 'a')).toEqual([])
		const lone = step(scored(begin(two), { a: '2', b: '2', c: '5' }), two)
		expect(pool(lone)).toEqual({ A: 3, B: 4 })
	})

	it('a forfeited member is left out of the sums and of the wait for hands', () => {
		let s = forfeit(begin(setup), 'a')
		// b scores 4 and is out of hands; c and d total 5; a has hands left
		s = withHands(scored(s, { a: '99', b: '4', c: '3', d: '2' }), 'a', 2)
		s = step(s, setup)
		expect(s.round.lastResult).toEqual({ roundId: 1, losers: ['b'] })
		expect(pool(s)).toEqual({ A: 3, B: 4 })
	})

	it('a member who left is left out of the sums and of the wait for hands', () => {
		let s = withHands(
			scored(begin(setup), { a: '99', b: '4', c: '3', d: '2' }),
			'a',
			2,
		)
		s = step(s, setup, { gone: ['a'] })
		expect(s.round.lastResult).toEqual({ roundId: 1, losers: ['b'] })
		expect(pool(s)).toEqual({ A: 3, B: 4 })
	})

	it('nothing resolves while one alive player has hands', () => {
		let s = scored(begin(setup), { a: '1', b: '1', c: '9', d: '9' })
		s = withHands(s, 'd', 1)
		s = step(s, setup)
		expect(s.round.phase).toBe('playing')
		expect(s.round.lastResult).toBeNull()
		expect(pool(s)).toEqual({ A: 4, B: 4 })
	})

	it('a resolved round resolves once', () => {
		const lost = step(
			scored(begin(setup), { a: '1', b: '1', c: '9', d: '0' }),
			setup,
		)
		const again = step(lost, setup)
		expect(pool(again)).toEqual({ A: 3, B: 4 })
		expect(again.lives).toEqual(lost.lives)
	})
})

function withHands(
	state: RefereeState,
	id: string,
	handsLeft: number,
): RefereeState {
	return {
		...state,
		round: {
			...state.round,
			players: {
				...state.round.players,
				[id]: { ...state.round.players[id], handsLeft },
			},
		},
	}
}

describe("R49 a team's guard is spent by a non-PvP failure and re-armed by a member's progress; a run-out always costs", () => {
	const setup = planned(TWO_V_TWO)
	it.each<
		[string, (s: RefereeState) => RefereeState, { A: number; B: number }]
	>([
		[
			'two members failing the same blind cost 1',
			(s) => failBlind(failBlind(s, 'a', '1:Small'), 'b', '1:Small'),
			{ A: 3, B: 4 },
		],
		[
			'one member failing the same blind twice costs 1',
			(s) => failBlind(failBlind(s, 'a', '1:Small'), 'a', '1:Small'),
			{ A: 3, B: 4 },
		],
		[
			'two members running out of ante time cost 2',
			(s) => runOut(runOut(s, 'a'), 'b'),
			{ A: 2, B: 4 },
		],
		[
			'a member failing a second blind before anyone moves on costs 1',
			(s) => failBlind(failBlind(s, 'a', '1:Small'), 'a', '1:Big'),
			{ A: 3, B: 4 },
		],
		[
			'a teammate failing another blind before anyone moves on costs 1',
			(s) => failBlind(failBlind(s, 'a', '1:Big'), 'b', '1:Small'),
			{ A: 3, B: 4 },
		],
		[
			'a failure, a teammate selecting the blind (pvp.progress), then that teammate failing it costs 2',
			(s) =>
				failBlind(
					post(failBlind(s, 'a', '1:Big'), 'pvp.progress', 'b', {
						ante: 1,
						furthestBlind: 12,
					}),
					'b',
					'1:Big',
				),
			{ A: 2, B: 4 },
		],
		[
			'both teams failing the same blind cost 1 each',
			(s) => failBlind(failBlind(s, 'a', '1:Small'), 'c', '1:Small'),
			{ A: 3, B: 3 },
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
		const s = step(act(begin(setup)), setup)
		expect(pool(s)).toEqual(expected)
		for (const id of setup.ids)
			expect(livesOf(s, id)).toBe(pool(s)?.[id < 'c' ? 'A' : 'B'])
	})
})

describe('R49 a pool with one life left and two failing teammates', () => {
	const setup = planned(TWO_V_TWO)

	it('goes to 0, not below, with one loss on every seat', () => {
		const lastLife = withPool(begin(setup), { A: 1, B: 4 })
		const s = step(
			failBlind(failBlind(lastLife, 'a', '1:Boss'), 'b', '1:Boss'),
			setup,
		)
		expect(pool(s)).toEqual({ A: 0, B: 4 })
		for (const id of ['a', 'b'])
			expect(eventsOf(s, id)).toEqual([LOSS('1:Boss')])
	})
})

describe('R50 a pool at 0 after a PvP round', () => {
	const setup = planned(TWO_V_TWO)

	it('the other team wins, with winnerTeam and both winners at place 1', () => {
		const lastLife = withPool(begin(setup), { A: 1, B: 4 })
		const s = step(scored(lastLife, { a: '1', b: '1', c: '9', d: '0' }), setup)
		expect(pool(s)).toEqual({ A: 0, B: 4 })
		expect(s.result).toEqual({
			runId: 'r1',
			kind: 'win',
			winnerId: null,
			winnerTeam: 'B',
			places: [
				{ playerId: 'a', place: 2 },
				{ playerId: 'b', place: 2 },
				{ playerId: 'c', place: 1 },
				{ playerId: 'd', place: 1 },
			],
		})
	})

	it('the pool of B emptied: A wins', () => {
		const lastLife = withPool(begin(setup), { A: 4, B: 1 })
		const s = step(scored(lastLife, { a: '9', b: '9', c: '1', d: '0' }), setup)
		expect(s.result).toMatchObject({ kind: 'win', winnerTeam: 'A' })
	})

	it('the result is not overwritten by a later tick', () => {
		const lastLife = withPool(begin(setup), { A: 1, B: 4 })
		const won = step(
			scored(lastLife, { a: '1', b: '1', c: '9', d: '0' }),
			setup,
		)
		expect(won.result).toMatchObject({ kind: 'win', winnerTeam: 'B' })
		expect(step(won, setup).result).toEqual(won.result)
	})
})

describe('R52 a team with nobody left loses', () => {
	const setup = planned(TWO_V_TWO)

	it('every member of a team forfeits: the other team wins', () => {
		const s = step(forfeit(forfeit(begin(setup), 'a'), 'b'), setup)
		expect(s.result).toMatchObject({
			kind: 'win',
			winnerId: null,
			winnerTeam: 'B',
		})
		expect(s.result.places.filter((p) => p.place === 1)).toEqual([
			{ playerId: 'c', place: 1 },
			{ playerId: 'd', place: 1 },
		])
	})

	it('a member who left counts as gone', () => {
		const s = step(begin(setup), setup, { gone: ['c', 'd'] })
		expect(s.result).toMatchObject({ kind: 'win', winnerTeam: 'A' })
	})

	it('one member forfeits: the game goes on and the pool is unchanged', () => {
		const s = step(forfeit(begin(setup), 'a'), setup)
		expect(s.result.kind).toBeNull()
		expect(pool(s)).toEqual({ A: 4, B: 4 })
		expect(livesOf(s, 'a')).toBe(4)
	})

	it('a start with team B empty: A wins at once', () => {
		const s = begin({ ids: ['a', 'b'], picks: { a: 'A', b: 'A' } })
		expect(s.result).toMatchObject({ kind: 'win', winnerTeam: 'A' })
		expect(s.result.places).toEqual([
			{ playerId: 'a', place: 1 },
			{ playerId: 'b', place: 1 },
		])
	})

	it('both teams gone at once is a draw', () => {
		const s = step(
			forfeit(forfeit(forfeit(forfeit(begin(setup), 'a'), 'b'), 'c'), 'd'),
			setup,
		)
		expect(s.result).toMatchObject({
			kind: 'draw',
			winnerId: null,
			winnerTeam: null,
		})
		expect(s.result.places.every((p) => p.place === 1)).toBe(true)
	})
})

describe('R53 a pool at 0 on a normal blind', () => {
	const setup = planned(TWO_V_TWO)

	it('opens a pending death and writes no result', () => {
		const lastLife = withPool(begin(setup), { A: 1, B: 4 })
		const s = step(failBlind(lastLife, 'a', '1:Small'), setup)
		expect(pool(s)).toEqual({ A: 0, B: 4 })
		expect(s.result.kind).toBeNull()
		expect(s.lives.pending).toEqual([
			{ playerId: 'a', blindKey: '1:Small', waitsOn: ['c', 'd'] },
		])
	})

	it('a lost PvP round that empties the pool opens none', () => {
		const lastLife = withPool(begin(setup), { A: 1, B: 4 })
		const s = step(scored(lastLife, { a: '1', b: '1', c: '9', d: '9' }), setup)
		expect(pool(s)).toEqual({ A: 0, B: 4 })
		expect(s.result).toMatchObject({ kind: 'win', winnerTeam: 'B' })
		expect(s.lives.pending).toEqual([])
	})
})

describe('R51 card targets', () => {
	const setup = planned(THREE_V_THREE)
	const teamOf = (s: RefereeState, id: string) => s.teams.teams[id]

	it('are drawn at the start: only alive members of the other team', () => {
		const s = begin(setup)
		expect(s.cardTargets?.ante).toBe(1)
		const targets = s.cardTargets?.targets ?? {}
		expect(Object.keys(targets).sort()).toEqual(setup.ids)
		for (const id of setup.ids) {
			const target = targets[id]
			expect(target).not.toBeNull()
			if (target === null) continue
			expect(teamOf(s, target)).not.toBe(teamOf(s, id))
		}
	})

	it('are the same under the same seeded random', () => {
		const first = begin(setup, testContext(1000, 7)).cardTargets
		const second = begin(setup, testContext(1000, 7)).cardTargets
		expect(first).not.toBeNull()
		expect(second).toEqual(first)
	})

	it('are drawn from the random alone: another seed can pick other members', () => {
		const seen = new Set<string>()
		for (let seed = 1; seed <= 30; seed++)
			seen.add(
				JSON.stringify(begin(setup, testContext(1000, seed)).cardTargets),
			)
		expect(seen.size).toBeGreaterThan(1)
	})

	it('are redrawn on a new ante, between rounds', () => {
		const lost = step(
			scored(begin(setup), { a: '5', b: '5', c: '5', d: '1', e: '1', f: '1' }),
			setup,
		)
		expect(lost.round.phase).toBe('resolved')
		expect(lost.cardTargets?.ante).toBe(1)
		const next = step(withAnte(lost, 2), setup, { ctx: testContext(1000, 9) })
		expect(next.cardTargets?.ante).toBe(2)
		expect(next.cardTargets).toEqual(
			drawCardTargets(lost, 2, testContext(1000, 9).random),
		)
	})

	it('are not drawn while no player has reported an ante', () => {
		const s = begin(setup, testContext(1000, 3))
		const players = { ...s.round.players }
		for (const id of Object.keys(players))
			players[id] = { ...players[id], ante: null }
		const unreported: RefereeState = {
			...s,
			cardTargets: null,
			round: { ...s.round, players },
		}
		expect(teamsMode.onAnte?.(unreported, testContext(1000, 4))).toBe(unreported)
	})

	it('are not redrawn on the same ante', () => {
		const s = begin(setup, testContext(1000, 3))
		expect(teamsMode.onAnte?.(s, testContext(1000, 4))).toBe(s)
		const lost = step(
			scored(s, { a: '5', b: '5', c: '5', d: '1', e: '1', f: '1' }),
			setup,
		)
		const again = step(lost, setup, { ctx: testContext(1000, 5) })
		expect(again.cardTargets).toEqual(s.cardTargets)
	})

	it('are only drawn from members still alive', () => {
		let s = begin(setup)
		s = withSeat(s, 'd', { forfeited: true })
		s = withSeat(s, 'e', { eliminated: true, lives: 0 })
		const drawn = drawCardTargets(s, 2, testContext(1000, 2).random).targets
		expect(Object.keys(drawn).sort()).toEqual(['a', 'b', 'c', 'f'])
		for (const id of ['a', 'b', 'c']) expect(drawn[id]).toBe('f')
		for (const id of ['f']) expect(['a', 'b', 'c']).toContain(drawn[id])
	})

	it('are null when the other team has nobody alive', () => {
		let s = begin(setup)
		for (const id of ['d', 'e', 'f']) s = withSeat(s, id, { left: true })
		const drawn = drawCardTargets(s, 2, testContext(1000).random).targets
		expect(drawn).toEqual({ a: null, b: null, c: null })
	})

	it('a player who is not alive has no entry', () => {
		const quit = forfeit(begin(setup), 'a')
		const resolved = step(
			scored(quit, { b: '5', c: '5', d: '1', e: '1', f: '1' }),
			setup,
		)
		expect(resolved.round.phase).toBe('resolved')
		const drawn = step(withAnte(resolved, 2), setup)
		const keys = Object.keys(drawn.cardTargets?.targets ?? {})
		expect(drawn.cardTargets?.ante).toBe(2)
		expect(keys.sort()).toEqual(['b', 'c', 'd', 'e', 'f'])
	})

	// A forfeit or a left seat repairs the stored targets of the ante in place.
	const seeded = () => testContext(1000, 5)
	const targetsOf = (s: RefereeState) => s.cardTargets?.targets ?? {}
	const aliveOther = (s: RefereeState, id: string, ids: string[]) =>
		ids.filter((x) => teamOf(s, x) !== teamOf(s, id))

	it.each<[string, (s: RefereeState, victim: string) => RefereeState]>([
		['forfeits', (s, victim) => step(forfeit(s, victim), setup)],
		['leaves', (s, victim) => step(s, setup, { gone: [victim] })],
	])(
		'a target who %s mid-ante is replaced; the other entries stay',
		(_n, out) => {
			const start = begin(setup, seeded())
			const victim = targetsOf(start).a
			if (victim === null || victim === undefined) throw new Error('no target')
			const after = out(start, victim)
			const alive = setup.ids.filter((id) => id !== victim)
			expect(after.cardTargets?.ante).toBe(1)
			expect(Object.keys(targetsOf(after)).sort()).toEqual(alive)
			for (const id of alive) {
				const was = targetsOf(start)[id]
				const now = targetsOf(after)[id]
				if (was === victim) expect(aliveOther(after, id, alive)).toContain(now)
				else expect(now).toBe(was)
			}
			expect(targetsOf(after).a).not.toBe(victim)
		},
	)

	it('a forfeiter keeps no entry of their own', () => {
		const start = begin(setup, seeded())
		const after = step(forfeit(start, 'a'), setup)
		expect(Object.keys(targetsOf(after))).not.toContain('a')
		expect(after.cardTargets?.ante).toBe(1)
	})

	it('the last alive member of a team leaving gives the others null', () => {
		const two = planned(TWO_V_ONE)
		const after = step(begin(two, seeded()), two, { gone: ['c'] })
		expect(targetsOf(after)).toEqual({ a: null, b: null })
	})

	it('a forfeit that touches no entry changes nothing in the stored targets', () => {
		const start = begin(setup, seeded())
		const repaired = step(forfeit(start, 'a'), setup)
		expect(teamsMode.onForfeit?.(repaired, seeded())).toBe(repaired)
		expect(repairCardTargets(repaired, seeded().random)).toBeNull()
		const none: RefereeState = { ...start, cardTargets: null }
		expect(teamsMode.onForfeit?.(none, seeded())).toBe(none)
	})

	it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])(
		"a player already missing at the first tick is nobody's target (seed %i)",
		(seed) => {
			const after = decide(
				idle(setup),
				envOf(setup, ['f']),
				testContext(1000, seed),
				TEAMS,
			).state
			expect(Object.keys(targetsOf(after))).not.toContain('f')
			for (const target of Object.values(targetsOf(after)))
				expect(target).not.toBe('f')
			expect(Object.keys(targetsOf(after)).sort()).toEqual([
				'a',
				'b',
				'c',
				'd',
				'e',
			])
		},
	)

	it('the walk order is the sorted ids: the same random gives the same targets', () => {
		const s = begin(setup)
		const reversed: RefereeState = {
			...s,
			lives: {
				...s.lives,
				players: Object.fromEntries(Object.entries(s.lives.players).reverse()),
			},
		}
		const drawn = drawCardTargets(s, 2, testContext(1000, 11).random)
		expect(Object.keys(drawn.targets)).toHaveLength(6)
		expect(drawCardTargets(reversed, 2, testContext(1000, 11).random)).toEqual(
			drawn,
		)
	})
})

describe('R54 the live view', () => {
	const setup = planned(TWO_V_TWO)

	it('shows both team sums and the stored card targets', () => {
		const s = scored(begin(setup), { a: '3', b: '4', c: '5', d: '0' }, 2)
		expect(viewOf(s)).toEqual({
			opponents: {},
			cardTargets: s.cardTargets?.targets,
			teamScores: { A: '7', B: '5' },
		})
	})

	it('a team with no score yet shows null, not zero', () => {
		expect(viewOf(unreported(begin(setup)))?.teamScores).toEqual({
			A: null,
			B: null,
		})
	})

	it('a member who is out is left out of the sum, as in the round', () => {
		let s = scored(begin(setup), { a: '3', b: '4', c: '5', d: '1' }, 2)
		s = withSeat(s, 'b', { forfeited: true })
		expect(viewOf(s)?.teamScores).toEqual({ A: '3', B: '6' })
	})

	it('a team with no reports loses to a team with a real 0, never ties it', () => {
		const s = scored(unreported(begin(setup)), { c: '0', d: '0' })
		expect(viewOf(s)?.teamScores).toEqual({ A: null, B: '0' })
		const resolved = teamsMode.resolveRound(s, testContext(1000))
		expect(resolved.round.lastResult?.losers).toEqual(['a', 'b'])
	})

	it('the view sums as resolveRound does', () => {
		const s = scored(begin(setup), { a: '1', b: '1', c: '9', d: '0' })
		const resolved = teamsMode.resolveRound(s, testContext(1000))
		const sums = viewOf(s)?.teamScores
		expect(sums).toEqual({ A: '2', B: '9' })
		expect(resolved.round.lastResult?.losers).toEqual(['a', 'b'])
	})
})

describe('the start of the round', () => {
	it('round.roundId = lastStart.roundId after every start', () => {
		const setup = planned(TWO_V_TWO)
		const start = (roundId: number) => startOf(setup.ids, roundId, 'a')
		let state = decide(
			{ ...idle(setup), lastStart: start(1) },
			envOf(setup),
			testContext(1000),
			TEAMS,
		).state
		expect(state.round.roundId).toBe(1)
		state = decide(
			scored(state, { a: '1', b: '2', c: '2', d: '2' }),
			envOf(setup),
			testContext(1000),
			TEAMS,
		).state
		expect(state.round.roundId).toBe(1)
		for (const n of [2, 3]) {
			state = decide(
				{ ...state, lastStart: start(n) },
				envOf(setup),
				testContext(1000),
				TEAMS,
			).state
			if (state.result.kind !== null) break
			expect(state.round.roundId).toBe(n)
		}
	})

	it('a round opens at score 0 with the hands of the start', () => {
		const setup = planned(TWO_V_TWO)
		const s = begin(setup)
		expect(s.round.phase).toBe('playing')
		for (const id of setup.ids)
			expect(s.round.players[id]).toMatchObject({ score: '0', handsLeft: 4 })
	})
})

// The laws.
describe('properties', () => {
	const SIDES: PvpTeam[] = ['A', 'B']
	const PICKS = fc.constantFrom<PvpTeam | undefined>(
		undefined,
		'A',
		'B',
		'RUNNER',
		'HUNTER',
	)

	const rosterArb = fc
		.record({
			n: fc.integer({ min: 1, max: 6 }),
			picks: fc.array(PICKS, { minLength: 6, maxLength: 6 }),
			plan: fc.option(fc.tuple(fc.subarray(IDS()), fc.subarray(IDS())), {
				nil: null,
			}),
		})
		.map(({ n, picks, plan }): Setup => {
			const ids = IDS().slice(0, n)
			const chosen: { [id: string]: PvpTeam } = {}
			ids.forEach((id, i) => {
				const pick = picks[i]
				if (pick !== undefined) chosen[id] = pick
			})
			return { ids, picks: chosen, plan }
		})

	function IDS(): string[] {
		return ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'ghost']
	}

	it('every started player is on exactly one of A or B', () => {
		fc.assert(
			fc.property(rosterArb, (setup) => {
				const teams = assignTeams({
					startedIds: setup.ids,
					picks: setup.picks ?? {},
					teamPlan: setup.plan ?? null,
				})
				expect(Object.keys(teams).sort()).toEqual([...setup.ids].sort())
				for (const id of setup.ids) expect(SIDES).toContain(teams[id])
				// the tick settles the same roster
				expect(settle(setup).teams.teams).toEqual(teams)
				// the order the picks were made in never matters
				const mirrored = { ...setup, picks: reverseKeys(setup.picks ?? {}) }
				expect(settle(mirrored).teams.teams).toEqual(teams)
			}),
			{ numRuns: 150 },
		)
	})

	it('a plan wins over a pick, and a pick over the balance', () => {
		fc.assert(
			fc.property(rosterArb, (setup) => {
				const teams = assignTeams({
					startedIds: setup.ids,
					picks: setup.picks ?? {},
					teamPlan: setup.plan ?? null,
				})
				const plan = setup.plan ?? [[], []]
				for (const id of setup.ids) {
					if (plan[1].includes(id)) expect(teams[id]).toBe('B')
					else if (plan[0].includes(id)) expect(teams[id]).toBe('A')
					else if (setup.picks?.[id] === 'A' || setup.picks?.[id] === 'B')
						expect(teams[id]).toBe(setup.picks[id])
				}
			}),
			{ numRuns: 150 },
		)
	})

	type Op =
		| { kind: 'blind'; who: number; blind: number }
		| { kind: 'runOut'; who: number; blind: number }
		| { kind: 'forfeit'; who: number }
		| { kind: 'hands'; a: number; b: number }
		| { kind: 'hand'; who: number; score: number }
		| { kind: 'ready'; key: number }
		| { kind: 'ante' }

	const KEYS = ['1:Small', '1:Big', '1:Boss', '2:Small', '2:Boss']
	const op: fc.Arbitrary<Op> = fc.oneof(
		fc.record({
			kind: fc.constant('blind' as const),
			who: fc.nat(5),
			blind: fc.nat(KEYS.length - 1),
		}),
		fc.record({
			kind: fc.constant('runOut' as const),
			who: fc.nat(5),
			blind: fc.nat(KEYS.length - 1),
		}),
		fc.record({ kind: fc.constant('forfeit' as const), who: fc.nat(5) }),
		fc.record({
			kind: fc.constant('hands' as const),
			a: fc.nat(9),
			b: fc.nat(9),
		}),
		fc.record({
			kind: fc.constant('hand' as const),
			who: fc.nat(5),
			score: fc.nat(9),
		}),
		fc.record({
			kind: fc.constant('ready' as const),
			key: fc.nat(KEYS.length - 1),
		}),
		fc.record({ kind: fc.constant('ante' as const) }),
	)

	function apply(
		state: RefereeState,
		setup: Setup,
		o: Op,
	): RefereeState {
		const id = setup.ids[('who' in o ? o.who : 0) % setup.ids.length]
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
				return ledgerRunOut(state, teamsMode, id)
			case 'forfeit':
				return tryPost('pvp.forfeit', {})
			case 'hands': {
				if (state.round.phase !== 'playing') return state
				const scores: { [id: string]: string } = {}
				for (const m of setup.ids)
					scores[m] = String(state.teams.teams[m] === 'A' ? o.a : o.b)
				return scored(state, scores)
			}
			case 'hand': {
				if (state.round.phase !== 'playing') return state
				// only this player's score and hands: the others may still have hands
				return withHands(withScore(state, id, String(o.score)), id, 0)
			}
			case 'ready': {
				const start = state.lastStart
				if (start === null) return state
				const keys: { [id: string]: string } = {}
				for (const m of setup.ids) keys[m] = KEYS[o.key]
				return {
					...state,
					lastStart: {
						...start,
						roundId: start.roundId + 1,
						blindKeys: keys,
					},
				}
			}
			case 'ante':
				return withAnte(state, (state.round.players[id]?.ante ?? 1) + 1)
		}
	}

	const setupArb: fc.Arbitrary<Setup> = fc
		.record({
			plan: fc.constantFrom<Plan>(TWO_V_TWO, TWO_V_ONE, THREE_V_THREE),
			viaPicks: fc.boolean(),
		})
		.map(({ plan, viaPicks }): Setup => {
			if (!viaPicks) return planned(plan)
			const picks: { [id: string]: PvpTeam } = {}
			for (const id of plan[0]) picks[id] = 'A'
			for (const id of plan[1]) picks[id] = 'B'
			return { ids: [...plan[0], ...plan[1]], picks }
		})

	it('lives mirror the pools, nothing goes below 0, targets are never a mate, a re-tick changes nothing', () => {
		fc.assert(
			fc.property(setupArb, fc.array(op, { maxLength: 24 }), (setup, ops) => {
				let s = begin(setup)
				for (const o of ops) {
					s = step(apply(s, setup, o), setup)
					const teamPool = s.lives.teamLives
					expect(teamPool).not.toBeNull()
					if (teamPool === null) return
					expect(teamPool.A).toBeGreaterThanOrEqual(0)
					expect(teamPool.B).toBeGreaterThanOrEqual(0)
					for (const id of setup.ids) {
						const side = s.teams.teams[id] === 'A' ? 'A' : 'B'
						expect(s.lives.players[id].lives).toBe(teamPool[side])
						// a pool loss shows once on every member: the events add up
						const delta = eventsOf(s, id).reduce((n, e) => n + e.delta, 0)
						expect(delta).toBe(livesOf(s, id) - (setup.lives ?? 4))
					}
					const alive = aliveIds(s)
					for (const [id, target] of Object.entries(
						s.cardTargets?.targets ?? {},
					)) {
						// a pending death or a decided result ends the run: the seats
						// of the emptied team are out without a forfeit
						if (s.result.kind === null && s.lives.pending.length === 0) {
							expect(alive).toContain(id)
							if (target !== null) expect(alive).toContain(target)
						}
						if (target === null) continue
						expect(target).not.toBe(id)
						expect(s.teams.teams[target]).not.toBe(s.teams.teams[id])
					}
					const again = decide(
						fromRuntime(s),
						envOf(setup),
						testContext(1000),
						TEAMS,
					)
					expect(again.state).toEqual(s)
				}
			}),
			{
				numRuns: 150,
				examples: [
					[
						planned(TWO_V_TWO),
						[
							{ kind: 'forfeit', who: 1 },
							{ kind: 'forfeit', who: 0 },
							{ kind: 'ready', key: 0 },
						],
					],
				],
			},
		)
	}, 20_000)

	const reverseKeys = <T>(map: { [id: string]: T }): { [id: string]: T } =>
		Object.fromEntries(Object.entries(map).reverse())

	it('the key order of the picks and of the players maps changes no outcome', () => {
		fc.assert(
			fc.property(setupArb, fc.array(op, { maxLength: 12 }), (setup, ops) => {
				const picks = setup.picks ?? {}
				const mirrored: Setup = { ...setup, picks: reverseKeys(picks) }
				const reorder = (s: RefereeState): RefereeState => ({
					...s,
					lives: { ...s.lives, players: reverseKeys(s.lives.players) },
					round: { ...s.round, players: reverseKeys(s.round.players) },
				})
				let a = begin(setup)
				let b = begin(mirrored)
				expect(b).toEqual(a)
				for (const o of ops) {
					a = step(apply(a, setup, o), setup)
					b = step(reorder(apply(b, setup, o)), setup)
					expect(b).toEqual(a)
				}
			}),
			{ numRuns: 100 },
		)
	})

	it('a state is the same whether or not the runtime wraps it', () => {
		fc.assert(
			fc.property(setupArb, fc.array(op, { maxLength: 16 }), (setup, ops) => {
				let plain = begin(setup)
				let wrapped = begin(setup)
				for (const o of ops) {
					plain = decide(
						apply(plain, setup, o),
						envOf(setup),
						testContext(1000),
						TEAMS,
					).state
					wrapped = decide(
						fromRuntime(apply(wrapped, setup, o)),
						envOf(setup),
						testContext(1000),
						TEAMS,
					).state
					expect(wrapped).toEqual(plain)
				}
			}),
			{ numRuns: 80 },
		)
	})
})
