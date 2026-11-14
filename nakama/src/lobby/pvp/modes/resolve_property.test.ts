// For every mode: when every alive player is out of hands, resolveRound leaves the
// round no longer 'playing', whatever scores they reported (a player who never sent a
// blind_start has none). openNextRound relies on this to close a round whose
// starters all Readied for the next one (round_cycle.ts resolveLeftRound).
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { reportAll, startOf } from '../../../testing/pvp_fixtures'
import { withRules } from '../../../testing/pvp_rules'
import { testContext } from '../../../testing/request_context'
import { resolveRound } from '../round_cycle'
import {
	type PvpRoundPlayer,
	type PvpTeam,
	type RefereeState,
	emptyFacts,
	emptyPvp,
} from '../state'
import { type ModeFor, type TickEnv, decide } from '../tick'
import { aliveIds } from './common'
import { duelMode } from './duel'
import { manhuntMode } from './manhunt'
import { nemesisMode } from './nemesis'
import { royaleMode } from './royale'
import { teamsMode } from './teams'
import type { Mode } from './types'

const ctx = testContext(1000)

interface Setup {
	name: string
	mode: Mode
	// Whether the alive players still make a contest the mode must rank.
	hasContest: (alive: string[]) => boolean
	ids: string[]
	metadata: { [key: string]: unknown }
	picks: { [id: string]: PvpTeam }
	teamPlan: string[][] | null
}

const atLeast =
	(n: number) =>
	(alive: string[]): boolean =>
		alive.length >= n

const SETUPS: Setup[] = [
	{ name: 'duel', mode: duelMode, hasContest: atLeast(2), ids: ['a', 'b'], metadata: {}, picks: {}, teamPlan: null },
	{ name: 'royale', mode: royaleMode, hasContest: atLeast(2), ids: ['a', 'b', 'c'], metadata: {}, picks: {}, teamPlan: null },
	{ name: 'nemesis', mode: nemesisMode, hasContest: atLeast(2), ids: ['a', 'b', 'c'], metadata: {}, picks: {}, teamPlan: null },
	{
		name: 'manhunt',
		mode: manhuntMode,
		// a is the Runner: it and at least one Hunter must be alive
		hasContest: (alive) => alive.includes('a') && alive.length >= 2,
		ids: ['a', 'b', 'c', 'd'],
		metadata: { queue_mode: 'pvp_manhunt', manhunt_hunter_lives: 3 },
		picks: { a: 'RUNNER' },
		teamPlan: null,
	},
	{
		name: 'teams',
		mode: teamsMode,
		hasContest: atLeast(1),
		ids: ['a', 'b', 'c', 'd'],
		metadata: { queue_mode: 'pvp_teams' },
		picks: {},
		teamPlan: [
			['a', 'b'],
			['c', 'd'],
		],
	},
]

// The run settled by the first tick, round 1 playing, every seat reported.
function playing(setup: Setup): RefereeState {
	const env: TickEnv = {
		runId: 'r1',
		startedIds: setup.ids,
		seatedIds: setup.ids,
		readyIds: [],
		readiedIds: [],
		raceStarted: true,
		ranked: false,
		requiredIds: setup.ids,
		awayIds: [],
		metadata: withRules({ ruleset: 'ruleset_mp_traditional', ...setup.metadata }),
		picks: setup.picks,
		teamPlan: setup.teamPlan,
	}
	const modeFor: ModeFor = () => setup.mode
	const idle: RefereeState = {
		...emptyPvp(),
		facts: emptyFacts(),
		runId: 'r1',
		lastStart: startOf(setup.ids, 1, setup.ids[0]),
	}
	return reportAll(decide(idle, env, ctx, modeFor).state)
}

// How a player's hands ended: the count reached 0 with a reported score, or the
// server spent them (a Ready left the blind), with or without a blind_start.
const doneEntry: fc.Arbitrary<Partial<PvpRoundPlayer>> = fc.oneof(
	fc.record({
		score: fc.nat(1000).map(String),
		handsLeft: fc.constant(0),
	}),
	fc.record({
		score: fc.option(fc.nat(1000).map(String), { nil: null }),
		handsLeft: fc.option(fc.nat(4), { nil: null }),
		handsSpent: fc.constant(true),
	}),
)

// How a seat can be out of the run: still in, forfeited, eliminated, or at 0 lives.
const OUT_OF_RUN = {
	alive: {},
	forfeited: { forfeited: true },
	eliminated: { eliminated: true, lives: 0 },
	zero: { lives: 0 },
}
const seatStatus = fc.constantFrom(
	...(Object.keys(OUT_OF_RUN) as (keyof typeof OUT_OF_RUN)[]),
)

describe.each(SETUPS)('resolveRound ($name)', (setup) => {
	const base = playing(setup)

	it('starts the property with a playing round and every seat alive', () => {
		expect(base.round.phase).toBe('playing')
		expect(aliveIds(base)).toEqual(setup.ids)
	})

	it('leaves the round resolved whenever a contest is left and every alive entry is out of hands', () => {
		fc.assert(
			fc.property(
				fc.array(fc.tuple(doneEntry, seatStatus), {
					minLength: setup.ids.length,
					maxLength: setup.ids.length,
				}),
				(seats) => {
					const players = { ...base.round.players }
					const lives = { ...base.lives.players }
					setup.ids.forEach((id, i) => {
						const [entry, status] = seats[i]
						players[id] = { ...players[id], ...entry }
						lives[id] = { ...lives[id], ...OUT_OF_RUN[status] }
					})
					const state = {
						...base,
						round: { ...base.round, players },
						lives: { ...base.lives, players: lives },
					}
					const out = resolveRound(state, setup.mode, ctx)
					if (setup.hasContest(aliveIds(state)))
						expect(out.round.phase).not.toBe('playing')
				},
			),
			{ numRuns: 300 },
		)
	})
})
