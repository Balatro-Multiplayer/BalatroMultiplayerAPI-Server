// The Manhunt rules (rules R35-R45 of docs/pvp-match.md): the Runner is settled at the
// start, a round is the Runner against every Hunter, the Runner's voucher gives
// every Hunter a life, and the game ends for the right side. Rows that move lives
// drive the real tick (`decide`) with the Manhunt rules; every state read goes
// through `fromRuntime`, so nothing relies on object identity.
import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { reportAll, startOf } from '../../../testing/pvp_fixtures'
import { withRules } from '../../../testing/pvp_rules'
import { testContext } from '../../../testing/request_context'
import { fromRuntime } from '../../../testing/runtime_state'
import { FACT_REDUCERS } from '../facts'
import {
	type ModeView,
	type PvpFact,
	type PvpLifeEvent,
	type PvpTeam,
	type RefereeState,
	emptyFacts,
	emptyPvp,
} from '../state'
import { type ModeFor, type TickEnv, decide } from '../tick'
import { manhuntMode } from './manhunt'

const ctx = testContext(1000)
const modeFor: ModeFor = () => manhuntMode

type Picks = { [id: string]: PvpTeam }
type Scores = { [id: string]: string }

const FOUR = ['a', 'b', 'c', 'd']
const HUNTERS = ['b', 'c', 'd']

interface Setup {
	ids?: string[]
	picks?: Picks
	hunterLives?: number
	teamPlan?: string[][] | null
}

// The lobby's start: `a` picked Runner, three Hunters with 3 lives each.
const envOf = ({
	ids = FOUR,
	picks = { a: 'RUNNER' },
	hunterLives = 3,
	teamPlan = null,
}: Setup = {}): TickEnv => ({
	runId: 'r1',
	startedIds: ids,
	seatedIds: ids,
	readyIds: [],
	readiedIds: [],
	raceStarted: true,
	ranked: false,
	requiredIds: ids,
	awayIds: [],
	metadata: withRules({ ruleset: 'ruleset_mp_traditional', queue_mode: 'pvp_manhunt', manhunt_hunter_lives: hunterLives }),
	picks,
	teamPlan,
})
const ENV = envOf()

const FIRST: RefereeState['lastStart'] = startOf(FOUR, 1, 'a')

const idle = (lastStart: RefereeState['lastStart']): RefereeState => ({
	...emptyPvp(),
	facts: emptyFacts(),
	runId: 'r1',
	lastStart,
})

// The run frozen by the first tick; round 1 is open unless `lastStart` is null
// (then the game sits between rounds, in the shop).
const begin = (
	env: TickEnv = ENV,
	lastStart: RefereeState['lastStart'] = FIRST,
): RefereeState => reportAll(decide(idle(lastStart), env, ctx, modeFor).state)

const step = (state: RefereeState, env: TickEnv = ENV): RefereeState =>
	reportAll(fromRuntime(decide(fromRuntime(state), env, ctx, modeFor).state))

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
const refusal = (
	state: RefereeState,
	type: string,
	id: string,
	args: object = {},
): string | null => {
	const r = FACT_REDUCERS[type](state, id, { runId: 'r1', ...args })
	return r.ok ? null : r.reason
}
const failBlind = (state: RefereeState, id: string, blindKey: string) =>
	post(state, 'pvp.blind', id, { blindKey, beaten: false, roundLost: true })
const beatBlind = (state: RefereeState, id: string, blindKey: string) =>
	post(state, 'pvp.blind', id, { blindKey, beaten: true, roundLost: false })
const voucher = (state: RefereeState, id: string, voucherKey: string) =>
	post(state, 'pvp.voucher', id, { voucherKey })
const withFact = (state: RefereeState, fact: PvpFact): RefereeState => ({
	...state,
	facts: { ...state.facts, log: [...state.facts.log, fact] },
})

// These players score `scores` and have `hands` hands left; the rest are as they were.
function played(state: RefereeState, scores: Scores, hands = 0): RefereeState {
	const players = { ...state.round.players }
	for (const id of Object.keys(scores))
		players[id] = { ...players[id], score: scores[id], handsLeft: hands }
	return { ...state, round: { ...state.round, players } }
}

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

const livesOf = (s: ModeView, id: string): number => s.lives.players[id].lives
const allLives = (s: ModeView): number[] => FOUR.map((id) => livesOf(s, id))
const eventsOf = (s: ModeView, id: string): PvpLifeEvent[] =>
	s.lives.players[id].events
const GAIN: PvpLifeEvent = { delta: 1, key: null }
const winnerOf = (s: ModeView): string | null =>
	s.result.kind === null ? null : s.result.winnerTeam
const placesOf = (s: ModeView): number[] =>
	FOUR.map((id) => s.result.places.find((p) => p.playerId === id)?.place ?? 0)

const viewOf = (state: ModeView) => {
	if (!manhuntMode.view) throw new Error('manhunt has no view')
	return manhuntMode.view(state)
}
const gainersOf = (state: ModeView, playerId: string): string[] => {
	if (!manhuntMode.voucherGainers) throw new Error('manhunt has no vouchers')
	return manhuntMode.voucherGainers(state, { playerId, voucherKey: 'v_x' })
}

describe('R35, R36: the Runner and the lives, settled once at the start', () => {
	const ROLES: Array<[string, Setup, string]> = [
		[
			'R35 the first RUNNER pick in start order gets the role, a later one is a Hunter',
			{ picks: { b: 'RUNNER', c: 'RUNNER' } },
			'b',
		],
		[
			'R35 start order decides, not the order the picks were made in',
			{ picks: { d: 'RUNNER', c: 'RUNNER' } },
			'c',
		],
		['R35 no picks: the first starter is the Runner', { picks: {} }, 'a'],
		[
			'R35 only Hunter picks: the first starter is the Runner',
			{ picks: { c: 'HUNTER', b: 'HUNTER' } },
			'a',
		],
		['R35 a Teams pick means nothing here', { picks: { b: 'A', c: 'B' } }, 'a'],
		[
			'R35 a team plan is ignored',
			{
				picks: { c: 'RUNNER' },
				teamPlan: [
					['a', 'b'],
					['c', 'd'],
				],
			},
			'c',
		],
	]
	it.each(ROLES)('%s', (_name, setup, runner) => {
		const s = begin(envOf(setup))
		const expected: Picks = {}
		for (const id of FOUR) expected[id] = id === runner ? 'RUNNER' : 'HUNTER'
		expect(s.teams).toEqual({ runId: 'r1', teams: expected })
		expect(s.lives.teamLives).toBeNull()
	})

	it('R36 the Runner has 1 life, every Hunter manhunt_hunter_lives', () => {
		expect(allLives(begin(envOf({ hunterLives: 5 })))).toEqual([1, 5, 5, 5])
	})

	it('R36 the Hunters default to 7 lives', () => {
		const env = envOf()
		const bare: TickEnv = {
			...env,
			metadata: withRules({ ruleset: 'ruleset_mp_traditional', queue_mode: 'pvp_manhunt' }),
		}
		expect(allLives(begin(bare))).toEqual([1, 7, 7, 7])
	})

	it('R35 init sets the round up like the duel: every fact unknown until reported, no votes', () => {
		const s = decide(idle(FIRST), ENV, ctx, modeFor).state
		expect(s.round.runId).toBe('r1')
		for (const id of FOUR)
			expect(s.round.players[id]).toEqual({
				score: null,
				handsLeft: null,
				highestScore: null,
				ante: null,
				furthestBlind: null,
				reportedHands: null,
				reportedApplied: 0,
				timerLosses: 0,
				handsSpent: false,
				committedHands: null,
				creditedHands: null,
				pvpLeftMs: null,
			})
		expect(s.votes).toEqual({ runId: 'r1', draw: [], seed: [] })
		expect(s.lives.pending).toEqual([])
	})

	it('R35 a run already settled is left alone', () => {
		const s = begin()
		const start = {
			startedIds: FOUR,
			picks: { b: 'RUNNER' as const },
			teamPlan: null,
		}
		expect(manhuntMode.init(s, ctx, start)).toBe(s)
	})

	it('R35 the roles stay put across ticks', () => {
		const s = step(
			step(begin(envOf({ picks: { c: 'RUNNER' } })), envOf()),
			envOf(),
		)
		expect(s.teams.teams.c).toBe('RUNNER')
		expect(s.teams.teams.a).toBe('HUNTER')
	})
})

describe('roundReady: the round opens with no hands known', () => {
	it('opens playing, every hand count unknown until a blind_start reports it', () => {
		const s = decide(idle(startOf(FOUR, 1, 'a')), ENV, ctx, modeFor).state
		expect(s.round.phase).toBe('playing')
		for (const id of ['a', 'b', 'c'])
			expect(s.round.players[id].handsLeft).toBeNull()
	})
})

describe('R37: the round resolves when every alive player is out of hands', () => {
	const ZERO_HANDS: Scores = { a: '5', b: '3', c: '3', d: '3' }

	it('R37 nothing resolves while one alive player has hands', () => {
		const s = step(played(played(begin(), ZERO_HANDS), { d: '3' }, 1))
		expect(s.round.phase).toBe('playing')
		expect(s.round.lastResult).toBeNull()
		expect(allLives(s)).toEqual([1, 3, 3, 3])
	})

	it('R37 it resolves once the last player is out of hands', () => {
		const s = step(played(begin(), ZERO_HANDS))
		expect(s.round.phase).toBe('resolved')
		expect(s.round.lastResult).toEqual({ roundId: 1, losers: HUNTERS })
	})

	it('R37 a Hunter out of lives is not waited for', () => {
		const dead = withSeat(begin(), 'd', { lives: 0, eliminated: true })
		const s = step(played(dead, { a: '5', b: '3', c: '3' }))
		expect(s.round.lastResult).toEqual({ roundId: 1, losers: ['b', 'c'] })
	})

	it('R37 a Hunter who forfeited is not waited for', () => {
		const s = step(
			played(post(begin(), 'pvp.forfeit', 'd'), { a: '5', b: '3', c: '3' }),
		)
		expect(s.round.phase).toBe('resolved')
		expect(s.round.lastResult).toEqual({ roundId: 1, losers: ['b', 'c'] })
	})

	it('R37 the mode only names the losers: no lives, no roundId', () => {
		const before = played(begin(), ZERO_HANDS)
		const after = manhuntMode.resolveRound(before, ctx)
		expect(after.round.phase).toBe('resolved')
		expect(after.round.roundId).toBe(before.round.roundId)
		expect(after.lives).toEqual(before.lives)
	})

	it('R37 a resolved round stays resolved', () => {
		const once = step(played(begin(), ZERO_HANDS))
		expect(manhuntMode.resolveRound(once, ctx)).toBe(once)
	})
})

describe('R38, R39: who loses a life in a round', () => {
	// [name, round scores, losers, lives a b c d after the tick, the winner]
	const ROUNDS: Array<[string, Scores, string[], number[], string | null]> = [
		[
			'R38 a Hunter behind the Runner loses 1',
			{ a: '10', b: '5', c: '7', d: '9' },
			['b', 'c', 'd'],
			[1, 2, 2, 2],
			null,
		],
		[
			'R38 0-0 costs nothing',
			{ a: '0', b: '0', c: '0', d: '0' },
			[],
			[1, 3, 3, 3],
			null,
		],
		[
			'R38 a tie with the Runner above 0 costs the Hunter',
			{ a: '10', b: '10', c: '10', d: '10' },
			['b', 'c', 'd'],
			[1, 2, 2, 2],
			null,
		],
		[
			'R39 a Hunter tying the Runner does not catch it',
			{ a: '10', b: '10', c: '1', d: '1' },
			['b', 'c', 'd'],
			[1, 2, 2, 2],
			null,
		],
		[
			'R39 the best Hunter strictly ahead catches the Runner, the others still count',
			{ a: '5', b: '9', c: '3', d: '5' },
			['a', 'c', 'd'],
			[0, 3, 2, 2],
			'HUNTER',
		],
		[
			'R39 a Hunter above a Runner at 0 catches it, the 0-0 Hunters cost nothing',
			{ a: '0', b: '1', c: '0', d: '0' },
			['a'],
			[0, 3, 3, 3],
			'HUNTER',
		],
	]
	it.each(ROUNDS)('%s', (_name, scores, losers, lives, winner) => {
		const s = step(played(begin(), scores))
		expect(s.round.lastResult).toEqual({ roundId: 1, losers })
		expect(allLives(s)).toEqual(lives)
		expect(winnerOf(s)).toBe(winner)
		expect(s.round.roundId).toBe(1)
	})

	it('R38 scores compare as scores, not as text', () => {
		const s = step(played(begin(), { a: '9', b: '10', c: '9', d: '2' }))
		expect(s.round.lastResult?.losers).toEqual(['a', 'c', 'd'])
	})
})

describe('R42: the Runner buys a Manhunt voucher, every Hunter gains a life', () => {
	it('R42 two vouchers at one ante give every Hunter +2, as two events', () => {
		let s = voucher(begin(), 'a', 'v_mp_hieroglyph')
		s = voucher(s, 'a', 'v_mp_petroglyph')
		s = step(s)
		expect(allLives(s)).toEqual([1, 5, 5, 5])
		for (const id of HUNTERS) expect(eventsOf(s, id)).toEqual([GAIN, GAIN])
		expect(eventsOf(s, 'a')).toEqual([])
	})

	it('R42 the same voucher twice gives +1', () => {
		let s = voucher(begin(), 'a', 'v_mp_hieroglyph')
		expect(
			refusal(s, 'pvp.voucher', 'a', { voucherKey: 'v_mp_hieroglyph' }),
		).toBe('already_redeemed')
		s = step(s)
		s = step(s)
		expect(allLives(s)).toEqual([1, 4, 4, 4])
		for (const id of HUNTERS) expect(eventsOf(s, id)).toEqual([GAIN])
	})

	it('R42 a Hunter at 0 lives gains nothing', () => {
		const dead = withSeat(begin(), 'b', { lives: 0, eliminated: true })
		const s = step(voucher(dead, 'a', 'v_mp_hieroglyph'))
		expect(allLives(s)).toEqual([1, 0, 4, 4])
		expect(eventsOf(s, 'b')).toEqual([])
	})

	it('R42 a Hunter who forfeited gains nothing', () => {
		const s = step(
			voucher(post(begin(), 'pvp.forfeit', 'b'), 'a', 'v_mp_hieroglyph'),
		)
		expect(allLives(s)).toEqual([1, 3, 4, 4])
	})

	it("R42 a Hunter's own voucher request gives nothing", () => {
		const s = begin()
		expect(
			refusal(s, 'pvp.voucher', 'b', { voucherKey: 'v_mp_hieroglyph' }),
		).toBe('not_runner')
		// the mode names nobody even for a fact that reached the log
		expect(gainersOf(s, 'b')).toEqual([])
		const forged = withFact(s, {
			type: 'voucher',
			playerId: 'b',
			voucherKey: 'v_mp_hieroglyph',
		})
		expect(allLives(step(forged))).toEqual([1, 3, 3, 3])
	})

	it('R42 after the voucher, a Hunter losing the PvP round on its own replayed Boss key loses exactly 1', () => {
		const keys = { a: '2:Boss', b: '2:Boss', c: '2:Boss', d: '2:Boss' }
		const start = (roundId: number): RefereeState['lastStart'] => ({
			...startOf(FOUR, roundId, 'a'),
			blindKeys: keys,
		})
		const round = { a: '10', b: '5', c: '5', d: '5' }
		let s = step(played(begin(ENV, start(1)), round))
		expect(allLives(s)).toEqual([1, 2, 2, 2])
		s = step(voucher(s, 'a', 'v_mp_hieroglyph'))
		expect(allLives(s)).toEqual([1, 3, 3, 3])
		s = step({ ...s, lastStart: start(2) })
		expect(s.round.roundId).toBe(2)
		s = step(played(s, round))
		expect(allLives(s)).toEqual([1, 2, 2, 2])
		// the roundLost that follows is on the key the PvP loss already spent
		s = step(failBlind(s, 'b', '2:Boss'))
		expect(livesOf(s, 'b')).toBe(2)
		expect(eventsOf(s, 'b')).toEqual([
			{ delta: -1, key: 'pvp:1' },
			GAIN,
			{ delta: -1, key: 'pvp:2' },
		])
		// any other blind is another guard
		expect(livesOf(step(failBlind(s, 'b', '1:Small')), 'b')).toBe(1)
	})

	it('R42 the Runner names every Hunter and nobody else', () => {
		expect(gainersOf(begin(), 'a').sort()).toEqual(HUNTERS)
	})

	it('R42 a gain never moves the Runner or the life events of a loss', () => {
		let s = voucher(begin(), 'a', 'v_mp_hieroglyph')
		s = step(played(s, { a: '10', b: '5', c: '5', d: '5' }))
		expect(allLives(s)).toEqual([1, 3, 3, 3])
		expect(eventsOf(s, 'b')).toEqual([GAIN, { delta: -1, key: 'pvp:1' }])
	})
})

describe('R41: the Runner reaching ante 9 wins', () => {
	const atAnte = (s: RefereeState, ante: number): RefereeState =>
		post(s, 'pvp.progress', 'a', { ante, furthestBlind: 1 })

	it('R41 between rounds the Runner at ante 9 wins', () => {
		const s = step(atAnte(begin(ENV, null), 9))
		expect(s.round.phase).toBe('shop')
		expect(winnerOf(s)).toBe('RUNNER')
		expect(placesOf(s)).toEqual([1, 2, 2, 2])
	})

	it('A5 a Runner who has reported no ante never wins here, one who reported 9 does', () => {
		const s = begin(ENV, null)
		const noAnte: RefereeState = {
			...s,
			round: {
				...s.round,
				players: {
					...s.round.players,
					a: { ...s.round.players.a, ante: null },
				},
			},
		}
		expect(winnerOf(step(noAnte))).toBeNull()
		expect(winnerOf(step(atAnte(s, 9)))).toBe('RUNNER')
	})

	it('R41 ante 8 is not enough', () => {
		expect(winnerOf(step(atAnte(begin(ENV, null), 8)))).toBeNull()
	})

	it('R41 mid-round the win waits, and comes when the round resolves', () => {
		let s = step(atAnte(begin(), 9))
		expect(s.round.phase).toBe('playing')
		expect(winnerOf(s)).toBeNull()
		s = step(played(s, { a: '0', b: '0', c: '0', d: '0' }))
		expect(s.round.phase).toBe('resolved')
		expect(winnerOf(s)).toBe('RUNNER')
	})

	it('R41 mid-round a Hunter strictly ahead still catches the Runner: the Hunters win, not the Runner', () => {
		let s = step(atAnte(begin(), 9))
		s = step(played(s, { a: '5', b: '9', c: '1', d: '1' }))
		expect(livesOf(s, 'a')).toBe(0)
		expect(winnerOf(s)).toBe('HUNTER')
		expect(placesOf(s)).toEqual([2, 1, 1, 1])
	})

	it("R41 a Hunter's ante does not count", () => {
		const s = step(
			post(begin(ENV, null), 'pvp.progress', 'b', {
				ante: 9,
				furthestBlind: 1,
			}),
		)
		expect(winnerOf(s)).toBeNull()
	})
})

describe('R40: the game ends when the Runner or the last Hunter is out', () => {
	it('R40 the Runner at 0 after a PvP round: the Hunters win, the Runner is last', () => {
		const s = step(played(begin(), { a: '1', b: '9', c: '9', d: '9' }))
		expect(livesOf(s, 'a')).toBe(0)
		expect(s.result.kind).toBe('win')
		expect(s.result.winnerId).toBeNull()
		expect(winnerOf(s)).toBe('HUNTER')
		expect(placesOf(s)).toEqual([2, 1, 1, 1])
	})

	it('R40 the last Hunter at 0: the Runner wins', () => {
		const env = envOf({ hunterLives: 1 })
		const s = step(played(begin(env), { a: '9', b: '1', c: '1', d: '1' }), env)
		expect(allLives(s)).toEqual([1, 0, 0, 0])
		expect(winnerOf(s)).toBe('RUNNER')
		expect(placesOf(s)).toEqual([1, 2, 2, 2])
	})

	it('R40 a Hunter at 0 with others left is simply out', () => {
		const env = envOf({ hunterLives: 1 })
		// c and d tie the Runner above 0, so each loses one too: they start on 3
		const start = withSeat(withSeat(begin(env), 'c', { lives: 3 }), 'd', {
			lives: 3,
		})
		const s = step(played(start, { a: '9', b: '1', c: '9', d: '9' }), env)
		expect(allLives(s)).toEqual([1, 0, 2, 2])
		expect(winnerOf(s)).toBeNull()
		expect(s.lives.pending).toEqual([])
	})

	it('R40 the Runner is checked first when both sides are out', () => {
		const s = manhuntMode.checkWinner(
			withSeat(withSeat(begin(), 'a', { lives: 0, eliminated: true }), 'b', {
				lives: 0,
				eliminated: true,
			}),
			ctx,
		)
		expect(winnerOf(s)).toBe('HUNTER')
	})
})

describe('R43: a forfeit', () => {
	it('R43 the Runner forfeits: the Hunters win', () => {
		const s = step(post(begin(), 'pvp.forfeit', 'a'))
		expect(winnerOf(s)).toBe('HUNTER')
		expect(placesOf(s)).toEqual([2, 1, 1, 1])
	})

	it('R43 the last Hunter in the run forfeits: the Runner wins', () => {
		let s = begin()
		for (const id of ['b', 'c']) {
			s = step(post(s, 'pvp.forfeit', id))
			expect(winnerOf(s)).toBeNull()
		}
		s = step(post(s, 'pvp.forfeit', 'd'))
		expect(winnerOf(s)).toBe('RUNNER')
		expect(placesOf(s)).toEqual([1, 2, 2, 2])
	})

	it('R43 a Hunter forfeit with others left changes no result', () => {
		const s = step(post(begin(), 'pvp.forfeit', 'b'))
		expect(winnerOf(s)).toBeNull()
		expect(s.lives.players.b.forfeited).toBe(true)
		expect(allLives(s)).toEqual([1, 3, 3, 3])
	})

	it('R43 Hunters who left the lobby are out like a forfeit', () => {
		const left = (seatedIds: string[]) => step(begin(), { ...ENV, seatedIds })
		expect(winnerOf(left(['a']))).toBe('RUNNER')
		expect(winnerOf(left(['a', 'b']))).toBeNull()
		expect(winnerOf(left(['b', 'c', 'd']))).toBe('HUNTER')
		expect(winnerOf(left(FOUR))).toBeNull()
	})

	it('R43 onForfeit decides nothing itself: with the Runner out the tick still decides', () => {
		const gone = withSeat(begin(), 'a', { forfeited: true })
		expect(manhuntMode.onForfeit(gone, ctx)).toBe(gone)
		expect(gone.result.kind).toBeNull()
		expect(winnerOf(step(gone))).toBe('HUNTER')
	})
})

describe('R45: the Runner dying on a normal blind waits on the Hunters', () => {
	const runnerDead = (): RefereeState =>
		step(failBlind(begin(), 'a', '3:Small'))

	it('R45 the death opens a pending and decides nothing yet', () => {
		const s = runnerDead()
		expect(livesOf(s, 'a')).toBe(0)
		expect(s.lives.pending).toEqual([
			{ playerId: 'a', blindKey: '3:Small', waitsOn: HUNTERS },
		])
		expect(winnerOf(s)).toBeNull()
		expect(s.result.kind).toBeNull()
	})

	// The eliminated Runner cannot post a forfeit (the reducer refuses it); the way
	// out of the run left to it is leaving the lobby.
	it('R45 the dead Runner leaving the lobby does not end the game: the pending decides', () => {
		expect(refusal(runnerDead(), 'pvp.forfeit', 'a')).toBe('eliminated')
		let s = step(runnerDead(), { ...ENV, seatedIds: HUNTERS })
		expect(s.lives.players.a.left).toBe(true)
		expect(s.result.kind).toBeNull()
		expect(s.lives.pending).toHaveLength(1)
		// a Hunter who beats the blind settles it for the Hunters
		s = step(beatBlind(s, 'b', '3:Small'), { ...ENV, seatedIds: HUNTERS })
		expect(winnerOf(s)).toBe('HUNTER')
		expect(placesOf(s)).toEqual([2, 1, 1, 1])
	})

	// A fatal blind and a forfeit in one batch: the reducer accepts the forfeit
	// until a tick has set `eliminated`, and the log is read in order.
	it('R45 a Runner forfeit logged right after the fatal blind does not end the game: the pending decides', () => {
		let s = step(post(failBlind(begin(), 'a', '3:Small'), 'pvp.forfeit', 'a'))
		expect(s.lives.players.a.forfeited).toBe(true)
		expect(s.lives.pending).toHaveLength(1)
		expect(s.result.kind).toBeNull()
		s = step(beatBlind(s, 'b', '3:Small'))
		expect(winnerOf(s)).toBe('HUNTER')
		expect(placesOf(s)).toEqual([2, 1, 1, 1])
	})

	it('R45 the round stays open while the pending waits: Hunters playing out below the Runner cost nothing', () => {
		const env = envOf({ hunterLives: 1 })
		let s = step(failBlind(begin(env), 'a', '3:Small'), env)
		expect(s.lives.pending).toHaveLength(1)
		s = step(played(s, { a: '9', b: '1', c: '1', d: '1' }), env)
		expect(allLives(s)).toEqual([0, 1, 1, 1])
		expect(s.round.phase).toBe('playing')
		expect(s.round.lastResult).toBeNull()
		expect(s.lives.pending).toHaveLength(1)
		expect(winnerOf(s)).toBeNull()
		s = step(beatBlind(s, 'b', '3:Small'), env)
		expect(winnerOf(s)).toBe('HUNTER')
	})

	it('R45 a Hunter beating the blind gives the Hunters the win', () => {
		const s = step(beatBlind(runnerDead(), 'c', '3:Small'))
		expect(winnerOf(s)).toBe('HUNTER')
		expect(s.lives.pending).toEqual([])
	})

	it('R45 every Hunter failing the blind is a draw', () => {
		let s = runnerDead()
		for (const id of HUNTERS) s = failBlind(s, id, '3:Small')
		s = step(s)
		expect(s.result.kind).toBe('draw')
		expect(winnerOf(s)).toBeNull()
	})

	it('R45 a Hunter at 0 on a normal blind opens no pending', () => {
		const env = envOf({ hunterLives: 1 })
		const s = step(failBlind(begin(env), 'b', '3:Small'), env)
		expect(livesOf(s, 'b')).toBe(0)
		expect(s.lives.pending).toEqual([])
		expect(winnerOf(s)).toBeNull()
	})
})

describe('R44: who each player is shown to be up against', () => {
	const scored = (scores: Scores): RefereeState => played(begin(), scores)

	it('R44 every Hunter targets the Runner', () => {
		const v = viewOf(begin())
		for (const id of HUNTERS) expect(v.opponents[id]).toBe('a')
		expect(v.safe).toBeUndefined()
		expect(v.cardTargets).toBeUndefined()
		expect(v.teamScores).toBeUndefined()
	})

	it('R44 the Runner targets the Hunter with the highest round score', () => {
		expect(viewOf(scored({ b: '5', c: '9', d: '2' })).opponents.a).toBe('c')
	})

	it('R44 ties go to the smaller id', () => {
		expect(viewOf(scored({ b: '9', c: '9', d: '9' })).opponents.a).toBe('b')
		expect(viewOf(scored({ b: '1', c: '9', d: '9' })).opponents.a).toBe('c')
	})

	it('R44 a Hunter out of the run is not the Runner target; none left is null', () => {
		let s = withSeat(scored({ b: '5', c: '9', d: '2' }), 'c', {
			lives: 0,
			eliminated: true,
		})
		expect(viewOf(s).opponents.a).toBe('b')
		for (const id of HUNTERS) s = withSeat(s, id, { forfeited: true })
		const v = viewOf(s)
		expect(v.opponents.a).toBeNull()
		expect(v.opponents.b).toBe('a')
	})

	it('R44 before the roster is settled nobody has a target', () => {
		expect(viewOf(idle(null)).opponents).toEqual({})
	})
})

describe('every mode keeps round.roundId = lastStart.roundId (manhunt, 2 players)', () => {
	it('only the tick writes the round id', () => {
		const env = envOf({ ids: ['a', 'b'] })
		const start = (roundId: number): RefereeState['lastStart'] =>
			startOf(['a', 'b'], roundId, 'a')
		let state = decide(idle(start(1)), env, ctx, modeFor).state
		expect(state.round.roundId).toBe(1)
		const players = { ...state.round.players }
		for (const id of Object.keys(players))
			players[id] = {
				...players[id],
				score: id === 'a' ? '2' : '1',
				handsLeft: 0,
			}
		state = decide(
			{ ...state, round: { ...state.round, players } },
			env,
			ctx,
			modeFor,
		).state
		expect(state.round.roundId).toBe(1)
		expect(state.round.phase).toBe('resolved')
		for (const n of [2, 3]) {
			state = decide({ ...state, lastStart: start(n) }, env, ctx, modeFor).state
			if (state.result.kind !== null) break
			expect(state.round.roundId).toBe(n)
		}
		expect(state.round.roundId).toBe(3)
	})
})

// The laws, through `fromRuntime`, over random picks and random input.
describe('manhunt properties', () => {
	const ALL = ['a', 'b', 'c', 'd', 'e']
	const BLINDS = ['1:Small', '1:Big', '2:Boss', '3:Small']
	const VOUCHERS = ['v_mp_hieroglyph', 'v_mp_petroglyph']

	type Op =
		| { kind: 'ready' }
		| { kind: 'hand'; who: number; score: number; hands: number }
		| {
				kind: 'blind'
				who: number
				blind: number
				beaten: boolean
				lost: boolean
		  }
		| { kind: 'voucher'; who: number; key: number }
		| { kind: 'forfeit'; who: number }
		| { kind: 'ante'; who: number; ante: number }

	const op: fc.Arbitrary<Op> = fc.oneof(
		fc.record({ kind: fc.constant('ready' as const) }),
		fc.record({
			kind: fc.constant('hand' as const),
			who: fc.nat(4),
			score: fc.nat(20),
			hands: fc.nat(4),
		}),
		fc.record({
			kind: fc.constant('blind' as const),
			who: fc.nat(4),
			blind: fc.nat(BLINDS.length - 1),
			beaten: fc.boolean(),
			lost: fc.boolean(),
		}),
		fc.record({
			kind: fc.constant('voucher' as const),
			who: fc.nat(4),
			key: fc.nat(VOUCHERS.length - 1),
		}),
		fc.record({ kind: fc.constant('forfeit' as const), who: fc.nat(4) }),
		fc.record({
			kind: fc.constant('ante' as const),
			who: fc.nat(4),
			ante: fc.integer({ min: 1, max: 10 }),
		}),
	)

	const pick = fc.constantFrom<PvpTeam | undefined>(
		undefined,
		'RUNNER',
		'HUNTER',
		'A',
		'B',
	)
	const game = fc.record({
		n: fc.integer({ min: 2, max: 5 }),
		picks: fc.array(pick, { minLength: 5, maxLength: 5 }),
		order: fc.shuffledSubarray(ALL, { minLength: 5, maxLength: 5 }),
		ops: fc.array(op, { maxLength: 22 }),
	})

	const picksOf = (ids: string[], list: Array<PvpTeam | undefined>): Picks => {
		const picks: Picks = {}
		ids.forEach((id, i) => {
			const team = list[i]
			if (team !== undefined) picks[id] = team
		})
		return picks
	}

	// The same keys in another order.
	function reordered<T>(
		map: { [id: string]: T },
		order: string[],
	): { [id: string]: T } {
		const out: { [id: string]: T } = {}
		for (const id of order) if (map[id] !== undefined) out[id] = map[id]
		for (const id of Object.keys(map))
			if (out[id] === undefined) out[id] = map[id]
		return out
	}
	const scrambled = (state: RefereeState, order: string[]): RefereeState => ({
		...state,
		round: {
			...state.round,
			players: reordered(state.round.players, order),
		},
		lives: { ...state.lives, players: reordered(state.lives.players, order) },
	})

	function apply(state: RefereeState, ids: string[], o: Op): RefereeState {
		if (o.kind === 'ready') {
			const start = state.lastStart
			return start === null
				? state
				: { ...state, lastStart: { ...start, roundId: start.roundId + 1 } }
		}
		const id = ids[o.who % ids.length]
		const attempt = (type: string, args: object): RefereeState => {
			const r = FACT_REDUCERS[type](state, id, { runId: 'r1', ...args })
			return r.ok ? r.state : state
		}
		switch (o.kind) {
			case 'hand':
				return attempt('pvp.hand', {
					roundId: state.round.roundId,
					score: String(o.score),
					handsLeft: o.hands,
				})
			case 'blind':
				return attempt('pvp.blind', {
					blindKey: BLINDS[o.blind],
					beaten: o.beaten,
					roundLost: o.lost,
				})
			case 'voucher':
				return attempt('pvp.voucher', { voucherKey: VOUCHERS[o.key] })
			case 'forfeit':
				return attempt('pvp.forfeit', {})
			case 'ante':
				return attempt('pvp.progress', { ante: o.ante, furthestBlind: 1 })
		}
	}

	it('exactly one RUNNER for any picks, the picker when there is one', () => {
		fc.assert(
			fc.property(game, ({ n, picks: list }) => {
				const ids = ALL.slice(0, n)
				const picks = picksOf(ids, list)
				const s = begin(envOf({ ids, picks }))
				const roles = ids.map((id) => s.teams.teams[id])
				expect(roles.filter((r) => r === 'RUNNER')).toHaveLength(1)
				expect(roles.filter((r) => r === 'HUNTER')).toHaveLength(n - 1)
				const runner = ids.find((id) => s.teams.teams[id] === 'RUNNER') ?? ''
				if (ids.some((id) => picks[id] === 'RUNNER'))
					expect(picks[runner]).toBe('RUNNER')
				expect(s.lives.players[runner].lives).toBe(1)
			}),
			{ numRuns: 150 },
		)
	})

	// About 2.5 s alone; under the whole lobby suite it can pass the 5 s default.
	it('lives stay whole, events add up to the lives, a re-tick is a no-op, key order is no input', () => {
		fc.assert(
			fc.property(game, ({ n, picks: list, order, ops }) => {
				const ids = ALL.slice(0, n)
				const mix = order.filter((id) => ids.includes(id))
				const picks = picksOf(ids, list)
				const env = envOf({ ids, picks, hunterLives: 2 })
				const shuffledEnv: TickEnv = {
					...env,
					picks: reordered(picks, mix),
				}
				let s = begin(env)
				let t = begin(shuffledEnv)
				const start = ids.map((id) => s.lives.players[id].lives)
				for (const o of ops) {
					s = step(apply(s, ids, o), env)
					t = step(scrambled(apply(t, ids, o), mix), shuffledEnv)
					expect(t).toEqual(s)
					ids.forEach((id, i) => {
						const seat = s.lives.players[id]
						expect(seat.lives).toBeGreaterThanOrEqual(0)
						expect(seat.events.reduce((sum, e) => sum + e.delta, 0)).toBe(
							seat.lives - start[i],
						)
					})
					expect(
						ids.filter((id) => s.teams.teams[id] === 'RUNNER'),
					).toHaveLength(1)
					expect(decide(fromRuntime(s), env, ctx, modeFor).state).toEqual(s)
				}
			}),
			{
				numRuns: 120,
				// the Runner's voucher, its only life lost on a normal blind, then a Hunter beats it
				examples: [
					[
						{
							n: 3,
							picks: ['RUNNER', undefined, undefined, undefined, undefined],
							order: ['c', 'a', 'b', 'd', 'e'],
							ops: [
								{ kind: 'voucher', who: 0, key: 0 },
								{ kind: 'blind', who: 0, blind: 3, beaten: false, lost: true },
								{ kind: 'blind', who: 1, blind: 3, beaten: true, lost: false },
							],
						},
					],
				],
			},
		)
	}, 20_000)
})
