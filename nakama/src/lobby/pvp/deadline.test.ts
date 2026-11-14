import { readFileSync } from 'node:fs'
import { join as pathJoin } from 'node:path'
// The server-owned PvP timers: who a started timer times, when its
// deadline opens, drops, refreshes, runs out and restarts, and what the run-out
// costs. The pure rules are tested on plain data; the tick rows drive `decide`
// with the real mode rules (`pickMode`) and read every state through
// `fromRuntime`, so nothing relies on object identity. The end to end rows go
// through the request registry and `pvpTick`, and pin the wire shape.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
	populatedPvpLobby,
	raced,
	startOf,
	reportAll,
} from '../../testing/pvp_fixtures'
import { testContext } from '../../testing/request_context'
import { fromRuntime } from '../../testing/runtime_state'
import { checkpointOf, resumeFrom } from '../checkpoint'
import { announceChange, changedKeys, matchStateOf } from '../match_state'
import type { StateMessage } from '../protocol'
import { clockLive } from './clocks'
import { fromGameValue } from './score'
import { action } from '../relay'
import { type RequestResult, handleRequest } from '../requests'
import {
	type Lobby,
	type Outbound,
	type Step,
	disconnect,
	join,
	newLobby,
	snapshotFor,
} from '../state'
import {
	type Deadline,
	type TimerWorld,
	dropReason,
	deadlineStep,
	expired,
	holderAfter,
	pausedFor,
	plainDeadline,
	projectDeadline,
	pvpRunOut,
	restarted,
	withLiveDeadline,
	worldOf,
	wouldTime,
} from './deadline'
import { FACT_REDUCERS, reduceProgress } from './facts'
import { pickMode } from './modes'
import { NO_ENDS, pvpTick as tickWith } from './pvp_tick'
import { pvpOf, readyReducer } from './ready'
import type { FactResult } from './reducer'
import {
	type PvpFact,
	type PvpTeam,
	type RefereeState,
	emptyFacts,
	emptyPvp,
	inRunIgnoringLives,
	refereeOf,
	withReferee,
} from './state'
import { type TickEnv, decide } from './tick'
import {
	reduceAnimating,
	reduceTimerPause,
	reduceTimerStart,
} from './timer_facts'
import { projectRound } from './view'
import { withRules } from '../../testing/pvp_rules'

// These tests end no game, so the tick gets no ends: reaching one throws.
const pvpTick = (
	lobby: Parameters<typeof tickWith>[0],
	ctx: Parameters<typeof tickWith>[1],
) => tickWith(lobby, ctx, NO_ENDS)

// ------------------------------------------------------------ state-level harness

interface Setup {
	ids: string[]
	metadata: { [key: string]: unknown }
	picks?: { [id: string]: PvpTeam }
	plan?: string[][] | null
}

const DUEL: Setup = { ids: ['a', 'b'], metadata: withRules({ ruleset: 'ruleset_mp_balanced' }) }
// A personal-clock ruleset: the Ante is timed by each client's own clock, no bank.
const PERSONAL: Setup = {
	ids: ['a', 'b'],
	metadata: withRules({ ruleset: 'ruleset_mp_experimental' }),
}
// A ruleset with neither an Ante clock nor a hand timer.
const TRADITIONAL: Setup = {
	ids: ['a', 'b'],
	metadata: withRules({ ruleset: 'ruleset_mp_traditional' }),
}
const ROYALE: Setup = {
	ids: ['a', 'b', 'c'],
	metadata: withRules({ ruleset: 'ruleset_mp_balanced', queue_mode: 'pvp_royale' }),
}
const NEMESIS: Setup = {
	ids: ['a', 'b', 'c', 'd'],
	metadata: withRules({ ruleset: 'ruleset_mp_balanced', queue_mode: 'pvp_nemesis' }),
}
const MANHUNT: Setup = {
	ids: ['r', 'h1', 'h2'],
	metadata: withRules({ ruleset: 'ruleset_mp_balanced', queue_mode: 'pvp_manhunt' }),
	picks: { r: 'RUNNER' },
}
const TEAMS: Setup = {
	ids: ['a1', 'a2', 'b1', 'b2'],
	metadata: withRules({ ruleset: 'ruleset_mp_balanced', queue_mode: 'pvp_teams' }),
	plan: [
		['a1', 'a2'],
		['b1', 'b2'],
	],
}

const BASE_MS = 150_000

function envOf(
	setup: Setup,
	state: RefereeState | null,
	readyIds: string[],
	gone: string[] = [],
	away: string[] = [],
): TickEnv {
	const seated = setup.ids.filter((id) => !gone.includes(id))
	return {
		runId: 'r1',
		startedIds: setup.ids,
		seatedIds: seated,
		awayIds: away,
		readyIds,
		readiedIds: [],
		raceStarted: true,
		ranked: false,
		requiredIds: state
			? seated.filter((id) => inRunIgnoringLives(state.lives.players[id]))
			: seated,
		metadata: setup.metadata,
		picks: setup.picks ?? {},
		teamPlan: setup.plan ?? null,
	}
}

// The first tick: the mode settles the run and round 1 opens.
function begin(setup: Setup): RefereeState {
	const idle: RefereeState = {
		...emptyPvp(),
		facts: emptyFacts(),
		runId: 'r1',
		lastStart: startOf(setup.ids),
	}
	// Every player reported their blind's start, as the clients do.
	return reportAll(
		decide(idle, envOf(setup, null, []), testContext(0), pickMode).state,
	)
}

function tick(
	state: RefereeState,
	setup: Setup,
	now: number,
	readyIds: string[] = [],
	gone: string[] = [],
	away: string[] = [],
): RefereeState {
	return fromRuntime(
		decide(
			fromRuntime(state),
			envOf(setup, state, readyIds, gone, away),
			testContext(now),
			pickMode,
		).state,
	)
}

function worldFor(
	state: RefereeState,
	setup: Setup,
	readyIds: string[],
): TimerWorld {
	return worldOf(
		state,
		pickMode(state.rules.mode ?? 'royale', state.rules.startedCount),
		readyIds,
		envOf(setup, state, readyIds).requiredIds,
	)
}

const must = (r: FactResult): RefereeState => {
	if (!r.ok) throw new Error(`refused: ${r.reason}`)
	return r.state
}

interface StartArgs {
	kind: 'ante' | 'pvp'
	roundId?: number
}

// `id`'s Ante bank set to `ms` (10 s .. the base), through the spent time the
// server derives the bank from.
function withBank(state: RefereeState, id: string, ms: number): RefereeState {
	return {
		...state,
		facts: {
			...state.facts,
			skips: {
				...state.facts.skips,
				[id]: { skips: null, skipsAtPvp: null, facing: null, spentMs: BASE_MS - ms },
			},
		},
	}
}

function startTimer(
	state: RefereeState,
	setup: Setup,
	by: string,
	args: StartArgs,
	readyIds: string[],
): FactResult {
	return reduceTimerStart(
		state,
		by,
		{ runId: 'r1', ...args },
		worldFor(state, setup, readyIds),
	)
}

// An Ante start by `by`, then the tick at `now` that opens its deadline.
function anteOn(
	state: RefereeState,
	setup: Setup,
	by: string,
	ms: number | undefined,
	now: number,
	readyIds: string[],
): RefereeState {
	const banked = ms === undefined ? state : withBank(state, by, ms)
	const started = must(
		startTimer(
			banked,
			setup,
			by,
			{ kind: 'ante' },
			readyIds,
		),
	)
	return tick(started, setup, now, readyIds)
}

const deadlineOf = (state: RefereeState): Deadline | null =>
	plainDeadline(state.facts.deadline)
const livesOf = (state: RefereeState, id: string): number =>
	state.lives.players[id].lives

function withLives(
	state: RefereeState,
	id: string,
	lives: number,
): RefereeState {
	const seat = state.lives.players[id]
	return {
		...state,
		lives: {
			...state.lives,
			players: {
				...state.lives.players,
				[id]: { ...seat, lives, eliminated: lives <= 0 },
			},
		},
	}
}

// The ante a player is on, with the Small and Big of it already answered: the
// next failed blind is that ante's Boss.
function atBoss(state: RefereeState, id: string): RefereeState {
	const ante = state.round.players[id].ante
	return withBlinds(state, id, [`${ante}:Small`, `${ante}:Big`])
}

// Both seats of a team and the pool at `lives`.
function withPool(
	state: RefereeState,
	team: 'A' | 'B',
	lives: number,
): RefereeState {
	const players = { ...state.lives.players }
	for (const id of Object.keys(players))
		if (state.teams.teams[id] === team)
			players[id] = { ...players[id], lives, eliminated: lives <= 0 }
	const pool = state.lives.teamLives ?? { A: 0, B: 0 }
	return {
		...state,
		lives: { ...state.lives, players, teamLives: { ...pool, [team]: lives } },
	}
}

function scored(
	state: RefereeState,
	scores: { [id: string]: [string, number] },
): RefereeState {
	const players = { ...state.round.players }
	// A scored player has played a hand this round, so they are not masked.
	const handRound = { ...state.facts.handRound }
	for (const id of Object.keys(scores)) {
		players[id] = {
			...players[id],
			score: scores[id][0],
			handsLeft: scores[id][1],
		}
		handRound[id] = state.round.roundId
	}
	return {
		...state,
		round: { ...state.round, players },
		facts: { ...state.facts, handRound },
	}
}

function withBlinds(
	state: RefereeState,
	id: string,
	keys: string[],
): RefereeState {
	const seen: RefereeState['facts']['blinds'][string] = {}
	for (const key of keys) seen[key] = { beaten: true, roundLost: false }
	return {
		...state,
		facts: {
			...state.facts,
			blinds: { ...state.facts.blinds, [id]: seen },
		},
	}
}

// ---------------------------------------------------------------- the pure rules

describe('wouldTime: the Ante timer times who the round waits on', () => {
	const ready = (...ids: string[]) => ids
	it.each<[string, Setup, string, string[], string[] | string]>([
		['the starter is not Ready', DUEL, 'a', ready(), 'not_ready'],
		['the opponent is not Ready', DUEL, 'a', ready('a'), ['b']],
		['everyone is Ready', DUEL, 'a', ready('a', 'b'), 'nobody_to_time'],
		[
			'Royale times every player that is not Ready',
			ROYALE,
			'a',
			ready('a'),
			['b', 'c'],
		],
		['Royale leaves a Ready player alone', ROYALE, 'a', ready('a', 'b'), ['c']],
		[
			'Manhunt: the Runner times both Hunters',
			MANHUNT,
			'r',
			ready('r'),
			['h1', 'h2'],
		],
		[
			'Manhunt: a Hunter times the Runner and never the other Hunter',
			MANHUNT,
			'h1',
			ready('h1'),
			['r'],
		],
		[
			'Manhunt: a Hunter facing only its own side has nobody to time',
			MANHUNT,
			'h1',
			ready('h1', 'r'),
			'nobody_to_time',
		],
		[
			'Teams: a member times the other team and never its own side',
			TEAMS,
			'a1',
			ready('a1'),
			['b1', 'b2'],
		],
		[
			'Teams: an unready teammate is not timed',
			TEAMS,
			'a1',
			ready('a1', 'b1', 'b2'),
			'nobody_to_time',
		],
	])('%s', (_name, setup, by, readyIds, expected) => {
		const state = begin(setup)
		const timing = wouldTime(
			'ante',
			by,
			state,
			worldFor(state, setup, readyIds),
		)
		if (typeof expected === 'string')
			expect(timing).toEqual({ ok: false, reason: expected })
		else expect(timing).toEqual({ ok: true, against: expected })
	})

	it('a player out of the run is not timed', () => {
		const state = withLives(begin(DUEL), 'b', 0)
		const world = worldFor(state, DUEL, ['a'])
		expect(wouldTime('ante', 'a', state, world)).toEqual({
			ok: false,
			reason: 'nobody_to_time',
		})
	})

	it('a side that is not set never matches (two players with no team are both timed)', () => {
		const state = begin(ROYALE)
		expect(state.teams.teams).toEqual({})
		expect(
			wouldTime('ante', 'a', state, worldFor(state, ROYALE, ['a'])),
		).toEqual({ ok: true, against: ['b', 'c'] })
	})
})

describe("wouldTime: the PvP timer times exactly the starter's target", () => {
	it.each<
		[
			string,
			Setup,
			string,
			{ [id: string]: [string, number] },
			string | string[],
		]
	>([
		['ahead of the target', DUEL, 'a', { a: ['10', 2], b: ['3', 2] }, ['b']],
		[
			'behind the target',
			DUEL,
			'a',
			{ a: ['3', 2], b: ['10', 2] },
			'not_ahead',
		],
		[
			'a tie, and the starter Readied first',
			DUEL,
			'a',
			{ a: ['5', 2], b: ['5', 2] },
			['b'],
		],
		[
			'a tie, and the target Readied first',
			DUEL,
			'b',
			{ a: ['5', 2], b: ['5', 2] },
			'not_ahead',
		],
		[
			'the target has no hands left',
			DUEL,
			'a',
			{ a: ['10', 2], b: ['3', 0] },
			'not_ahead',
		],
		[
			'Talisman scores compare by value',
			DUEL,
			'a',
			{ a: [fromGameValue(1e20), 1], b: [fromGameValue(9e19), 1] },
			['b'],
		],
		[
			'Royale: the target is the next player up the ranking',
			ROYALE,
			'a',
			{ a: ['5', 1], b: ['3', 1], c: ['9', 1] },
			['b'],
		],
	])('%s', (_name, setup, by, scores, expected) => {
		const state = scored(begin(setup), scores)
		const timing = wouldTime('pvp', by, state, worldFor(state, setup, []))
		if (typeof expected === 'string')
			expect(timing).toEqual({ ok: false, reason: expected })
		else expect(timing).toEqual({ ok: true, against: expected })
	})

	it('a player who has not played a hand cannot start the timer, even on a 0-0 tie they Readied first', () => {
		const state = begin(DUEL)
		const world = { ...worldFor(state, DUEL, []), firstPlayer: 'a' }
		expect(state.facts.handRound.a).toBeUndefined()
		expect(wouldTime('pvp', 'a', state, world)).toEqual({
			ok: false,
			reason: 'not_ahead',
		})
	})

	it('once they have played a hand and are ahead, the start is ok', () => {
		const state = scored(begin(DUEL), { a: ['10', 2], b: ['3', 2] })
		expect(wouldTime('pvp', 'a', state, worldFor(state, DUEL, []))).toEqual({
			ok: true,
			against: ['b'],
		})
	})

	it('Teams has no per-player opponent: no_opponent', () => {
		const state = begin(TEAMS)
		expect(wouldTime('pvp', 'a1', state, worldFor(state, TEAMS, []))).toEqual({
			ok: false,
			reason: 'no_opponent',
		})
	})

	it('Manhunt: a Hunter times the Runner, the Runner times the top Hunter', () => {
		const state = scored(begin(MANHUNT), {
			r: ['9', 2],
			h1: ['3', 2],
			h2: ['5', 2],
		})
		const world = worldFor(state, MANHUNT, [])
		expect(wouldTime('pvp', 'r', state, world)).toEqual({
			ok: true,
			against: ['h2'],
		})
		expect(wouldTime('pvp', 'h1', state, world)).toEqual({
			ok: false,
			reason: 'not_ahead',
		})
	})
})

describe('holderAfter: first press wins', () => {
	const start = (playerId: string): PvpFact => ({
		type: 'timer_start',
		playerId,
		kind: 'ante',
	})
	const pause = (playerId: string): PvpFact => ({
		type: 'timer_pause',
		playerId,
	})
	const running: Deadline = {
		kind: 'ante',
		by: 'a',
		against: ['b'],
		endsAt: null,
		shownMs: null,
		n: 1,
	}

	it.each<[string, Deadline | null, PvpFact[], string | null]>([
		['nothing running, nothing asked', null, [], null],
		['one start', null, [start('a')], 'a'],
		['two starts: the first holds it', null, [start('a'), start('b')], 'a'],
		['a start while one runs changes nothing', running, [start('b')], 'a'],
		['only the holder pauses', running, [pause('b')], 'a'],
		['the holder pauses', running, [pause('a')], null],
		['pause then the other starts', running, [pause('a'), start('b')], 'b'],
		['start then pause in one batch', null, [start('a'), pause('a')], null],
	])('%s', (_name, deadline, unapplied, holder) => {
		expect(holderAfter(deadline, unapplied)).toBe(holder)
	})

	it('property: with no pause, the holder is whoever pressed first', () => {
		fc.assert(
			fc.property(
				fc.array(fc.constantFrom('a', 'b', 'c'), {
					minLength: 1,
					maxLength: 8,
				}),
				(presses) => {
					expect(holderAfter(null, presses.map(start))).toBe(presses[0])
				},
			),
		)
	})
})

describe('projectDeadline: a STATE is frozen, a snapshot is live', () => {
	const counted = (endsAt: number, shownMs: number): Deadline => ({
		kind: 'ante',
		by: 'a',
		against: ['b', 'c'],
		endsAt,
		shownMs,
		n: 3,
	})

	it('null and undefined project to null', () => {
		expect(projectDeadline(null, null)).toBeNull()
		expect(projectDeadline(undefined, 5)).toBeNull()
	})

	it('an own-clock deadline has remainingMs null in both', () => {
		const own: Deadline = { ...counted(0, 0), endsAt: null, shownMs: null }
		expect(projectDeadline(own, null)).toMatchObject({ remainingMs: null })
		expect(projectDeadline(own, 99)).toMatchObject({ remainingMs: null })
	})

	it('property: a STATE shows shownMs whatever the clock says', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 1e9 }),
				fc.integer({ min: 10_000, max: 3_600_000 }),
				(endsAt, shownMs) => {
					expect(projectDeadline(counted(endsAt, shownMs), null)).toMatchObject(
						{
							remainingMs: shownMs,
						},
					)
				},
			),
		)
	})

	it('property: a snapshot shows endsAt - now, never below 0', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 1e9 }),
				fc.integer({ min: 0, max: 2e9 }),
				(endsAt, now) => {
					const shown = projectDeadline(counted(endsAt, 10_000), now) as {
						remainingMs: number
					}
					expect(shown.remainingMs).toBe(Math.max(0, endsAt - now))
				},
			),
		)
	})

	it('withLiveDeadline touches only a server-counted deadline of a pvp.round', () => {
		const match = {
			'pvp.round': { phase: 'playing', deadline: null },
			other: 1,
		}
		expect(withLiveDeadline(match, null, 5)).toBe(match)
		const own: Deadline = { ...counted(0, 0), endsAt: null, shownMs: null }
		expect(withLiveDeadline(match, own, 5)).toBe(match)
		const live = withLiveDeadline(match, counted(40_000, 30_000), 15_000)
		expect(live['pvp.round']).toMatchObject({
			phase: 'playing',
			deadline: { remainingMs: 25_000, n: 3 },
		})
		expect(live.other).toBe(1)
		expect(withLiveDeadline({ other: 1 }, counted(40_000, 30_000), 5)).toEqual({
			other: 1,
		})
	})
})

describe('expired and restarted', () => {
	const run: Deadline = {
		kind: 'ante',
		by: 'a',
		against: ['b', 'c'],
		endsAt: 10_000,
		shownMs: 10_000,
		n: 1,
	}
	it.each([
		[9_999, false],
		[10_000, true],
		[10_001, true],
	])('a server deadline at now %s expired = %s', (now, answer) => {
		expect(expired(run, now)).toBe(answer)
	})

	it('a deadline the client counts never expires here', () => {
		expect(expired({ ...run, endsAt: null, shownMs: null }, 1e12)).toBe(false)
	})

	it('a restart counts from now, against the sorted survivors, with the next n', () => {
		expect(restarted(run, ['c', 'b'], 500_000, BASE_MS, 2)).toEqual({
			...run,
			against: ['b', 'c'],
			endsAt: 650_000,
			shownMs: BASE_MS,
			n: 2,
		})
	})
})

describe('pausedFor: a server-counted deadline waits for a timed player who is away', () => {
	const running: Deadline = {
		kind: 'ante',
		by: 'a',
		against: ['b', 'c'],
		endsAt: 40_000,
		shownMs: 30_000,
		n: 3,
	}
	const paused: Deadline = { ...running, pausedMs: 25_000 }

	it.each<[string, Deadline, string[], number, Deadline]>([
		['nobody away: unchanged', running, [], 15_000, running],
		['the starter away: unchanged', running, ['a'], 15_000, running],
		['someone untimed away: unchanged', running, ['z'], 15_000, running],
		[
			'a timed player away: pauses with the time left',
			running,
			['c'],
			15_000,
			paused,
		],
		['already paused and still away: unchanged', paused, ['b'], 99_000, paused],
		[
			'nobody away any more: goes on from the stored time left',
			paused,
			[],
			60_000,
			{ ...running, endsAt: 85_000, shownMs: 25_000 },
		],
		[
			'past its end when the player goes away: paused at 0',
			running,
			['b'],
			50_000,
			{ ...running, pausedMs: 0 },
		],
	])('%s', (_name, deadline, away, now, expected) => {
		expect(pausedFor(deadline, away, now)).toEqual(expected)
	})

	it('a deadline the client counts is never paused', () => {
		const own: Deadline = { ...running, endsAt: null, shownMs: null }
		expect(pausedFor(own, ['b'], 15_000)).toBe(own)
	})

	it('a paused deadline never expires', () => {
		expect(expired(paused, 1e12)).toBe(false)
	})

	it('property: pausing then going on later keeps the time left', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 0, max: 1e6 }),
				fc.integer({ min: 0, max: 1e6 }),
				fc.integer({ min: 0, max: 1e6 }),
				(left, pausedAt, gap) => {
					const live = { ...running, endsAt: pausedAt + left }
					const held = pausedFor(live, ['b'], pausedAt)
					const back = pausedFor(held, [], pausedAt + gap)
					expect(back.endsAt).toBe(pausedAt + gap + left)
					expect(back.pausedMs).toBeUndefined()
				},
			),
		)
	})

	it('the wire shows the frozen time left and paused: true, in a STATE and a snapshot', () => {
		const wire = {
			kind: 'ante',
			by: 'a',
			against: ['b', 'c'],
			remainingMs: 25_000,
			n: 3,
			paused: true,
		}
		expect(projectDeadline(paused, null)).toEqual(wire)
		expect(projectDeadline(paused, 1e9)).toEqual(wire)
		expect(projectDeadline(running, null)).not.toHaveProperty('paused')
	})
})

// ------------------------------------------------------------ the request reducers

describe('pvp.timer_start / pvp.timer_pause refusals', () => {
	const duel = (): RefereeState => begin(DUEL)
	const ahead = (): RefereeState =>
		scored(duel(), { a: ['10', 2], b: ['3', 2] })

	it.each<[string, () => FactResult, string]>([
		[
			'no kind',
			() => startTimer(duel(), DUEL, 'a', {} as StartArgs, ['a']),
			'bad_payload',
		],
		[
			'an unknown kind',
			() =>
				startTimer(
					duel(),
					DUEL,
					'a',
					{ kind: 'hand' } as unknown as StartArgs,
					['a'],
				),
			'bad_payload',
		],
		[
			'an Ante start that names a clock (the server counts, never the client)',
			() =>
				reduceTimerStart(
					duel(),
					'a',
					{ runId: 'r1', kind: 'ante', clock: 'own' },
					worldFor(duel(), DUEL, ['a']),
				),
			'bad_payload',
		],
		[
			'an Ante start that names a time (the server counts, never the client)',
			() =>
				reduceTimerStart(
					duel(),
					'a',
					{ runId: 'r1', kind: 'ante', ms: 5000 },
					worldFor(duel(), DUEL, ['a']),
				),
			'bad_payload',
		],
		[
			'a pvp start in a ruleset with no hand timer',
			() =>
				startTimer(
					scored(begin(TRADITIONAL), { a: ['10', 2], b: ['3', 2] }),
					TRADITIONAL,
					'a',
					{ kind: 'pvp', roundId: 1 },
					[],
				),
			'no_timer',
		],
		[
			'an Ante start in a ruleset with no Ante clock',
			() => startTimer(begin(TRADITIONAL), TRADITIONAL, 'a', { kind: 'ante' }, ['a']),
			'no_timer',
		],
		[
			'a pvp start with no roundId',
			() => startTimer(ahead(), DUEL, 'a', { kind: 'pvp' }, []),
			'bad_payload',
		],
		[
			'the wrong run',
			() =>
				reduceTimerStart(
					duel(),
					'a',
					{ runId: 'other', kind: 'ante' },
					worldFor(duel(), DUEL, ['a']),
				),
			'round_over',
		],
		[
			'an Ante start from a player that is not Ready',
			() => startTimer(duel(), DUEL, 'a', { kind: 'ante' }, []),
			'not_ready',
		],
		[
			'an Ante start with everyone Ready',
			() => startTimer(duel(), DUEL, 'a', { kind: 'ante' }, ['a', 'b']),
			'nobody_to_time',
		],
		[
			'a pvp start for another round',
			() => startTimer(ahead(), DUEL, 'a', { kind: 'pvp', roundId: 9 }, []),
			'round_over',
		],
		[
			'a pvp start between rounds',
			() =>
				startTimer(
					{ ...ahead(), round: { ...ahead().round, phase: 'shop' } },
					DUEL,
					'a',
					{ kind: 'pvp', roundId: 1 },
					[],
				),
			'not_playing',
		],
		[
			'a pvp start while behind',
			() =>
				startTimer(
					scored(duel(), { a: ['1', 2], b: ['3', 2] }),
					DUEL,
					'a',
					{ kind: 'pvp', roundId: 1 },
					[],
				),
			'not_ahead',
		],
		[
			'a pvp start in Teams',
			() =>
				startTimer(begin(TEAMS), TEAMS, 'a1', { kind: 'pvp', roundId: 1 }, []),
			'no_opponent',
		],
		[
			'a pause from a player that does not hold the timer',
			() =>
				reduceTimerPause(
					{ ...duel(), facts: { ...emptyFacts(), deadline: heldBy('a') } },
					'b',
					{ runId: 'r1' },
				),
			'not_starter',
		],
		[
			'a pause with no run',
			() => reduceTimerPause(duel(), 'a', {}),
			'bad_payload',
		],
	])('%s: %s', (_name, run, reason) => {
		expect(run()).toEqual({ ok: false, reason })
	})

	function heldBy(by: string): Deadline {
		return {
			kind: 'ante',
			by,
			against: ['b'],
			endsAt: null,
			shownMs: null,
			n: 1,
		}
	}

	it('an eliminated sender is refused', () => {
		const dead = withLives(duel(), 'a', 0)
		const r = startTimer(
			{
				...dead,
				lives: {
					...dead.lives,
					players: {
						...dead.lives.players,
						a: { ...dead.lives.players.a, eliminated: true },
					},
				},
			},
			DUEL,
			'a',
			{ kind: 'ante' },
			['a'],
		)
		expect(r).toEqual({ ok: false, reason: 'eliminated' })
	})


	it('records the start of each kind', () => {
		const ante = must(startTimer(duel(), DUEL, 'a', { kind: 'ante' }, ['a']))
		const pvp = must(
			startTimer(ahead(), DUEL, 'a', { kind: 'pvp', roundId: 1 }, []),
		)
		const starts = (s: RefereeState) =>
			s.facts.log.filter((f) => f.type === 'timer_start')
		expect(starts(ante)).toMatchObject([
			{ type: 'timer_start', playerId: 'a', kind: 'ante' },
		])
		expect(starts(pvp)).toMatchObject([{ kind: 'pvp', playerId: 'a' }])
	})

	it('a second start while one is recorded changes nothing (first press wins)', () => {
		const first = must(
			startTimer(duel(), DUEL, 'a', { kind: 'ante' }, ['a']),
		)
		const again = startTimer(first, DUEL, 'a', { kind: 'ante' }, [
			'a',
		])
		expect(again).toEqual({ ok: true, state: first, changed: [] })
	})

	it('a pause with nothing running changes nothing', () => {
		const s = duel()
		expect(reduceTimerPause(s, 'a', { runId: 'r1' })).toEqual({
			ok: true,
			state: s,
			changed: [],
		})
	})
})

// ----------------------------------------------------------------- the tick rows

describe('the deadline opens, runs and drops in the tick', () => {
	const open = (now = 0): RefereeState =>
		anteOn(begin(DUEL), DUEL, 'a', 30_000, now, ['a'])

	it('opens from a start fact, with the bank counted by the server', () => {
		expect(deadlineOf(open(1_000))).toEqual({
			kind: 'ante',
			by: 'a',
			against: ['b'],
			endsAt: 31_000,
			shownMs: 30_000,
			n: 1,
		})
	})

	it("an Ante start with no bank is the timed client's clock: no end time", () => {
		const s = anteOn(begin(PERSONAL), PERSONAL, 'a', undefined, 1_000, ['a'])
		expect(deadlineOf(s)).toMatchObject({ endsAt: null, shownMs: null, n: 1 })
		// the server never expires it
		expect(deadlineOf(tick(s, PERSONAL, 1e12, ['a']))).toEqual(deadlineOf(s))
		expect(livesOf(tick(s, PERSONAL, 1e12, ['a']), 'b')).toBe(livesOf(s, 'b'))
	})

	it('a start fact the rule refuses at tick time opens nothing', () => {
		const started = must(
			startTimer(begin(DUEL), DUEL, 'a', { kind: 'ante' }, ['a']),
		)
		// the opponent Readied between the request and the tick
		expect(deadlineOf(tick(started, DUEL, 0, ['a', 'b']))).toBeNull()
	})

	it('a pause drops it', () => {
		const paused = must(reduceTimerPause(open(), 'a', { runId: 'r1' }))
		expect(deadlineOf(tick(paused, DUEL, 5_000, ['a']))).toBeNull()
	})

	it("a pause and another player's start in one batch: the pause drops, the start then holds it", () => {
		const base = open()
		const paused = must(reduceTimerPause(base, 'a', { runId: 'r1' }))
		const again = must(
			startTimer(withBank(paused, 'b', 30_000), DUEL, 'b', { kind: 'ante' }, [
				'b',
			]),
		)
		expect(deadlineOf(tick(again, DUEL, 5_000, ['b']))).toEqual({
			kind: 'ante',
			by: 'b',
			against: ['a'],
			endsAt: 35_000,
			shownMs: 30_000,
			n: 2,
		})
	})

	it.each<[string, (s: RefereeState) => RefereeState, string[], string[]]>([
		[
			'the starter left',
			(s) => ({
				...s,
				lives: {
					...s.lives,
					players: {
						...s.lives.players,
						a: { ...s.lives.players.a, left: true },
					},
				},
			}),
			['a'],
			[],
		],
		[
			'the starter forfeited',
			(s) => ({
				...s,
				lives: {
					...s.lives,
					players: {
						...s.lives.players,
						a: { ...s.lives.players.a, forfeited: true },
					},
				},
			}),
			['a'],
			[],
		],
		['the starter is out of lives', (s) => withLives(s, 'a', 0), ['a'], []],
		['the starter is no longer Ready', (s) => s, [], []],
		[
			'the only timed player is out of the run',
			(s) => withLives(s, 'b', 0),
			['a'],
			[],
		],
		['the timed player Readied', (s) => s, ['a', 'b'], []],
	])('drops when %s', (_name, change, readyIds) => {
		const next = tick(change(open()), DUEL, 5_000, readyIds)
		expect(deadlineOf(next)).toBeNull()
	})

	it('a PvP deadline drops when its round is no longer taking hands', () => {
		let s = scored(begin(DUEL), { a: ['10', 2], b: ['3', 2] })
		s = must(startTimer(s, DUEL, 'a', { kind: 'pvp', roundId: 1 }, []))
		s = tick(s, DUEL, 1_000)
		expect(deadlineOf(s)).toMatchObject({
			kind: 'pvp',
			by: 'a',
			against: ['b'],
		})
		const closed = { ...s, round: { ...s.round, phase: 'resolved' as const } }
		expect(deadlineOf(tick(closed, DUEL, 2_000))).toBeNull()
	})

	it('a PvP deadline follows the scores: it ends once the target is no longer behind', () => {
		let s = scored(begin(DUEL), { a: ['10', 2], b: ['3', 2] })
		s = tick(
			must(startTimer(s, DUEL, 'a', { kind: 'pvp', roundId: 1 }, [])),
			DUEL,
			1,
		)
		expect(deadlineOf(s)).not.toBeNull()
		s = tick(scored(s, { b: ['30', 2] }), DUEL, 2)
		expect(deadlineOf(s)).toBeNull()
	})

	it('who is timed is read again every tick (a timed player that Readies leaves it)', () => {
		const s = anteOn(begin(ROYALE), ROYALE, 'a', 30_000, 0, ['a'])
		expect(deadlineOf(s)?.against).toEqual(['b', 'c'])
		const next = tick(s, ROYALE, 1_000, ['a', 'b'])
		expect(deadlineOf(next)?.against).toEqual(['c'])
	})
})

describe('dropReason: one row per drop rule', () => {
	const live: Deadline = {
		kind: 'ante',
		by: 'a',
		against: ['b'],
		endsAt: null,
		shownMs: null,
		n: 1,
	}
	// The round start the carried deadlines were marked at (begin's own).
	const CARRIED = begin(DUEL).lastStart?.roundId ?? 0
	// A round start since the restart: Ready is cleared and the start id moved on.
	const startedSince = (s: RefereeState): RefereeState => ({
		...s,
		lastStart: { roundId: CARRIED + 1, firstPlayer: 'a', players: ['a', 'b'], blindKeys: { a: '2:Boss', b: '2:Boss' } },
	})
	const decided = (s: RefereeState): RefereeState => ({
		...s,
		result: { ...s.result, runId: 'r1', kind: 'win', winnerId: 'a' },
	})
	it.each<[string, (s: RefereeState) => RefereeState, string[], string | null]>(
		[
			['nothing wrong', (s) => s, ['a'], null],
			['the game is decided', decided, ['a'], 'decided'],
			[
				'the starter is out of lives',
				(s) => withLives(s, 'a', 0),
				['a'],
				'starter_out',
			],
			[
				'the starter has no seat',
				(s) => ({ ...s, lives: { ...s.lives, players: {} } }),
				['a'],
				'starter_out',
			],
			['an Ante starter is not Ready', (s) => s, [], 'unready'],
			[
				'a PvP deadline whose round is resolved',
				(s) => ({ ...s, round: { ...s.round, phase: 'resolved' as const } }),
				[],
				'round_closed',
			],
		],
	)('%s', (name, change, readyIds, reason) => {
		const state = change(begin(DUEL))
		const world = worldFor(state, DUEL, readyIds)
		const deadline: Deadline = name.startsWith('a PvP')
			? { ...live, kind: 'pvp' }
			: live
		expect(dropReason(deadline, state, world)).toBe(reason)
	})

	describe('the restart mark', () => {
		const marked: Deadline = { ...live, endsAt: 90_000, shownMs: 30_000, resumed: CARRIED }
		const ids = (readyIds: string[]) => ({ readyIds, requiredIds: ['a', 'b'], awayIds: [] as string[] })
		const run = (readyIds: string[], deadline: Deadline) => {
			const state = begin(DUEL)
			const mode = pickMode(state.rules.mode ?? 'royale', state.rules.startedCount)
			const withDeadline = { ...state, facts: { ...state.facts, deadline } }
			return deadlineStep(withDeadline, mode, ids(readyIds), [], 80_000).facts.deadline
		}
		it('stays while the starter is not Ready again', () => {
			expect(run([], marked)).toMatchObject({ resumed: CARRIED })
		})
		it('goes once the starter is Ready again, and then a starter who unreadies ends the timer', () => {
			const cleared = run(['a'], marked)
			expect(cleared).not.toBeNull()
			expect(cleared).not.toHaveProperty('resumed')
			expect(run([], cleared as Deadline)).toBeNull()
		})
	})

	describe('the restart mark and the starter being away', () => {
		const marked: Deadline = { ...live, endsAt: 90_000, shownMs: 30_000, resumed: CARRIED }
		it('a marked deadline stands still while its starter is away, and goes on when they are back', () => {
			const held = pausedFor(marked, ['a'], 80_000)
			expect(held).toMatchObject({ pausedMs: 10_000 })
			const back = pausedFor(held, [], 85_000)
			expect(back).toMatchObject({ endsAt: 95_000, shownMs: 10_000 })
			expect(back).not.toHaveProperty('pausedMs')
		})
		it('an ordinary deadline does not wait for its starter (their disconnect drops it as unready)', () => {
			expect(pausedFor({ ...live, endsAt: 90_000, shownMs: 30_000 }, ['a'], 80_000)).not.toHaveProperty('pausedMs')
		})
		it('a run-out restart ends the mark: the next deadline is an ordinary one', () => {
			const next = restarted(marked, ['b'], 91_000, 120_000, 2)
			expect(next).not.toHaveProperty('resumed')
			expect(next).toMatchObject({ endsAt: 211_000, against: ['b'], n: 2 })
		})
	})

	// A server restart voids every Ready; the starter did not unready, so the timer
	// the checkpoint carried stays until the starter is Ready again.
	it.each<[string, (s: RefereeState) => RefereeState, string[], string | null]>([
		['restored and the starter not Ready yet', (s) => s, [], null],
		['restored and the starter Ready again', (s) => s, ['a'], null],
		['restored, but a round started since (Ready cleared)', startedSince, [], 'unready'],
		['restored, but the starter is out of lives', (s) => withLives(s, 'a', 0), [], 'starter_out'],
		['restored, but the game is decided', decided, [], 'decided'],
	])('an Ante deadline carried over a restart: %s', (_name, change, readyIds, reason) => {
		const state = change(begin(DUEL))
		expect(dropReason({ ...live, resumed: CARRIED }, state, worldFor(state, DUEL, readyIds))).toBe(reason)
	})

	it('a decided game is frozen (C1): the tick touches nothing, the deadline included', () => {
		const s = decided(open())
		const next = tick(s, DUEL, 99_999_999, ['a'])
		expect(next).toEqual(s)
	})

	function open(): RefereeState {
		return anteOn(begin(DUEL), DUEL, 'a', 30_000, 0, ['a'])
	}
})

describe('the run-out: one per n, from the base, once after a clock jump', () => {
	const open = (): RefereeState =>
		anteOn(begin(DUEL), DUEL, 'a', 30_000, 0, ['a'])

	it('before the end nothing happens', () => {
		const s = open()
		expect(tick(s, DUEL, 29_999, ['a'])).toEqual(s)
	})

	it('at the end the timed player loses a life with no blind, and the deadline restarts from the base', () => {
		const s = tick(open(), DUEL, 30_000, ['a'])
		expect(livesOf(s, 'b')).toBe(3)
		expect(livesOf(s, 'a')).toBe(4)
		expect(deadlineOf(s)).toEqual({
			kind: 'ante',
			by: 'a',
			against: ['b'],
			endsAt: 30_000 + BASE_MS,
			shownMs: BASE_MS,
			n: 2,
		})
		expect(Object.keys(s.facts.blinds)).toEqual([])
	})

	it('two expiries cost two lives, each with its own deadline n and no blind', () => {
		let s = tick(open(), DUEL, 30_000, ['a'])
		expect(livesOf(s, 'b')).toBe(3)
		expect(deadlineOf(s)?.n).toBe(2)
		s = tick(s, DUEL, 30_000 + BASE_MS, ['a'])
		expect(livesOf(s, 'b')).toBe(2)
		expect(deadlineOf(s)?.n).toBe(3)
		expect(Object.keys(s.facts.blinds)).toEqual([])
	})

	it('a server run-out and a failed round on the same blind cost two lives (the run-out, then the guarded loss)', () => {
		let s = tick(open(), DUEL, 30_000, ['a'])
		const key = `${s.round.players.b.ante}:Small`
		s = must(
			FACT_REDUCERS['pvp.blind'](s, 'b', {
				runId: 'r1',
				blindKey: key,
				beaten: false,
				roundLost: true,
			}),
		)
		s = tick(s, DUEL, 30_001, ['a'])
		expect(livesOf(s, 'b')).toBe(2)
	})

	it('the game decided in the same tick leaves no deadline (a draw vote passes after the timer step)', () => {
		const s = open()
		const voted: RefereeState = {
			...s,
			votes: { runId: 'r1', draw: ['a', 'b'], seed: [] },
		}
		const next = tick(voted, DUEL, 5_000, ['a'])
		expect(next.result.kind).toBe('draw')
		expect(deadlineOf(next)).toBeNull()
	})

	it('100 start and pause toggles leave the log bounded', () => {
		let s = begin(DUEL)
		for (let i = 0; i < 100; i++) {
			s = tick(
				must(startTimer(s, DUEL, 'a', { kind: 'ante' }, ['a'])),
				DUEL,
				i,
				['a'],
			)
			s = tick(must(reduceTimerPause(s, 'a', { runId: 'r1' })), DUEL, i, ['a'])
			// The state is stored as JSON: a plain copy each turn keeps the test
			// harness's wrappers from stacking up.
			s = JSON.parse(JSON.stringify(s)) as RefereeState
		}
		expect(s.facts.log.length).toBeLessThan(10)
		expect(s.facts.applied).toBe(s.facts.log.length)
		expect(deadlineOf(s)).toBeNull()
	})

	it('the same tick again costs nothing more', () => {
		const once = tick(open(), DUEL, 30_000, ['a'])
		expect(tick(once, DUEL, 30_000, ['a'])).toEqual(once)
	})

	it('the second period costs the second life', () => {
		let s = tick(open(), DUEL, 30_000, ['a'])
		s = tick(s, DUEL, 30_000 + BASE_MS - 1, ['a'])
		expect(livesOf(s, 'b')).toBe(3)
		s = tick(s, DUEL, 30_000 + BASE_MS, ['a'])
		expect(livesOf(s, 'b')).toBe(2)
		expect(deadlineOf(s)?.n).toBe(3)
	})

	it('property: after any clock jump exactly one run-out is charged and n moves by one', () => {
		const base = open()
		fc.assert(
			fc.property(fc.integer({ min: 0, max: 10_000_000_000 }), (jump) => {
				const s = tick(base, DUEL, 30_000 + jump, ['a'])
				expect(livesOf(s, 'b')).toBe(3)
				expect(deadlineOf(s)?.n).toBe(2)
				expect(deadlineOf(s)?.endsAt).toBe(30_000 + jump + BASE_MS)
				expect(tick(s, DUEL, 30_000 + jump, ['a'])).toEqual(s)
			}),
		)
	})

	it('the last life ends the game and the deadline is gone', () => {
		const s = tick(atBoss(withLives(open(), 'b', 1), 'b'), DUEL, 30_000, ['a'])
		expect(livesOf(s, 'b')).toBe(0)
		expect(s.result).toMatchObject({ kind: 'win', winnerId: 'a' })
		expect(deadlineOf(s)).toBeNull()
	})

	it('n is never reused: a drop then a new start numbers on from the last', () => {
		let s = tick(open(), DUEL, 30_000, ['a'])
		expect(deadlineOf(s)?.n).toBe(2)
		s = tick(must(reduceTimerPause(s, 'a', { runId: 'r1' })), DUEL, 31_000, [
			'a',
		])
		expect(deadlineOf(s)).toBeNull()
		s = anteOn(s, DUEL, 'a', 30_000, 32_000, ['a'])
		expect(deadlineOf(s)?.n).toBe(3)
	})
})

describe('the Ante timer waits for a disconnected timed player (section 8)', () => {
	// `a` is Ready and started 30 s at t = 0; `b` is the one timed.
	const open = (setup: Setup = DUEL, ready = ['a']): RefereeState =>
		anteOn(begin(setup), setup, 'a', 30_000, 0, ready)
	const away = (
		s: RefereeState,
		now: number,
		who: string[],
		setup: Setup = DUEL,
		ready = ['a'],
	): RefereeState => tick(s, setup, now, ready, [], who)

	it('away with 30 s left, 60 s pass: no run-out, 30 s still left and paused', () => {
		let s = away(open(), 0, ['b'])
		s = away(s, 60_000, ['b'])
		expect(livesOf(s, 'b')).toBe(4)
		expect(projectDeadline(deadlineOf(s), null)).toMatchObject({
			remainingMs: 30_000,
			paused: true,
		})
	})

	it('back after 60 s: 29 s later no run-out, 2 s more and the run-out costs one life', () => {
		let s = away(away(open(), 0, ['b']), 60_000, ['b'])
		s = away(s, 60_000, [])
		expect(deadlineOf(s)).toMatchObject({ endsAt: 90_000, shownMs: 30_000 })
		expect(deadlineOf(s)).not.toHaveProperty('pausedMs')
		s = away(s, 89_000, [])
		expect(livesOf(s, 'b')).toBe(4)
		s = away(s, 91_000, [])
		expect(livesOf(s, 'b')).toBe(3)
	})

	it('two timed players, one away: the one clock waits for both', () => {
		const ready = ['a']
		let s = away(open(ROYALE, ready), 0, ['b'], ROYALE, ready)
		expect(deadlineOf(s)?.against).toEqual(['b', 'c'])
		s = away(s, 90_000, ['b'], ROYALE, ready)
		expect(livesOf(s, 'b')).toBe(4)
		expect(livesOf(s, 'c')).toBe(4)
	})

	it('a timed player whose grace ran out is forfeited as before: the deadline is dropped', () => {
		const s = tick(away(open(), 0, ['b']), DUEL, 5_000, ['a'], ['b'], [])
		expect(deadlineOf(s)).toBeNull()
		expect(livesOf(s, 'b')).toBe(4)
	})

	it('a deadline the client counts is not paused', () => {
		const own = anteOn(begin(PERSONAL), PERSONAL, 'a', undefined, 0, ['a'])
		expect(deadlineOf(away(own, 10, ['b'], PERSONAL))).toEqual(deadlineOf(own))
	})
})

describe('a timed player animating stops the server-counted timers (section 8)', () => {
	const animate = (s: RefereeState, id: string, animating: boolean): RefereeState =>
		must(reduceAnimating(s, id, { runId: 'r1', animating }))
	// `a` is Ready and started 30 s at t = 0; `b` is the one timed.
	const open = (
		over: (s: RefereeState) => RefereeState = (s) => s,
		setup: Setup = DUEL,
	): RefereeState => anteOn(over(begin(setup)), setup, 'a', 30_000, 0, ['a'])
	const at = (s: RefereeState, now: number): RefereeState =>
		tick(s, DUEL, now, ['a'])

	it('plain Ante: b animating does not pause it, the run-out comes on time', () => {
		let s = at(animate(open(), 'b', true), 0)
		s = at(s, 31_000)
		expect(livesOf(s, 'b')).toBe(3)
	})

	describe('the PvP hand timer', () => {
		const played = (): RefereeState =>
			tick(
				scored(begin(DUEL), { a: ['10', 3], b: ['3', 3] }),
				DUEL,
				0,
			)
		const running = (): RefereeState =>
			tick(
				must(startTimer(played(), DUEL, 'a', { kind: 'pvp', roundId: 1 }, [])),
				DUEL,
				1_000,
			)

		it('its target animating pauses it with the time left, then it resumes', () => {
			let s = tick(animate(running(), 'b', true), DUEL, 1_000)
			s = tick(s, DUEL, 500_000)
			expect(deadlineOf(s)).toMatchObject({ kind: 'pvp', pausedMs: 60_000 })
			expect(s.round.players.b.timerLosses).toBe(0)
			s = tick(animate(s, 'b', false), DUEL, 500_000)
			expect(deadlineOf(s)).toMatchObject({ endsAt: 560_000, shownMs: 60_000 })
		})

		it('a hand credit while it is paused adds to the time left, and it resumes with that', () => {
			let s = tick(animate(running(), 'b', true), DUEL, 1_000)
			s = tick(s, DUEL, 500_000)
			s = must(
				FACT_REDUCERS['pvp.hand'](s, 'b', {
					runId: 'r1',
					roundId: 1,
					score: '4',
					handsLeft: 3,
					timerLossesApplied: 0,
				}),
			)
			s = tick(s, DUEL, 500_000)
			expect(deadlineOf(s)).toMatchObject({ pausedMs: 70_000, shownMs: 70_000 })
			s = tick(animate(s, 'b', false), DUEL, 600_000)
			expect(deadlineOf(s)).toMatchObject({ endsAt: 670_000, shownMs: 70_000 })
		})

		// The target both away and animating: either reason alone keeps the clock stopped.
		// The target animating, then away too: the tick drops an away player's animating
		// entry, so the pause is held by the away reason alone and ends when they are back.
		it('animating and then away: it stays paused with the same time left until they are back', () => {
			let s = tick(animate(running(), 'b', true), DUEL, 1_000)
			expect(deadlineOf(s)).toMatchObject({ kind: 'pvp', pausedMs: 60_000 })
			s = tick(s, DUEL, 500_000, [], [], ['b'])
			expect(s.facts.animating).toEqual([])
			expect(deadlineOf(s)).toMatchObject({ kind: 'pvp', pausedMs: 60_000 })
			s = tick(s, DUEL, 600_000, [], [], ['b'])
			expect(deadlineOf(s)).toMatchObject({ kind: 'pvp', pausedMs: 60_000 })
			s = tick(s, DUEL, 700_000)
			expect(deadlineOf(s)).toMatchObject({ endsAt: 760_000, shownMs: 60_000 })
		})

		it('the starter animating does not pause it', () => {
			const s = tick(animate(running(), 'a', true), DUEL, 80_000)
			expect(deadlineOf(s)).toBeNull()
			expect(s.round.players.b.timerLosses).toBe(1)
		})
	})

	describe('the animating set', () => {
		it('a repeat of the same value changes nothing', () => {
			const s = begin(DUEL)
			const on = animate(s, 'b', true)
			expect(on.facts.animating).toEqual(['b'])
			const again = reduceAnimating(on, 'b', { runId: 'r1', animating: true })
			expect(again).toEqual({ ok: true, state: on, changed: [] })
			const off = reduceAnimating(s, 'b', { runId: 'r1', animating: false })
			expect(off).toEqual({ ok: true, state: s, changed: [] })
		})

		it('keeps the set sorted and drops a player on false', () => {
			let s = animate(animate(begin(DUEL), 'b', true), 'a', true)
			expect(s.facts.animating).toEqual(['a', 'b'])
			s = animate(s, 'a', false)
			expect(s.facts.animating).toEqual(['b'])
		})

		it.each<[string, unknown, string]>([
			['a string', 'true', 'bad_payload'],
			['a number', 1, 'bad_payload'],
			['null', null, 'bad_payload'],
			['missing', undefined, 'bad_payload'],
		])('animating as %s is %s', (_name, value, reason) => {
			expect(
				reduceAnimating(begin(DUEL), 'a', { runId: 'r1', animating: value }),
			).toEqual({ ok: false, reason })
		})

		it('no runId is bad_payload, a stale runId is round_over', () => {
			expect(reduceAnimating(begin(DUEL), 'a', { animating: true })).toEqual({
				ok: false,
				reason: 'bad_payload',
			})
			expect(
				reduceAnimating(begin(DUEL), 'a', { runId: 'old', animating: true }),
			).toEqual({ ok: false, reason: 'round_over' })
		})

		it('a player who disconnects is cleared', () => {
			let s = animate(begin(DUEL), 'b', true)
			s = tick(s, DUEL, 1_000, [], [], ['b'])
			expect(s.facts.animating).toEqual([])
		})

		it('a player who left the lobby is cleared', () => {
			let s = animate(begin(DUEL), 'b', true)
			s = tick(s, DUEL, 1_000, [], ['b'])
			expect(s.facts.animating).toEqual([])
		})

		it('the set is empty when the round closes', () => {
			let s = animate(animate(begin(DUEL), 'a', true), 'b', true)
			// A newer start closes the open round at this tick.
			s = { ...s, lastStart: startOf(DUEL.ids, 2) }
			s = tick(s, DUEL, 1_000)
			expect(s.facts.animating).toEqual([])
		})

		it('an eliminated player is cleared', () => {
			const s = withLives(animate(begin(DUEL), 'b', true), 'b', 0)
			expect(tick(s, DUEL, 1_000).facts.animating).toEqual([])
		})

		it('a new run starts with nobody animating', () => {
			const s = animate(begin(DUEL), 'b', true)
			const next = decide(
				{ ...s, runId: 'r2', lastStart: startOf(DUEL.ids) },
				{ ...envOf(DUEL, s, []), runId: 'r2' },
				testContext(1_000),
				pickMode,
			).state
			expect(next.facts.animating).toEqual([])
		})
	})

	it('Pressure: an animating pause loses and gains no time', () => {
		const shop = (s: RefereeState): RefereeState => ({
			...s,
			round: { ...s.round, phase: 'shop' },
		})
		let s = tick(shop(begin(PERSONAL)), PERSONAL, 1_000)
		const base = s.facts.clocks.a.ms
		s = tick(animate(s, 'a', true), PERSONAL, 11_000)
		expect(clockLive(s.facts.clocks.a, 11_000)).toBe(base - 10_000)
		s = tick(s, PERSONAL, 500_000)
		expect(clockLive(s.facts.clocks.a, 500_000)).toBe(base - 10_000)
		s = tick(animate(s, 'a', false), PERSONAL, 500_000)
		expect(clockLive(s.facts.clocks.a, 505_000)).toBe(base - 15_000)
	})

	it('Pressure: the owner animating stops their own clock, and it goes on after', () => {
		const shop = (s: RefereeState): RefereeState => ({
			...s,
			round: { ...s.round, phase: 'shop' },
		})
		let s = tick(shop(begin(PERSONAL)), PERSONAL, 1_000)
		expect(s.facts.clocks.a.running).toBe(true)
		s = tick(animate(s, 'a', true), PERSONAL, 2_000)
		expect(s.facts.clocks.a.running).toBe(false)
		expect(s.facts.clocks.b.running).toBe(true)
		s = tick(animate(s, 'a', false), PERSONAL, 3_000)
		expect(s.facts.clocks.a.running).toBe(true)
	})
})

describe('forgiveness: per player, per game', () => {
	const forgiving = (n: number): Setup => ({
		...ROYALE,
		metadata: { ...ROYALE.metadata, timer_forgiveness: n },
	})
	const periods = (n: number): number => 30_000 + (n - 1) * BASE_MS

	it('the first timerForgiveness run-outs cost nothing, the next costs a life', () => {
		const setup = forgiving(2)
		let s = anteOn(begin(setup), setup, 'a', 30_000, 0, ['a', 'c'])
		s = tick(s, setup, periods(1), ['a', 'c'])
		expect(livesOf(s, 'b')).toBe(4)
		s = tick(s, setup, periods(2), ['a', 'c'])
		expect(livesOf(s, 'b')).toBe(4)
		s = tick(s, setup, periods(3), ['a', 'c'])
		expect(livesOf(s, 'b')).toBe(3)
		expect(s.facts.forgiven).toEqual({ b: 2 })
	})

	it('each timed player has their own count', () => {
		const setup = forgiving(1)
		let s = anteOn(begin(setup), setup, 'a', 30_000, 0, ['a'])
		s = tick(s, setup, periods(1), ['a'])
		expect(s.facts.forgiven).toEqual({ b: 1, c: 1 })
		expect([livesOf(s, 'b'), livesOf(s, 'c')]).toEqual([4, 4])
		s = tick(s, setup, periods(2), ['a'])
		expect([livesOf(s, 'b'), livesOf(s, 'c')]).toEqual([3, 3])
	})

	it('a forgiven run-out still restarts the deadline and costs no life', () => {
		const setup = forgiving(1)
		const s = tick(
			anteOn(begin(setup), setup, 'a', 30_000, 0, ['a']),
			setup,
			30_000,
			['a'],
		)
		expect(deadlineOf(s)?.n).toBe(2)
		expect(s.facts.forgiven).toEqual({ b: 1, c: 1 })
		expect([livesOf(s, 'b'), livesOf(s, 'c')]).toEqual([4, 4])
	})

	it('no forgiveness by default', () => {
		const s = tick(
			anteOn(begin(DUEL), DUEL, 'a', 30_000, 0, ['a']),
			DUEL,
			30_000,
			['a'],
		)
		expect(s.facts.forgiven).toEqual({})
	})
})


// ------------------------------------- the server's run-out, per mode

// The last life of the timed player, per mode: the run-out the server makes at the
// deadline knows no blind, so it records no failed blind and the death settles at once.
interface ParityRow {
	name: string
	setup: Setup
	timed: string
	ready: string[]
	prepare: (s: RefereeState) => RefereeState
}

const PARITY: ParityRow[] = [
	{
		name: 'duel',
		setup: DUEL,
		timed: 'b',
		ready: ['a'],
		prepare: (s) => withLives(s, 'b', 1),
	},
	{
		name: 'Royale',
		setup: ROYALE,
		timed: 'b',
		ready: ['a', 'c'],
		prepare: (s) => withLives(s, 'b', 1),
	},
	{
		name: 'Nemesis',
		setup: NEMESIS,
		timed: 'b',
		ready: ['a', 'c', 'd'],
		prepare: (s) => withLives(s, 'b', 1),
	},
	{
		name: 'Manhunt (the Runner)',
		setup: MANHUNT,
		timed: 'r',
		ready: ['h1', 'h2'],
		prepare: (s) => withLives(s, 'r', 1),
	},
	{
		name: 'Teams (the pool)',
		setup: TEAMS,
		timed: 'a1',
		ready: ['a2', 'b1', 'b2'],
		prepare: (s) => withPool(s, 'A', 1),
	},
]

describe('a server-made run-out on the last life, per mode: the blind is unknown', () => {
	it.each(PARITY)('$name: out of lives, no blind recorded, no invented key', (row) => {
		const base = row.prepare(begin(row.setup))
		const starter = row.setup.ids.find(
			(id) =>
				row.ready.includes(id) &&
				wouldTime('ante', id, base, worldFor(base, row.setup, row.ready)).ok,
		)
		if (!starter) throw new Error('nobody can start the timer')
		const server = tick(
			anteOn(base, row.setup, starter, 10_000, 0, row.ready),
			row.setup,
			10_000,
			row.ready,
		)
		expect(livesOf(server, row.timed)).toBe(0)
		expect(server.facts.blinds[row.timed]).toBeUndefined()
	})

	it('duel: on the Boss the other player wins with no pending death', () => {
		const row = PARITY[0]
		const s = tick(
			anteOn(atBoss(row.prepare(begin(DUEL)), 'b'), DUEL, 'a', 10_000, 0, [
				'a',
			]),
			DUEL,
			10_000,
			['a'],
		)
		expect(s.result).toMatchObject({ kind: 'win', winnerId: 'a' })
		expect(s.lives.pending).toEqual([])
	})

	it('Royale: the game goes on with two left, the cut player placed last', () => {
		const row = PARITY[1]
		const s = tick(
			anteOn(row.prepare(begin(ROYALE)), ROYALE, 'a', 10_000, 0, row.ready),
			ROYALE,
			10_000,
			row.ready,
		)
		expect(s.result.kind).toBeNull()
		expect(s.lives.players.b.eliminated).toBe(true)
		expect(deadlineOf(s)).toBeNull()
	})

	it("Manhunt: the Runner's last life is a death with no blind: nothing is left pending, the Runner is out", () => {
		const row = PARITY[3]
		const s = tick(
			anteOn(row.prepare(begin(MANHUNT)), MANHUNT, 'h1', 10_000, 0, row.ready),
			MANHUNT,
			10_000,
			row.ready,
		)
		expect(s.lives.pending).toEqual([])
		expect(s.lives.players.r.eliminated).toBe(true)
		expect(s.result).toMatchObject({ kind: 'win', winnerTeam: 'HUNTER' })
	})

	it("Teams: the pool of the timed member's team is what runs out", () => {
		const row = PARITY[4]
		const s = tick(
			anteOn(
				atBoss(row.prepare(begin(TEAMS)), 'a1'),
				TEAMS,
				'b1',
				10_000,
				0,
				row.ready,
			),
			TEAMS,
			10_000,
			row.ready,
		)
		expect(s.lives.teamLives).toEqual({ A: 0, B: 4 })
		expect(s.result).toMatchObject({ kind: 'win', winnerTeam: 'B' })
	})
})

describe('Teams: the pool is charged once per timed member', () => {
	it("two timed members cost the pool two lives (the clients' two claims)", () => {
		const setup = TEAMS
		let s = begin(setup)
		const ready = ['b1', 'b2']
		s = anteOn(s, setup, 'b1', 10_000, 0, ready)
		expect(deadlineOf(s)?.against).toEqual(['a1', 'a2'])
		s = tick(s, setup, 10_000, ready)
		expect(s.lives.teamLives).toEqual({ A: 2, B: 4 })
	})

	it('a timer started by a member never times its own side', () => {
		const state = begin(TEAMS)
		const world = worldFor(state, TEAMS, ['a1'])
		const timing = wouldTime('ante', 'a1', state, world)
		expect(timing).toEqual({ ok: true, against: ['b1', 'b2'] })
	})
})

describe('the deadline is part of nothing but the PvP key, and a run-out is seen once', () => {
	it('a stale own-clock deadline whose timed player left is dropped and costs nothing', () => {
		const s = anteOn(begin(DUEL), DUEL, 'a', undefined, 0, ['a'])
		const next = tick(s, DUEL, 10, ['a'], ['b'])
		expect(deadlineOf(next)).toBeNull()
		expect(livesOf(next, 'b')).toBe(4)
	})
})

// ------------------------------------------------ the PvP hand timer in the tick

describe('the PvP hand timer: server-counted, no bank, no restart', () => {
	const hand = (
		s: RefereeState,
		id: string,
		score: string,
		handsLeft: number,
		applied = 0,
	): RefereeState =>
		must(
			FACT_REDUCERS['pvp.hand'](s, id, {
				runId: 'r1',
				roundId: 1,
				score,
				handsLeft,
				timerLossesApplied: applied,
			}),
		)
	const commit = (
		s: RefereeState,
		id: string,
		handsLeft: number,
		applied = 0,
	): RefereeState =>
		must(
			FACT_REDUCERS['pvp.hand_commit'](s, id, {
				runId: 'r1',
				roundId: 1,
				handsLeft,
				timerLossesApplied: applied,
			}),
		)
	const lossesOf = (s: RefereeState, id: string): number =>
		s.round.players[id].timerLosses
	const leftOf = (s: RefereeState, id: string): number | null =>
		s.round.players[id].pvpLeftMs

	// `a` leads 10 to 3 with 3 hands left each: one hand of credit each, in the
	// allowances (60 s base + 10 s).
	const played = (): RefereeState =>
		tick(hand(hand(begin(DUEL), 'a', '10', 3), 'b', '3', 3), DUEL, 0)
	// `a` starts the PvP timer against `b`; the tick at t = 1000 opens it.
	const open = (): RefereeState =>
		tick(
			must(startTimer(played(), DUEL, 'a', { kind: 'pvp', roundId: 1 }, [])),
			DUEL,
			1_000,
		)

	it('credits each played hand to the allowance, opens with the target allowance', () => {
		expect([leftOf(played(), 'a'), leftOf(played(), 'b')]).toEqual([
			70_000, 70_000,
		])
		expect(deadlineOf(open())).toEqual({
			kind: 'pvp',
			by: 'a',
			against: ['b'],
			endsAt: 71_000,
			shownMs: 70_000,
			n: 1,
		})
	})

	it("the starter's bank is unchanged after the deadline runs, drops, pauses and expires", () => {
		const bank = played().facts.skips
		const running = tick(open(), DUEL, 30_000)
		const paused = tick(
			must(reduceTimerPause(open(), 'a', { runId: 'r1' })),
			DUEL,
			30_000,
		)
		const dropped = tick(hand(open(), 'b', '20', 2), DUEL, 30_000)
		const expired = tick(open(), DUEL, 80_000)
		expect(deadlineOf(running)).not.toBeNull()
		expect(deadlineOf(paused)).toBeNull()
		expect(deadlineOf(dropped)).toBeNull()
		expect(deadlineOf(expired)).toBeNull()
		for (const s of [running, paused, dropped, expired])
			expect(s.facts.skips).toEqual(bank)
	})

	it('a PvP expiry does not restart: one run-out for the target, no life', () => {
		const s = tick(open(), DUEL, 71_000)
		expect(deadlineOf(s)).toBeNull()
		expect(lossesOf(s, 'b')).toBe(1)
		expect(livesOf(s, 'b')).toBe(4)
		expect(s.facts.forgiven).toEqual({})
		// the allowance is one hand's time again, and a later tick does nothing
		expect(leftOf(s, 'b')).toBe(10_000)
		expect(tick(s, DUEL, 500_000)).toEqual(s)
	})

	it('the run-out recomputes handsLeft through the one derivation', () => {
		const s = tick(open(), DUEL, 71_000)
		expect(s.round.players.b.handsLeft).toBe(2)
		expect(s.round.players.b.reportedHands).toBe(3)
	})

	it('a credit before the expiry moves endsAt, bumps n and resets shownMs', () => {
		const s = tick(hand(open(), 'b', '4', 2), DUEL, 5_000)
		expect(deadlineOf(s)).toEqual({
			kind: 'pvp',
			by: 'a',
			against: ['b'],
			endsAt: 81_000,
			shownMs: 76_000,
			n: 2,
		})
		expect(leftOf(s, 'b')).toBe(70_000)
	})

	it('a credit after the expiry tick only feeds the allowance', () => {
		const expired = tick(open(), DUEL, 71_000)
		// the client lost a hand to the run-out, then played one: 1 hand left
		const s = tick(hand(expired, 'b', '4', 1, 1), DUEL, 72_000)
		expect(deadlineOf(s)).toBeNull()
		expect(leftOf(s, 'b')).toBe(20_000)
	})

	it('a hand committed at 0 with no hand left: the target stays timed, the run-out clears the commit and the round resolves', () => {
		// `a` is out of hands; `b` has one left and commits the hand that ends it
		let s = hand(hand(played(), 'a', '10', 0), 'b', '3', 1)
		s = tick(s, DUEL, 100)
		s = commit(s, 'b', 0)
		expect(s.round.players.b.committedHands).toBe(0)
		s = tick(
			must(startTimer(s, DUEL, 'a', { kind: 'pvp', roundId: 1 }, [])),
			DUEL,
			1_000,
		)
		// the credit for that hand came with the commit: the target is still timed
		expect(deadlineOf(s)).toMatchObject({ kind: 'pvp', against: ['b'] })
		s = tick(s, DUEL, 500_000)
		expect(s.round.players.b.committedHands).toBeNull()
		expect(s.round.players.b.handsLeft).toBe(0)
		expect(s.round.phase).not.toBe('playing')
	})

	it('a run-out while a hand is committed lowers the commit and the watermark: the hand then matches and earns no second credit', () => {
		let s = tick(commit(played(), 'b', 2), DUEL, 100)
		expect(s.round.players.b).toMatchObject({
			committedHands: 2,
			creditedHands: 2,
		})
		s = tick(
			must(startTimer(s, DUEL, 'a', { kind: 'pvp', roundId: 1 }, [])),
			DUEL,
			1_000,
		)
		s = tick(s, DUEL, 500_000)
		expect(s.round.players.b).toMatchObject({
			timerLosses: 1,
			committedHands: 1,
			creditedHands: 1,
		})
		const credits = (x: RefereeState): number =>
			x.facts.log.filter((f) => f.type === 'hand_credit').length
		// the client played the committed hand, then applied the run-out: 1 left
		const after = hand(s, 'b', '4', 1, 1)
		expect(after.round.players.b).toMatchObject({
			committedHands: null,
			creditedHands: 1,
			handsLeft: 1,
		})
		expect(credits(after)).toBe(credits(s))
	})

	it('a hand after a commit-at-0 run-out is a hand while the round plays, and refused once it is over', () => {
		let s = tick(hand(hand(played(), 'a', '10', 1), 'b', '3', 1), DUEL, 100)
		s = commit(s, 'b', 0)
		// the run-out, made on its own: the round would end in the tick that follows
		s = pvpRunOut(s, 'b', 10_000)
		expect(s.round.phase).toBe('playing')
		expect(s.round.players.b.committedHands).toBeNull()
		const late = {
			runId: 'r1',
			roundId: 1,
			score: '4',
			handsLeft: 0,
			timerLossesApplied: 1,
		}
		expect(FACT_REDUCERS['pvp.hand'](s, 'b', late).ok).toBe(true)
		const over = tick(hand(s, 'a', '10', 0), DUEL, 500_001)
		expect(over.round.phase).not.toBe('playing')
		expect(FACT_REDUCERS['pvp.hand'](over, 'b', late)).toEqual({
			ok: false,
			reason: 'not_playing',
		})
	})

	it('away pauses the PvP deadline and keeps the allowance', () => {
		const away = tick(open(), DUEL, 5_000, [], [], ['b'])
		expect(deadlineOf(away)).toMatchObject({ pausedMs: 66_000 })
		const later = tick(away, DUEL, 900_000, [], [], ['b'])
		expect(lossesOf(later, 'b')).toBe(0)
		const released = tick(
			must(reduceTimerPause(later, 'a', { runId: 'r1' })),
			DUEL,
			900_001,
			[],
			[],
			['b'],
		)
		expect(deadlineOf(released)).toBeNull()
		expect(leftOf(released, 'b')).toBe(66_000)
	})
})

// ---------------------------------------------------------- end to end, the wire

const info = (name: string) => ({
	displayName: name,
	preferredJoker: null,
	mods: null,
})

const lobbyCtx = (now: number) => ({
	now,
	newSeed: () => 'SEED',
	newId: () => 'r1',
	random: () => 0,
})

function send(
	lobby: Lobby,
	from: string,
	key: string,
	params: unknown = {},
): Step {
	return action(
		lobby,
		from,
		{ cid: `${key}-${from}`, action: key, to: 'server', params },
		lobbyCtx(0),
	)
}

// Two players, a game started, the first tick run and round 1 open.
function checkpointed(lobby: Lobby, at: number) {
	const checkpoint = checkpointOf(lobby, at)
	if (!checkpoint) throw new Error('the lobby has players, so it checkpoints')
	return checkpoint
}

function duelLobby(): Lobby {
	let lobby = newLobby({
		code: 'ABC123',
		modId: 'MultiplayerPvP',
		maxPlayers: 8,
		creatorId: 'a',
		now: 0,
		graceMs: 10_000,
		resultTimeoutMs: 60_000,
	})
	lobby = {
		...lobby,
		metadata: withRules({ ...lobby.metadata, ruleset: 'ruleset_mp_balanced' }),
	}
	for (const id of ['a', 'b'])
		lobby = join(lobby, id, `${id}-s1`, info(id)).lobby
	lobby = send(lobby, 'b', 'mpapi_ready', { ready: true }).lobby
	lobby = send(lobby, 'a', 'mpapi_start_game', { stake: 2 }).lobby
	lobby = pvpTick(raced(lobby), testContext(0)).lobby
	const pvp = pvpOf(lobby)
	if (!pvp) throw new Error('no pvp state')
	// everyone ready, then the tick that opens round 1
	for (const id of ['a', 'b']) {
		const r = readyReducer.reduce(
			lobby,
			id,
			{ runId: pvp.runId, roundId: 1, startingHands: 4, blindKey: '2:Boss' },
			testContext(0),
		)
		if (!r.ok) throw new Error(`refused: ${r.reason}`)
		lobby = r.lobby
	}
	lobby = pvpTick(lobby, testContext(0)).lobby
	// each client reports its blind's start, as pvp.blind_start does
	for (const id of ['a', 'b']) {
		const r = ask(
			lobby,
			id,
			'pvp.blind_start',
			{ runId: 'r1', roundId: 1, handsLeft: 4, score: '0', timerLossesApplied: 0 },
			0,
		)
		expect(r.answer).toMatchObject({ ok: true })
		lobby = r.lobby
	}
	return pvpTick(lobby, testContext(0)).lobby
}

let counter = 0
function ask(
	lobby: Lobby,
	from: string,
	type: string,
	payload: unknown,
	now: number,
): RequestResult {
	return handleRequest(
		lobby,
		from,
		{ v: 1, reqId: `c1:${++counter}`, type, payload },
		testContext(now),
	)
}

// `a` is Ready for round 2 with an Ante bank of `ms` (30 s), no timer started yet.
function readyLobby(ms = 30_000): Lobby {
	const base = duelLobby()
	const banked = refereeOf(base)
	if (!banked) throw new Error('no referee state')
	const lobby = withReferee(base, withBank(banked, 'a', ms))
	const pvp = pvpOf(lobby)
	if (!pvp) throw new Error('no pvp state')
	const ready = readyReducer.reduce(
		lobby,
		'a',
		{
			runId: pvp.runId,
			roundId: pvp.round + 1,
			startingHands: 4,
			blindKey: '3:Boss',
		},
		testContext(1000),
	)
	if (!ready.ok) throw new Error(`refused: ${ready.reason}`)
	return ready.lobby
}

// `a` is Ready for round 2 and starts an Ante timer of `ms` (30 s) at t = 1000.
function anteLobby(ms = 30_000): Lobby {
	const r = ask(
		readyLobby(ms),
		'a',
		'pvp.timer_start',
		{ runId: 'r1', kind: 'ante' },
		1000,
	)
	expect(r.answer).toMatchObject({ ok: true })
	return pvpTick(r.lobby, testContext(1000)).lobby
}

const roundOf = (lobby: Lobby): { deadline: unknown } =>
	projectRound(lobby) as { deadline: unknown }

function fixture<T>(name: string): T {
	return JSON.parse(
		readFileSync(
			pathJoin(__dirname, '..', '__fixtures__', 'net-v1', `${name}.json`),
			'utf8',
		),
	)
}

describe('end to end through the registry and pvpTick', () => {
	it('the request is recorded and the tick opens the deadline: pvp.round announces it', () => {
		const lobby = anteLobby()
		expect(roundOf(lobby).deadline).toEqual({
			kind: 'ante',
			by: 'a',
			against: ['b'],
			remainingMs: 30_000,
			n: 1,
		})
	})

	it('property: a deadline that runs untouched changes no key, tick after tick', () => {
		const lobby = anteLobby()
		fc.assert(
			fc.property(
				fc.array(fc.integer({ min: 1_000, max: 30_999 }), {
					minLength: 1,
					maxLength: 30,
				}),
				(clock) => {
					let now = 1_000
					let current = lobby
					for (const t of [...clock].sort((x, y) => x - y)) {
						now = Math.max(now, t)
						const step = pvpTick(current, testContext(now))
						expect(changedKeys(current, step.lobby)).toEqual([])
						expect(step.out).toEqual([])
						current = step.lobby
					}
				},
			),
		)
	})

	it('a run-out changes pvp.round and pvp.lives, once', () => {
		const lobby = anteLobby()
		const step = pvpTick(fromRuntime(lobby), testContext(31_000))
		expect(changedKeys(lobby, step.lobby).sort()).toEqual(
			['pvp.lives', 'pvp.round', 'pvp.skips'].sort(),
		)
		expect(roundOf(step.lobby).deadline).toEqual({
			kind: 'ante',
			by: 'a',
			against: ['b'],
			remainingMs: BASE_MS,
			n: 2,
		})
		expect(refereeOf(step.lobby)?.lives.players.b.lives).toBe(3)
		expect(
			changedKeys(step.lobby, pvpTick(step.lobby, testContext(31_000)).lobby),
		).toEqual([])
	})

	it('a snapshot has the live remaining time, a STATE the frozen bank', () => {
		const lobby = anteLobby()
		const at = (now: number): unknown =>
			(
				snapshotFor(lobby, 'a', now).match as {
					[k: string]: { deadline: unknown }
				}
			)['pvp.round'].deadline
		expect(at(1_000)).toMatchObject({ remainingMs: 30_000 })
		expect(at(11_000)).toMatchObject({ remainingMs: 20_000 })
		expect(at(99_000)).toMatchObject({ remainingMs: 0 })
		expect(roundOf(lobby).deadline).toMatchObject({ remainingMs: 30_000 })
	})

	it('a snapshot request answers with the live remaining time, a plain push the frozen bank', () => {
		const lobby = anteLobby(60_000)
		const deadlineIn = (out: Outbound): unknown => {
			if (out.kind !== 'send') throw new Error('not a send')
			const round = (out.payload as StateMessage).changed['pvp.round']
			return (round as { deadline: unknown }).deadline
		}
		// Opened at t = 1000 with 60 s; asked at t = 21000.
		const snapshot = ask(lobby, 'a', 'snapshot', {}, 21_000).pushes[0]
		const push = announceChange(lobby, ['pvp.round']).out[0]
		expect(deadlineIn(snapshot)).toMatchObject({ remainingMs: 40_000 })
		expect(deadlineIn(push)).toMatchObject({ remainingMs: 60_000 })
	})

	// `b`, the timed player, drops at t = 11 s of the 30 s the Ante timer opened
	// with at t = 1 s: 20 s are left.
	function pausedLobby(): Lobby {
		const dropped = disconnect(anteLobby(), 'b', 'b-s1', 11_000).lobby
		return pvpTick(dropped, testContext(11_000)).lobby
	}

	it('a disconnect pauses the deadline: pvp.round announces the time left and paused', () => {
		const lobby = anteLobby()
		const step = pvpTick(
			disconnect(lobby, 'b', 'b-s1', 11_000).lobby,
			testContext(11_000),
		)
		expect(roundOf(step.lobby).deadline).toEqual({
			kind: 'ante',
			by: 'a',
			against: ['b'],
			remainingMs: 20_000,
			paused: true,
			n: 1,
		})
		expect(changedKeys(lobby, step.lobby)).toContain('pvp.round')
	})

	it('a snapshot or a rejoin while paused shows the frozen time, whatever the clock says', () => {
		const lobby = pausedLobby()
		expect(snapshotFor(lobby, 'a', 11_000).match['pvp.round']).toMatchObject({
			deadline: { remainingMs: 20_000, paused: true },
		})
		expect(snapshotFor(lobby, 'a', 99_000).match['pvp.round']).toMatchObject({
			deadline: { remainingMs: 20_000, paused: true },
		})
		expect(pvpTick(lobby, testContext(99_000)).lobby).toEqual(lobby)
	})

	it("the starter's own disconnect drops their Ready, so the deadline ends", () => {
		const lobby = anteLobby()
		expect(roundOf(lobby).deadline).not.toBeNull()
		const dropped = pvpTick(
			disconnect(lobby, 'a', 'a-s1', 11_000).lobby,
			testContext(11_000),
		).lobby
		expect(roundOf(dropped).deadline).toBeNull()
	})

	// A2: the starter disconnects 10 s into a 120 s bank: the deadline ends
	// 'unready' at its real run time and the bank is charged exactly that.
	it("the starter's disconnect mid-ante charges the bank exactly the time that ran", () => {
		const lobby = anteLobby(120_000)
		const spent = (l: Lobby): number | undefined =>
			refereeOf(l)?.facts.skips.a.spentMs
		expect(spent(lobby)).toBe(BASE_MS - 120_000)
		const dropped = pvpTick(
			disconnect(lobby, 'a', 'a-s1', 11_000).lobby,
			testContext(11_000),
		).lobby
		expect(refereeOf(dropped)?.facts.deadline).toBeNull()
		expect(spent(dropped)).toBe(BASE_MS - 120_000 + 10_000)
	})

	// A1: a resume moves the server times on by the downtime.
	describe('a restart moves the PvP deadline on by the downtime', () => {
		it('a running Speedlatro clock is not run out by a downtime longer than its time left: the first tick after the resume has no run-out', () => {
			// `ua` has 90 s at rate 2 since t = 40 000: 70 s left at the checkpoint at
			// t = 50 000. The server is down for 200 s, more than that. Between PvP
			// rounds with no result open, so the clock is running.
			const fixture = populatedPvpLobby()
			const referee = refereeOf(fixture)
			if (!referee) throw new Error('the fixture has a referee')
			// No contest and no pending result, which would end the game in the tick.
			const { contest: _contest, ...game } = fixture.game
			const open = withReferee({ ...fixture, game: { ...game, resultPending: false, resultWasPending: false } }, {
				...referee,
				round: { ...referee.round, phase: 'shop' },
				result: { runId: 'run-1', kind: null, winnerId: null, winnerTeam: null, places: [] },
				lives: { ...referee.lives, pending: [] },
				facts: { ...referee.facts, deadline: null, log: [], applied: 0, deaths: [] },
			})
			const before = refereeOf(open)?.facts.clocks.ua
			expect(before).toMatchObject({ ms: 90_000, running: true, rate: 2, n: 4, spent: false })
			const now = 250_000
			const resumed = resumeFrom(checkpointed(open, 50_000), now)
			const attached = {
				...resumed,
				players: resumed.players.map((p) => ({ ...p, awaySince: null })),
			}
			const ticked = refereeOf(pvpTick(attached, testContext(now)).lobby)
			// The tick settles the clock to its 70 s (n counts that one settle), and
			// takes no life.
			expect(ticked?.facts.clocks.ua).toEqual({
				ms: 70_000,
				running: true,
				rate: 1,
				n: 5,
				spent: false,
				since: now,
				graceUntil: 53_000 + 200_000,
			})
			expect(ticked?.lives.players.ua.lives).toBe(3)
		})

		it('a PvP deadline with 20 s left, 60 s down: 20 s left after the resume, paused with 20 s while everyone is away', () => {
			// `a` is ahead and starts the PvP timer against `b`; the tick at
			// t = 1000 opens it. It ends 20 s after the checkpoint at t = 51 000.
			const opened = tick(
				must(
					startTimer(
						tick(scored(begin(DUEL), { a: ['10', 3], b: ['3', 3] }), DUEL, 0),
						DUEL,
						'a',
						{ kind: 'pvp', roundId: 1 },
						[],
					),
				),
				DUEL,
				1_000,
			)
			const running = deadlineOf(opened)
			if (!running || running.endsAt === null) throw new Error('no PvP deadline')
			const at = running.endsAt - 20_000
			const lobby = withReferee(duelLobby(), opened)
			const now = at + 60_000
			const resumed = resumeFrom(checkpointed(lobby, at), now)
			expect(refereeOf(resumed)?.facts.deadline).toEqual({
				...running,
				endsAt: now + 20_000,
			})
			const ticked = pvpTick(resumed, testContext(now)).lobby
			expect(refereeOf(ticked)?.facts.deadline).toEqual({
				...running,
				endsAt: now + 20_000,
				pausedMs: 20_000,
			})
		})

		it('an Ante deadline 10 s into a 120 s bank, 60 s down: the timer stays, marked as carried over, and the bank is charged the 10 s that ran, not the downtime', () => {
			const lobby = anteLobby(120_000)
			const before = refereeOf(lobby)?.facts.skips.a.spentMs
			expect(before).toBe(BASE_MS - 120_000)
			const resumed = resumeFrom(checkpointed(lobby, 11_000), 71_000)
			const ticked = pvpTick(resumed, testContext(71_000)).lobby
			expect(refereeOf(ticked)?.facts.deadline).toMatchObject({ kind: 'ante', by: 'a', resumed: expect.any(Number) })
			expect(refereeOf(ticked)?.facts.skips.a.spentMs).toBe(
				BASE_MS - 120_000 + 10_000,
			)
		})

		it('a paused deadline is copied unchanged, bar the restart mark', () => {
			const lobby = pausedLobby()
			const before = refereeOf(lobby)?.facts.deadline
			expect(before).toMatchObject({ pausedMs: 20_000 })
			const resumed = resumeFrom(checkpointed(lobby, 11_000), 99_000)
			expect(refereeOf(resumed)?.facts.deadline).toEqual({ ...before, resumed: lobby.game.pvp?.lastStart?.roundId ?? 0 })
		})
	})

	it('the player back: it goes on with the same time left, not paused', () => {
		const back = join(pausedLobby(), 'b', 'b-s2', info('b')).lobby
		const lobby = pvpTick(back, testContext(50_000)).lobby
		expect(roundOf(lobby).deadline).toEqual({
			kind: 'ante',
			by: 'a',
			against: ['b'],
			remainingMs: 20_000,
			n: 1,
		})
		expect(snapshotFor(lobby, 'a', 60_000).match['pvp.round']).toMatchObject({
			deadline: { remainingMs: 10_000 },
		})
		expect(
			refereeOf(pvpTick(lobby, testContext(69_999)).lobby)?.lives.players.b
				.lives,
		).toBe(4)
		expect(
			refereeOf(pvpTick(lobby, testContext(70_000)).lobby)?.lives.players.b
				.lives,
		).toBe(3)
	})

	it('a pause request drops it and announces the key', () => {
		const lobby = anteLobby()
		const r = ask(lobby, 'a', 'pvp.timer_pause', { runId: 'r1' }, 2_000)
		expect(r.answer).toMatchObject({ ok: true })
		const step = pvpTick(r.lobby, testContext(2_000))
		expect(changedKeys(r.lobby, step.lobby).sort()).toEqual([
			'pvp.round',
			'pvp.skips',
		])
		expect(roundOf(step.lobby).deadline).toBeNull()
	})

	it('the answers: the other player cannot pause it, a second start is a no-op', () => {
		const lobby = anteLobby()
		const pause = ask(lobby, 'b', 'pvp.timer_pause', { runId: 'r1' }, 2_000)
		expect(pause.answer).toMatchObject({ ok: false, reason: 'not_starter' })
		const start = ask(
			lobby,
			'a',
			'pvp.timer_start',
			{ runId: 'r1', kind: 'ante' },
			2_000,
		)
		expect(start.answer).toMatchObject({ ok: true })
		expect(
			roundOf(pvpTick(start.lobby, testContext(2_000)).lobby).deadline,
		).toMatchObject({ remainingMs: 30_000, n: 1 })
	})

	// B3: the client loss routes are gone; the server alone counts a run-out.
	it('pvp.pvp_timer_loss with the running PvP deadline n is no request: the count is unchanged', () => {
		const base = duelLobby()
		const s = refereeOf(base)
		if (!s) throw new Error('no referee state')
		const lobby = withReferee(base, {
			...scored(s, { a: ['3', 2], b: ['10', 2] }),
			facts: {
				...s.facts,
				deadline: {
					kind: 'pvp',
					by: 'b',
					against: ['a'],
					endsAt: 5_000,
					shownMs: 4_000,
					n: 1,
				},
			},
		})
		const r = ask(
			lobby,
			'a',
			'pvp.pvp_timer_loss',
			{ runId: 'r1', roundId: 1, n: 1 },
			2_000,
		)
		expect(r.answer).toMatchObject({ ok: false, reason: 'unknown_type' })
		expect(refereeOf(r.lobby)?.round.players.a.timerLosses).toBe(0)
	})

	it('pvp.timer_loss with the running Ante deadline n is no request: no life is lost', () => {
		const lobby = readyLobby()
		const r = ask(
			lobby,
			'a',
			'pvp.timer_loss',
			{ runId: 'r1', kind: 'ante', blindKey: '2:Small', n: 1 },
			2_000,
		)
		expect(r.answer).toMatchObject({ ok: false, reason: 'unknown_type' })
		expect(refereeOf(r.lobby)?.lives.players.a.lives).toBe(4)
	})

	// B4: the client never says who counts.
	it('pvp.timer_start with a clock is bad_payload', () => {
		const lobby = readyLobby()
		const r = ask(
			lobby,
			'a',
			'pvp.timer_start',
			{ runId: 'r1', kind: 'ante', clock: 'own' },
			2_000,
		)
		expect(r.answer).toMatchObject({ ok: false, reason: 'bad_payload' })
	})

	describe('the wire fixtures', () => {
		it('state_deadline_ante: a STATE with an Ante deadline the server counts', () => {
			const lobby = anteLobby()
			const message = fixture<{
				rev: number
				changed: { [k: string]: unknown }
			}>('state_deadline_ante')
			expect(matchStateOf(lobby, ['pvp.round'])).toEqual(message.changed)
			expect(typeof message.rev).toBe('number')
		})

		it('state_deadline_paused: a STATE with an Ante deadline held for a disconnected player', () => {
			const message = fixture<{
				rev: number
				changed: { [k: string]: unknown }
			}>('state_deadline_paused')
			expect(matchStateOf(pausedLobby(), ['pvp.round'])).toEqual(
				message.changed,
			)
			expect(typeof message.rev).toBe('number')
		})

		it("state_deadline_pvp: a PvP hand timer is counted by the server from the ruleset's base", () => {
			let lobby = duelLobby()
			const s = refereeOf(lobby)
			if (!s) throw new Error('no referee state')
			lobby = withReferee(lobby, scored(s, { a: ['10', 2], b: ['3', 2] }))
			const r = ask(
				lobby,
				'a',
				'pvp.timer_start',
				{ runId: 'r1', kind: 'pvp', roundId: 1 },
				1_000,
			)
			expect(r.answer).toMatchObject({ ok: true })
			const next = pvpTick(r.lobby, testContext(1_000)).lobby
			const message = fixture<{ changed: { [k: string]: unknown } }>(
				'state_deadline_pvp',
			)
			expect(matchStateOf(next, ['pvp.round'])).toEqual(message.changed)
			expect(roundOf(next).deadline).toMatchObject({ remainingMs: 60_000 })
		})

		it('snapshot_deadline: a snapshot carries the live remaining time', () => {
			const started = anteLobby()
			// a has played a hand, so the snapshot is not masked for them
			const s = refereeOf(started)
			if (!s) throw new Error('no game')
			const lobby = withReferee(started, {
				...s,
				facts: { ...s.facts, handRound: { a: s.round.roundId } },
			})
			const message = fixture<{ now: number; match: { [k: string]: unknown } }>(
				'snapshot_deadline',
			)
			expect({
				'pvp.round': snapshotFor(lobby, 'a', message.now).match['pvp.round'],
			}).toEqual(message.match)
		})
	})
})
