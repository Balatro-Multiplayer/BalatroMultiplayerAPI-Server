// A team result names the winning team and places its members first; the
// duel's `withResult` is unchanged beside it.
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { resultOf, teamResultOf, withResult, withTeamResult } from './result'
import { type RefereeState, emptyFacts } from './state'
import { emptyPvp } from './state'
import type { PvpResult, PvpTeam } from './state'

function game(teams: { [id: string]: PvpTeam }): RefereeState {
	const players: RefereeState['lives']['players'] = {}
	for (const id of Object.keys(teams))
		players[id] = {
			lives: 3,
			eliminated: false,
			forfeited: false,
			left: false,
			events: [],
		}
	const idle = emptyPvp()
	return {
		...idle,
		facts: emptyFacts(),
		runId: 'r1',
		lastStart: null,
		rules: {
			runId: 'r1',
			mode: 'manhunt',
			startedCount: Object.keys(teams).length,
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
		lives: { ...idle.lives, runId: 'r1', players },
		teams: { runId: 'r1', teams },
	}
}

const MANHUNT = game({ r: 'RUNNER', h1: 'HUNTER', h2: 'HUNTER', h3: 'HUNTER' })
const TWO_V_TWO = game({ a1: 'A', a2: 'A', b1: 'B', b2: 'B' })

const placesOf = (result: PvpResult): { [id: string]: number } =>
	Object.fromEntries(result.places.map((p) => [p.playerId, p.place]))

describe('R40 / R43 / R53 the result of a team game', () => {
	it.each<[string, RefereeState, 'win' | 'draw', PvpTeam | null, PvpResult]>([
		[
			'1 Runner + 3 Hunters, the Hunters win: three place 1, the Runner 2',
			MANHUNT,
			'win',
			'HUNTER',
			{
				runId: 'r1',
				kind: 'win',
				winnerId: null,
				winnerTeam: 'HUNTER',
				places: [
					{ playerId: 'h1', place: 1 },
					{ playerId: 'h2', place: 1 },
					{ playerId: 'h3', place: 1 },
					{ playerId: 'r', place: 2 },
				],
			},
		],
		[
			'the Runner wins: the Runner place 1, every Hunter 2',
			MANHUNT,
			'win',
			'RUNNER',
			{
				runId: 'r1',
				kind: 'win',
				winnerId: null,
				winnerTeam: 'RUNNER',
				places: [
					{ playerId: 'h1', place: 2 },
					{ playerId: 'h2', place: 2 },
					{ playerId: 'h3', place: 2 },
					{ playerId: 'r', place: 1 },
				],
			},
		],
		[
			'Teams 2v2, B wins',
			TWO_V_TWO,
			'win',
			'B',
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
			'a draw puts everyone at place 1 and names no team',
			TWO_V_TWO,
			'draw',
			null,
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
			'a draw ignores a team that was passed',
			MANHUNT,
			'draw',
			'HUNTER',
			{
				runId: 'r1',
				kind: 'draw',
				winnerId: null,
				winnerTeam: null,
				places: [
					{ playerId: 'h1', place: 1 },
					{ playerId: 'h2', place: 1 },
					{ playerId: 'h3', place: 1 },
					{ playerId: 'r', place: 1 },
				],
			},
		],
	])('%s', (_name, state, kind, team, expected) => {
		expect(teamResultOf(state, kind, team)).toEqual(expected)
		expect(withTeamResult(state, kind, team).result).toEqual(expected)
	})

	it('a seat that left or was eliminated is still placed with its team', () => {
		const state = game({ r: 'RUNNER', h1: 'HUNTER', h2: 'HUNTER' })
		const out: RefereeState = {
			...state,
			lives: {
				...state.lives,
				players: {
					...state.lives.players,
					h2: { ...state.lives.players.h2, left: true },
					r: { ...state.lives.players.r, lives: 0, eliminated: true },
				},
			},
		}
		expect(placesOf(teamResultOf(out, 'win', 'HUNTER'))).toEqual({
			r: 2,
			h1: 1,
			h2: 1,
		})
	})

	it('a seat with no team entry places 2 on a win and 1 on a draw', () => {
		const state = game({ r: 'RUNNER', h1: 'HUNTER' })
		const unlisted: RefereeState = {
			...state,
			lives: {
				...state.lives,
				players: {
					...state.lives.players,
					x: { ...state.lives.players.h1 },
				},
			},
		}
		expect(placesOf(teamResultOf(unlisted, 'win', 'HUNTER'))).toEqual({
			r: 2,
			h1: 1,
			x: 2,
		})
		expect(placesOf(teamResultOf(unlisted, 'draw', null))).toEqual({
			r: 1,
			h1: 1,
			x: 1,
		})
	})

	it('a decided result is kept: a second verdict never overwrites it', () => {
		const first = withTeamResult(MANHUNT, 'win', 'HUNTER')
		expect(withTeamResult(first, 'win', 'RUNNER')).toBe(first)
		expect(withTeamResult(first, 'draw', null)).toBe(first)
		expect(first.result.winnerTeam).toBe('HUNTER')
	})

	it('a result decided by the duel helper is kept too', () => {
		const duel = withResult(MANHUNT, 'win', 'r')
		expect(withTeamResult(duel, 'win', 'HUNTER')).toBe(duel)
	})

	it('the duel result still names no team', () => {
		expect(resultOf(MANHUNT, 'win', 'r')).toMatchObject({
			winnerId: 'r',
			winnerTeam: null,
		})
	})

	// A property: whoever wins, every seat gets a place, the winners' seats are
	// exactly the place-1 seats, and a draw has no place 2.
	it('every seat is placed once; the winning team is exactly place 1', () => {
		const team = fc.constantFrom<PvpTeam>('A', 'B')
		fc.assert(
			fc.property(
				fc.array(team, { minLength: 1, maxLength: 8 }),
				team,
				fc.boolean(),
				(members, winner, draw) => {
					const roster: { [id: string]: PvpTeam } = {}
					members.forEach((t, i) => {
						roster[`p${i}`] = t
					})
					const state = game(roster)
					const result = draw
						? teamResultOf(state, 'draw', null)
						: teamResultOf(state, 'win', winner)
					const placed = placesOf(result)
					expect(Object.keys(placed).sort()).toEqual(Object.keys(roster).sort())
					for (const id of Object.keys(roster)) {
						const expected = draw || roster[id] === winner ? 1 : 2
						expect(placed[id]).toBe(expected)
					}
				},
			),
		)
	})
})
