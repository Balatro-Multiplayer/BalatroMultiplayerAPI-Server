// The pending deaths of the team modes (R45 Manhunt, R53 Teams) and the PvP-blind
// test that keeps a lowered ante from opening a fake one. The rules are
// pending.ts's; these tests drive deaths.ts on plain states, and the tick for
// the end to end rows. Settles read the state through `fromRuntime`.
import { describe, expect, it } from 'vitest'
import { withRules } from '../../testing/pvp_rules'
import { testContext } from '../../testing/request_context'
import { fromRuntime } from '../../testing/runtime_state'
import { openDeath, settlePending } from './deaths'
import { FACT_REDUCERS } from './facts'
import { runOut } from './lives'
import { duelMode } from './modes/duel'
import { inertMode } from './modes/testing'
import type { Mode } from './modes/types'
import { withTeamResult } from './result'
import {
	type PvpMode,
	type PvpResult,
	type PvpTeam,
	type RefereeState,
	emptyFacts,
	emptyPvp,
} from './state'
import { type ModeFor, type TickEnv, decide } from './tick'

const ctx = testContext(1000)

interface Seat {
	team: PvpTeam
	lives?: number
	left?: boolean
	forfeited?: boolean
}

// A frozen team game as the tick leaves it: seats with their lives and the
// roster of teams. A seat is "in the run" while it has lives and has not left.
function game(
	mode: PvpMode,
	seats: { [id: string]: Seat },
	extra: Partial<RefereeState> = {},
): RefereeState {
	const players: RefereeState['lives']['players'] = {}
	const teams: { [id: string]: PvpTeam } = {}
	const pool: { A: number; B: number } = { A: 0, B: 0 }
	for (const id of Object.keys(seats)) {
		const seat = seats[id]
		const lives = seat.lives ?? 3
		players[id] = {
			lives,
			eliminated: lives <= 0,
			forfeited: seat.forfeited ?? false,
			left: seat.left ?? false,
			events: [],
		}
		teams[id] = seat.team
		if (seat.team === 'A' || seat.team === 'B') pool[seat.team] = lives
	}
	return {
		...emptyPvp(),
		facts: emptyFacts(),
		runId: 'r1',
		lastStart: null,
		rules: {
			runId: 'r1',
			mode,
			startedCount: Object.keys(seats).length,
			startingLives: 4,
			hunterLives: 7,
			pvpStartAnte: 2,
			deathOnRoundLoss: true,
			clocks: { ante: 'none', pvp: null, personal: null },
			timerBaseMs: 150_000,
			timerForgiveness: 0,
			timerIncrementMs: 60_000,
			skipTimeRule: 'lead',
		},
		lives: {
			runId: 'r1',
			players,
			teamLives: mode === 'teams' ? pool : null,
			pending: [],
		},
		teams: { runId: 'r1', teams },
		...extra,
	}
}

const MANHUNT_RULES: Mode = inertMode('manhunt')
const TEAMS_RULES: Mode = inertMode('teams')

// One Runner and two Hunters; the Runner is at 0 lives (they just lost the last).
const manhunt = (seats: { [id: string]: Partial<Seat> } = {}): RefereeState =>
	game('manhunt', {
		r: { team: 'RUNNER', lives: 0, ...seats.r },
		h1: { team: 'HUNTER', ...seats.h1 },
		h2: { team: 'HUNTER', ...seats.h2 },
	})

// Two against two; team A's pool is at 0.
const teams = (seats: { [id: string]: Partial<Seat> } = {}): RefereeState =>
	game('teams', {
		a1: { team: 'A', lives: 0, ...seats.a1 },
		a2: { team: 'A', lives: 0, ...seats.a2 },
		b1: { team: 'B', ...seats.b1 },
		b2: { team: 'B', ...seats.b2 },
	})

const withBlind = (
	state: RefereeState,
	id: string,
	key: string,
	beaten: boolean,
): RefereeState => ({
	...state,
	facts: {
		...state.facts,
		blinds: {
			...state.facts.blinds,
			[id]: {
				...state.facts.blinds[id],
				[key]: { beaten, roundLost: !beaten },
			},
		},
	},
})
const beat = (s: RefereeState, id: string, key: string) =>
	withBlind(s, id, key, true)
const fail = (s: RefereeState, id: string, key: string) =>
	withBlind(s, id, key, false)

const withPending = (
	state: RefereeState,
	playerId: string,
	blindKey: string,
	waitsOn: string[],
): RefereeState => ({
	...state,
	lives: { ...state.lives, pending: [{ playerId, blindKey, waitsOn }] },
})

const withPvpBlinds = (
	state: RefereeState,
	pvpBlinds: { [id: string]: string[] },
): RefereeState => ({ ...state, facts: { ...state.facts, pvpBlinds } })

const DECIDED_NONE: PvpResult = {
	runId: null,
	kind: null,
	winnerId: null,
	winnerTeam: null,
	places: [],
}

describe('R45 / R53 a team death waits on the other side', () => {
	it.each<[string, RefereeState, Mode, string, string, string[]]>([
		[
			'R45: a Runner at 0 lives on 3:Small waits on the Hunters in the run',
			manhunt(),
			MANHUNT_RULES,
			'r',
			'3:Small',
			['h1', 'h2'],
		],
		[
			'R45: a Hunter who left, one forfeited and one out are not waited on',
			game('manhunt', {
				r: { team: 'RUNNER', lives: 0 },
				h1: { team: 'HUNTER' },
				h2: { team: 'HUNTER', left: true },
				h3: { team: 'HUNTER', forfeited: true },
				h4: { team: 'HUNTER', lives: 0 },
			}),
			MANHUNT_RULES,
			'r',
			'3:Small',
			['h1'],
		],
		[
			'R53: team A at 0 on 2:Big waits on the members of B in the run',
			teams(),
			TEAMS_RULES,
			'a1',
			'2:Big',
			['b1', 'b2'],
		],
		[
			'R53: the member whose loss emptied the pool is the one named',
			teams({ b2: { left: true } }),
			TEAMS_RULES,
			'a2',
			'2:Big',
			['b1'],
		],
	])('%s', (_name, state, rules, id, key, waitsOn) => {
		const next = openDeath(state, rules, id, key)
		expect(next.lives.pending).toEqual([
			{ playerId: id, blindKey: key, waitsOn },
		])
		expect(next.result.kind).toBeNull()
	})

	it.each<[string, RefereeState, Mode, string, string]>([
		[
			'R45: a Hunter at 0 lives is simply out',
			game('manhunt', {
				r: { team: 'RUNNER' },
				h1: { team: 'HUNTER', lives: 0 },
				h2: { team: 'HUNTER' },
			}),
			MANHUNT_RULES,
			'h1',
			'3:Small',
		],
		[
			'R45: the Runner dying on a PvP blind opens nothing',
			withPvpBlinds(manhunt(), { r: ['3:Boss'] }),
			MANHUNT_RULES,
			'r',
			'3:Boss',
		],
		[
			'R45: the Runner losing a PvP round opens nothing',
			manhunt(),
			MANHUNT_RULES,
			'r',
			'pvp:4',
		],
		[
			'R53: a pool emptied on a PvP blind opens nothing',
			withPvpBlinds(teams(), { a1: ['2:Boss'] }),
			TEAMS_RULES,
			'a1',
			'2:Boss',
		],
		[
			'R53: a pool emptied by a lost PvP round opens nothing',
			teams(),
			TEAMS_RULES,
			'a1',
			'pvp:2',
		],
	])('%s', (_name, state, rules, id, key) => {
		expect(openDeath(state, rules, id, key)).toBe(state)
	})

	it.each<[string, RefereeState, Mode, string]>([
		[
			'R45: a second death while one is open',
			withPending(manhunt(), 'r', '2:Small', ['h1']),
			MANHUNT_RULES,
			'r',
		],
		[
			'R53: a second pool at 0 while one is open',
			withPending(teams(), 'a1', '2:Big', ['b1', 'b2']),
			TEAMS_RULES,
			'b1',
		],
	])(
		'%s opens nothing (one team pending at a time)',
		(_name, state, rules, id) => {
			expect(openDeath(state, rules, id, '3:Small')).toBe(state)
		},
	)
})

describe('R45 / R53 a team pending settles on the other side', () => {
	const waiting = (
		state: RefereeState,
		id: string,
		key: string,
		on: string[],
	) => withPending(state, id, key, on)

	it.each<[string, RefereeState, Mode, PvpResult]>([
		[
			'R45: one Hunter beats 3:Small, the Hunters win',
			beat(waiting(manhunt(), 'r', '3:Small', ['h1', 'h2']), 'h1', '3:Small'),
			MANHUNT_RULES,
			{
				runId: 'r1',
				kind: 'win',
				winnerId: null,
				winnerTeam: 'HUNTER',
				places: [
					{ playerId: 'h1', place: 1 },
					{ playerId: 'h2', place: 1 },
					{ playerId: 'r', place: 2 },
				],
			},
		],
		[
			'R45: every Hunter fails 3:Small, a draw',
			fail(
				fail(waiting(manhunt(), 'r', '3:Small', ['h1', 'h2']), 'h1', '3:Small'),
				'h2',
				'3:Small',
			),
			MANHUNT_RULES,
			{
				runId: 'r1',
				kind: 'draw',
				winnerId: null,
				winnerTeam: null,
				places: [
					{ playerId: 'h1', place: 1 },
					{ playerId: 'h2', place: 1 },
					{ playerId: 'r', place: 1 },
				],
			},
		],
		[
			'R45: one Hunter at 0 lives and one who left, a draw',
			waiting(
				manhunt({ h1: { lives: 0 }, h2: { left: true } }),
				'r',
				'3:Small',
				['h1', 'h2'],
			),
			MANHUNT_RULES,
			{
				runId: 'r1',
				kind: 'draw',
				winnerId: null,
				winnerTeam: null,
				places: [
					{ playerId: 'h1', place: 1 },
					{ playerId: 'h2', place: 1 },
					{ playerId: 'r', place: 1 },
				],
			},
		],
		[
			'R53: a B member beats 2:Big, B wins',
			beat(waiting(teams(), 'a1', '2:Big', ['b1', 'b2']), 'b2', '2:Big'),
			TEAMS_RULES,
			{
				runId: 'r1',
				kind: 'win',
				winnerId: null,
				winnerTeam: 'B',
				places: [
					{ playerId: 'a1', place: 2 },
					{ playerId: 'a2', place: 2 },
					{ playerId: 'b1', place: 1 },
					{ playerId: 'b2', place: 1 },
				],
			},
		],
		[
			'R53: every B member fails 2:Big, a draw',
			fail(
				fail(waiting(teams(), 'a1', '2:Big', ['b1', 'b2']), 'b1', '2:Big'),
				'b2',
				'2:Big',
			),
			TEAMS_RULES,
			{
				runId: 'r1',
				kind: 'draw',
				winnerId: null,
				winnerTeam: null,
				places: [
					{ playerId: 'a1', place: 1 },
					{ playerId: 'a2', place: 1 },
					{ playerId: 'b1', place: 1 },
					{ playerId: 'b2', place: 1 },
				],
			},
		],
		[
			"R53: a2 beat 2:Big, a1 failed it and emptied pool A, both B members fail it: a draw (the dead side's own beaten blind does not settle)",
			fail(
				fail(
					beat(waiting(teams(), 'a1', '2:Big', ['b1', 'b2']), 'a2', '2:Big'),
					'b1',
					'2:Big',
				),
				'b2',
				'2:Big',
			),
			TEAMS_RULES,
			{
				runId: 'r1',
				kind: 'draw',
				winnerId: null,
				winnerTeam: null,
				places: [
					{ playerId: 'a1', place: 1 },
					{ playerId: 'a2', place: 1 },
					{ playerId: 'b1', place: 1 },
					{ playerId: 'b2', place: 1 },
				],
			},
		],
	])('%s', (_name, state, rules, expected) => {
		const next = settlePending(fromRuntime(state), rules)
		expect(next.lives.pending).toEqual([])
		expect(next.result).toEqual(expected)
	})

	it.each<[string, RefereeState, Mode]>([
		[
			'R45: one Hunter has failed, one is still playing',
			fail(waiting(manhunt(), 'r', '3:Small', ['h1', 'h2']), 'h1', '3:Small'),
			MANHUNT_RULES,
		],
		[
			'R45: nobody has reported yet',
			waiting(manhunt(), 'r', '3:Small', ['h1', 'h2']),
			MANHUNT_RULES,
		],
		[
			'R45: a Hunter beat another blind',
			beat(waiting(manhunt(), 'r', '3:Small', ['h1', 'h2']), 'h1', '3:Big'),
			MANHUNT_RULES,
		],
		[
			'R53: one B member failed, one is still playing',
			fail(waiting(teams(), 'a1', '2:Big', ['b1', 'b2']), 'b1', '2:Big'),
			TEAMS_RULES,
		],
	])('%s: still pending, the same state', (_name, state, rules) => {
		expect(settlePending(state, rules)).toBe(state)
	})

	it('a result already decided is kept and the pending stays as it is', () => {
		const decided: PvpResult = {
			runId: 'r1',
			kind: 'win',
			winnerId: null,
			winnerTeam: 'RUNNER',
			places: [{ playerId: 'r', place: 1 }],
		}
		const state = {
			...beat(
				waiting(manhunt(), 'r', '3:Small', ['h1', 'h2']),
				'h1',
				'3:Small',
			),
			result: decided,
		}
		expect(settlePending(state, MANHUNT_RULES)).toBe(state)
	})

	it('a game with no pending death settles to the same state', () => {
		const state = manhunt()
		expect(settlePending(state, MANHUNT_RULES)).toBe(state)
		expect(state.result).toEqual(DECIDED_NONE)
	})
})

// The tick records the blind each player Readied, and a loss on it is a PvP
// loss even below pvpStartAnte (a Manhunt voucher lowers a player's own ante).
describe('a blind the player had a Ready round on is a PvP blind for them', () => {
	it.each<
		[string, { [id: string]: string[] } | undefined, string, string, number]
	>([
		[
			'below pvpStartAnte, a Ready round on the blind: nothing opens',
			{ a: ['1:Boss'] },
			'a',
			'1:Boss',
			0,
		],
		[
			'the earlier of two Ready rounds counts too',
			{ a: ['1:Boss', '2:Boss'] },
			'a',
			'1:Boss',
			0,
		],
		[
			"another player's Ready round on it does not count",
			{ b: ['1:Boss'] },
			'a',
			'1:Boss',
			1,
		],
		[
			'a Ready round on another blind does not count',
			{ a: ['2:Boss'] },
			'a',
			'1:Boss',
			1,
		],
		[
			'no Ready round on record: a Boss below the start ante is normal',
			undefined,
			'a',
			'1:Boss',
			1,
		],
		[
			'a Boss with no Ready round on record is a normal blind',
			{},
			'a',
			'2:Boss',
			1,
		],
	])('%s', (_name, pvpBlinds, id, key, opened) => {
		const duel = game('royale', {
			a: { team: 'A', lives: 0 },
			b: { team: 'B' },
		})
		const state = pvpBlinds ? withPvpBlinds(duel, pvpBlinds) : duel
		const next = openDeath(state, duelMode, id, key)
		expect(next.lives.pending).toHaveLength(opened)
	})

	const duelFor: ModeFor = () => duelMode
	const env: TickEnv = {
		runId: 'r1',
		startedIds: ['a', 'b'],
		seatedIds: ['a', 'b'],
		readyIds: [],
		readiedIds: [],
		raceStarted: true,
		ranked: false,
		requiredIds: ['a', 'b'],
		awayIds: [],
		metadata: withRules({ ruleset: 'ruleset_mp_traditional' }),
		picks: {},
		teamPlan: null,
	}
	const START = {
		roundId: 1,
		firstPlayer: 'a',
		players: ['a', 'b'],
		blindKeys: { a: '1:Boss', b: '1:Boss' },
	}

	it('a last life lost by a timer run-out on that Boss ends the duel with no pending', () => {
		const idle: RefereeState = {
			...emptyPvp(),
			facts: emptyFacts(),
			runId: 'r1',
			lastStart: START,
		}
		const opened = decide(idle, env, ctx, duelFor).state
		const a = opened.lives.players.a
		const lastLife: RefereeState = {
			...opened,
			lives: {
				...opened.lives,
				players: { ...opened.lives.players, a: { ...a, lives: 1 } },
			},
		}
		// the server's own run-out knows no blind, so the last life opens no record
		const ran = runOut(lastLife, duelMode, 'a')
		const next = decide(fromRuntime(ran), env, ctx, duelFor).state
		expect(next.lives.players.a.lives).toBe(0)
		expect(next.lives.pending).toEqual([])
		expect(next.result).toMatchObject({ kind: 'win', winnerId: 'b' })
	})
})

// The end to end: Manhunt's death waits in the tick for the Hunters' blind results.
describe('R45 through the tick', () => {
	const IDS = ['r', 'h1', 'h2']
	const rules: Mode = {
		...inertMode('manhunt'),
		init: (state) => {
			const { rules: frozen } = state
			if (frozen.runId === null || state.round.runId === frozen.runId)
				return state
			const players: RefereeState['round']['players'] = {}
			for (const id of IDS)
				players[id] = {
					score: '0',
					handsLeft: 4,
					highestScore: '0',
					ante: 3,
					furthestBlind: 0,
					reportedHands: 4,
					reportedApplied: 0,
					timerLosses: 0,
					handsSpent: false,
					committedHands: null,
					creditedHands: null,
					pvpLeftMs: null,
				}
			return {
				...state,
				round: { ...state.round, players },
				teams: {
					...state.teams,
					teams: { r: 'RUNNER', h1: 'HUNTER', h2: 'HUNTER' },
				},
				lives: {
					...state.lives,
					players: Object.fromEntries(
						IDS.map((id) => [
							id,
							{
								lives: id === 'r' ? 1 : 7,
								eliminated: false,
								forfeited: false,
								left: false,
								events: [],
							},
						]),
					),
				},
			}
		},
		// The Runner out of lives loses to the Hunters (the mode's own rule).
		checkWinner: (state) =>
			state.lives.players.r.lives <= 0
				? withTeamResult(state, 'win', 'HUNTER')
				: state,
	}
	const manhuntFor: ModeFor = () => rules
	const manhuntEnv: TickEnv = {
		runId: 'r1',
		startedIds: IDS,
		seatedIds: IDS,
		readyIds: [],
		readiedIds: [],
		raceStarted: true,
		ranked: false,
		requiredIds: IDS,
		awayIds: [],
		metadata: withRules({
			ruleset: 'ruleset_mp_traditional',
			queue_mode: 'pvp_manhunt',
		}),
		picks: {},
		teamPlan: null,
	}
	const post = (
		state: RefereeState,
		type: string,
		id: string,
		args: object,
	) => {
		const timed = {
			...state,
			facts: { ...state.facts, timerN: Math.max(state.facts.timerN, 1) },
		}
		const r = FACT_REDUCERS[type](timed, id, { runId: 'r1', ...args })
		if (!r.ok) throw new Error(`refused: ${r.reason}`)
		return r.state
	}
	const step = (state: RefereeState): RefereeState =>
		fromRuntime(decide(fromRuntime(state), manhuntEnv, ctx, manhuntFor).state)

	const runnerDied = (): RefereeState => {
		const idle: RefereeState = {
			...emptyPvp(),
			facts: emptyFacts(),
			runId: 'r1',
			lastStart: {
				roundId: 1,
				firstPlayer: 'r',
				players: IDS,
				blindKeys: { r: '3:Boss', h1: '3:Boss', h2: '3:Boss' },
			},
		}
		const opened = decide(idle, manhuntEnv, ctx, manhuntFor).state
		return step(
			post(opened, 'pvp.blind', 'r', {
				blindKey: '3:Small',
				beaten: false,
				roundLost: true,
			}),
		)
	}

	it('the Runner timing out of the last life is a death with no blind: the Hunters win at once', () => {
		const idle: RefereeState = {
			...emptyPvp(),
			facts: emptyFacts(),
			runId: 'r1',
			lastStart: {
				roundId: 1,
				firstPlayer: 'r',
				players: IDS,
				blindKeys: { r: '3:Boss', h1: '3:Boss', h2: '3:Boss' },
			},
		}
		const opened = decide(idle, manhuntEnv, ctx, manhuntFor).state
		const s = step(runOut(opened, rules, 'r'))
		expect(s.lives.players.r.lives).toBe(0)
		expect(s.lives.pending).toEqual([])
		expect(s.result).toMatchObject({ kind: 'win', winnerTeam: 'HUNTER' })
	})

	it('the Runner out of lives on 3:Small holds the Hunters win back', () => {
		const s = runnerDied()
		expect(s.lives.players.r.lives).toBe(0)
		expect(s.lives.pending).toEqual([
			{ playerId: 'r', blindKey: '3:Small', waitsOn: ['h1', 'h2'] },
		])
		expect(s.result.kind).toBeNull()
	})

	it('a Hunter beating 3:Small then ends the game for the Hunters', () => {
		const s = step(
			post(runnerDied(), 'pvp.blind', 'h2', {
				blindKey: '3:Small',
				beaten: true,
				roundLost: false,
			}),
		)
		expect(s.lives.pending).toEqual([])
		expect(s.result).toMatchObject({ kind: 'win', winnerTeam: 'HUNTER' })
	})

	it('every Hunter failing 3:Small ends the game in a draw', () => {
		let s = runnerDied()
		for (const id of ['h1', 'h2'])
			s = post(s, 'pvp.blind', id, {
				blindKey: '3:Small',
				beaten: false,
				roundLost: false,
			})
		s = step(s)
		expect(s.lives.pending).toEqual([])
		expect(s.result).toMatchObject({ kind: 'draw', winnerTeam: null })
	})
})
