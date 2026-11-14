// A game that started with 3+ players and is down to exactly two seated players (an
// eliminated player who is still seated counts) plays the 1v1 round rules from then on (docs/pvp-match.md section 6, R55):
// the round ends when the trailing player is out of hands, and in Nemesis the two
// fight each other. Driven through the real tick (`decide`) and the real mode pick.
import { describe, expect, it } from 'vitest'
import { opponentState, reportedPlayer } from '../../testing/pvp_fixtures'
import { withRules } from '../../testing/pvp_rules'
import { testContext } from '../../testing/request_context'
import { modeOfGame } from './modes'
import type { PvpMode, RefereeState } from './state'
import { type TickEnv, decide } from './tick'

const ctx = testContext(1000)

// `gone` seats are out of the run the way a left seat is, `dead` ones the way an
// eliminated seat is; the survivors are the two still alive.
function envOf(started: string[], seated: string[]): TickEnv {
	return {
		runId: 'run-1',
		startedIds: started,
		seatedIds: seated,
		readyIds: [],
		readiedIds: [],
		raceStarted: true,
		ranked: false,
		requiredIds: seated,
		awayIds: [],
		metadata: withRules({ ruleset: 'ruleset_mp_balanced' }),
		picks: {},
		teamPlan: null,
	}
}

function playing(
	mode: PvpMode,
	ids: string[],
	over: Partial<Parameters<typeof opponentState>[0]>,
	hands: { [id: string]: { score: string; handsLeft: number } },
): RefereeState {
	const base = opponentState({ mode, ids, roundId: 1, ...over })
	const players = { ...base.round.players }
	for (const id of ids) players[id] = reportedPlayer(hands[id])
	return { ...base, round: { ...base.round, players } }
}

// a leads with hands left, b trails and is out of hands
const TRAILING_OUT = {
	a: { score: '20', handsLeft: 2 },
	b: { score: '10', handsLeft: 0 },
	c: { score: '0', handsLeft: 0 },
	d: { score: '0', handsLeft: 0 },
}

describe('the last two players of a 3+ game', () => {
	it.each(['royale', 'nemesis'] as const)(
		'%s: two eliminated but still seated keep the 3+ rules, the round waits for the survivors',
		(mode) => {
			const state = playing(
				mode,
				['a', 'b', 'c', 'd'],
				{ out: ['c', 'd'], partners: { a: 'c', c: 'a', b: 'd', d: 'b' } },
				TRAILING_OUT,
			)
			const out = decide(state, envOf(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd']), ctx)
			expect(out.state.round.phase).toBe('playing')
			expect(modeOfGame(out.state)?.finalTwo).toBeUndefined()
		},
	)

	it.each(['royale', 'nemesis'] as const)(
		'%s: two who left the lobby, the round ends when the trailing player is out of hands',
		(mode) => {
			const state = playing(
				mode,
				['a', 'b', 'c', 'd'],
				{ partners: { a: 'c', c: 'a', b: 'd', d: 'b' } },
				TRAILING_OUT,
			)
			const out = decide(state, envOf(['a', 'b', 'c', 'd'], ['a', 'b']), ctx)
			expect(out.state.round.phase).toBe('resolved')
			expect(out.state.round.lastResult).toEqual({ roundId: 1, losers: ['b'] })
		},
	)

	it('three alive still wait on every alive player', () => {
		const state = playing(
			'royale',
			['a', 'b', 'c', 'd'],
			{ out: ['d'] },
			{
				...TRAILING_OUT,
				c: { score: '30', handsLeft: 2 },
			},
		)
		const out = decide(state, envOf(['a', 'b', 'c', 'd'], ['a', 'b', 'c', 'd']), ctx)
		expect(out.state.round.phase).toBe('playing')
	})

	it('nemesis: C leaves mid-ante while paired with B, A and B fight each other', () => {
		const ids = ['a', 'b', 'c']
		const state = playing(
			'nemesis',
			ids,
			{ partners: { a: null, b: 'c', c: 'b' } },
			{
				a: { score: '5', handsLeft: 0 },
				b: { score: '10', handsLeft: 0 },
				c: { score: '99', handsLeft: 0 },
			},
		)
		const out = decide(state, envOf(ids, ['a', 'b']), ctx)
		expect(out.state.round.phase).toBe('resolved')
		expect(out.state.round.lastResult).toEqual({ roundId: 1, losers: ['a'] })
	})

	it('the targets are the two seated players, not the first other seats', () => {
		const state = playing('royale', ['a', 'b', 'c', 'd'], {}, TRAILING_OUT)
		const out = decide(state, envOf(['a', 'b', 'c', 'd'], ['c', 'd']), ctx)
		const mode = modeOfGame(out.state)
		expect(mode?.view?.(out.state).opponents).toEqual({ c: 'd', d: 'c' })
	})

	it('manhunt and teams keep their own rules at two alive', () => {
		for (const name of ['manhunt', 'teams'] as const) {
			const state = playing(
				name,
				['a', 'b', 'c', 'd'],
				{
					out: ['c', 'd'],
					teams:
						name === 'manhunt'
							? { a: 'RUNNER', b: 'HUNTER', c: 'HUNTER', d: 'HUNTER' }
							: { a: 'A', b: 'B', c: 'A', d: 'B' },
				},
				TRAILING_OUT,
			)
			expect(modeOfGame(state)?.name).toBe(name)
		}
	})
})
