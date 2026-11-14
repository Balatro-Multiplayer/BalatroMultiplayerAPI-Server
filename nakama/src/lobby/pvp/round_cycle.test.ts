// The round open (openNextRound): a Ready for the next round while the last one is
// still playing proves every starter left its blind, so that round resolves on what
// the server has before the next one opens (a crash rejoin must never end a round
// with no result). Driven through the real tick (`decide`) with the duel rules.
import { describe, expect, it } from 'vitest'
import {
	reportedPlayer,
	startOf,
	unreportedPlayer,
} from '../../testing/pvp_fixtures'
import { withRules } from '../../testing/pvp_rules'
import { testContext } from '../../testing/request_context'
import { duelMode } from './modes/duel'
import { type PvpRoundPlayer, type RefereeState, emptyFacts, emptyPvp } from './state'
import { type ModeFor, type TickEnv, decide } from './tick'

const ctx = testContext(1000)
const modeFor: ModeFor = () => duelMode
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

// Round 1 is playing (both on the `1:Boss` blind) and `a`, `b` hold the given entries.
function playingRound1(
	a: PvpRoundPlayer,
	b: PvpRoundPlayer,
): RefereeState {
	const idle: RefereeState = {
		...emptyPvp(),
		facts: emptyFacts(),
		runId: 'r1',
		lastStart: startOf(['a', 'b'], 1, 'a'),
	}
	const opened = decide(idle, env, ctx, modeFor).state
	return {
		...opened,
		round: { ...opened.round, players: { a, b } },
	}
}

// Both players Ready for round 2, on the Boss of ante 2.
const readyForRound2 = (state: RefereeState): RefereeState => ({
	...state,
	lastStart: startOf(['a', 'b'], 2, 'a', 2),
})

describe('a start that arrives while the round is still playing', () => {
	it('resolves the round on the reported scores, charges the loser, then opens the next', () => {
		const state = playingRound1(
			reportedPlayer({ score: '100', handsLeft: 2 }),
			reportedPlayer({ score: '200', handsLeft: 0 }),
		)
		expect(state.round.phase).toBe('playing')

		const out = decide(readyForRound2(state), env, ctx, modeFor).state

		expect(out.round.lastResult).toEqual({ roundId: 1, losers: ['a'] })
		expect(out.lives.players.a.lives).toBe(state.lives.players.a.lives - 1)
		expect(out.lives.players.a.events).toEqual([{ delta: -1, key: 'pvp:1' }])
		expect(out.lives.players.b.lives).toBe(state.lives.players.b.lives)
		expect(out.facts.guarded.a).toEqual(['1:Boss'])
		expect(out.round.roundId).toBe(2)
		expect(out.round.phase).toBe('playing')
	})

	it('ranks a starter who never sent a blind_start below every reported score', () => {
		const state = playingRound1(
			unreportedPlayer(),
			reportedPlayer({ score: '200', handsLeft: 0 }),
		)

		const out = decide(readyForRound2(state), env, ctx, modeFor).state

		expect(out.round.lastResult).toEqual({ roundId: 1, losers: ['a'] })
		expect(out.lives.players.a.events).toEqual([{ delta: -1, key: 'pvp:1' }])
		expect(out.round.roundId).toBe(2)
	})

	it('names no loser on an exact tie, and still opens the next round', () => {
		const state = playingRound1(
			reportedPlayer({ score: '100', handsLeft: 3 }),
			reportedPlayer({ score: '100', handsLeft: 1 }),
		)

		const out = decide(readyForRound2(state), env, ctx, modeFor).state

		expect(out.round.lastResult).toEqual({ roundId: 1, losers: [] })
		expect(out.lives.players.a.events).toEqual([])
		expect(out.lives.players.b.events).toEqual([])
		expect(out.round.roundId).toBe(2)
	})

	it('closes the round with no losers when no contest is left (everyone forfeited)', () => {
		const state = playingRound1(
			reportedPlayer({ score: '100', handsLeft: 2 }),
			reportedPlayer({ score: '200', handsLeft: 2 }),
		)
		const gone = {
			...state,
			lives: {
				...state.lives,
				players: {
					a: { ...state.lives.players.a, forfeited: true },
					b: { ...state.lives.players.b, forfeited: true },
				},
			},
		}

		const out = decide(readyForRound2(gone), env, ctx, modeFor).state

		expect(out.round.lastResult).toEqual({ roundId: 1, losers: [] })
		expect(out.lives.players.a.events).toEqual([])
		expect(out.lives.players.b.events).toEqual([])
		expect(out.result.kind).toBe('draw')
	})
})
