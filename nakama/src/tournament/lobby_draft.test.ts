import { describe, expect, it } from 'vitest'
import { afterTournamentGame, draftFirstIndex, draftOrderFor, parseLobbyRef } from './lobby_draft'
import type { RoundSettings, TournamentLobbyRef } from './model'

const round = (banOrder: string | null): RoundSettings => ({
	gameMode: 'pvp_nemesis',
	ruleset: 'ruleset_mp_balanced',
	bestOf: 3,
	deck: banOrder ? ({ kind: 'draft', decks: ['b_red'], stakes: [1], banOrder } as RoundSettings['deck']) : undefined,
})
const seeds = ['top', 'mid', 'low']

describe("a tournament lobby's ban order", () => {
	it('follows the seeds', () => {
		expect(draftOrderFor(round('lower_seed_first'), seeds, ['top', 'low'])).toEqual({ first: 'low' })
		expect(draftOrderFor(round('lower_seed_first'), seeds, ['low', 'top'])).toEqual({ first: 'low' })
		expect(draftOrderFor(round('lower_seed_last'), seeds, ['low', 'top'])).toEqual({ first: 'top' })
	})

	it('leaves random and non-draft rounds to the lobby', () => {
		expect(draftOrderFor(round('random'), seeds, ['top', 'low'])).toBeUndefined()
		expect(draftOrderFor(round(null), seeds, ['top', 'low'])).toBeUndefined()
	})

	it("gives the last game's loser the first ban", () => {
		let ref: TournamentLobbyRef = { tournamentId: 't', matchId: 'W1-1', draft: draftOrderFor(round('previous_loser_first'), seeds, ['top', 'low']) }
		expect(ref.draft).toEqual({ loserFirst: true })
		// Game 1: rolled.
		expect(draftFirstIndex(ref, ['top', 'low'])).toBeNull()
		ref = afterTournamentGame(ref, [
			{ playerId: 'top', place: 2 },
			{ playerId: 'low', place: 1 },
		])
		expect(draftFirstIndex(ref, ['low', 'top'])).toBe(1)
		// A draw changes nothing.
		const drawn = afterTournamentGame(ref, [
			{ playerId: 'top', place: 1 },
			{ playerId: 'low', place: 1 },
		])
		expect(drawn).toBe(ref)
		// Other orders don't follow results.
		const fixed = { tournamentId: 't', matchId: 'W1-1', draft: { first: 'low' } }
		expect(afterTournamentGame(fixed, [{ playerId: 'low', place: 1 }, { playerId: 'top', place: 2 }])).toBe(fixed)
	})
})

describe('the lobby reads the ban order from its match parameters', () => {
	it('keeps it (it was dropped once, so the first ban was rolled)', () => {
		const ref = { tournamentId: 't', matchId: 'W1-1', draft: { first: 'low' } }
		expect(parseLobbyRef(JSON.parse(JSON.stringify(ref)))).toEqual(ref)
		expect(parseLobbyRef({ tournamentId: 't', matchId: 'W1-1', draft: { loserFirst: true } })).toEqual({ tournamentId: 't', matchId: 'W1-1', draft: { loserFirst: true } })
		expect(parseLobbyRef({ tournamentId: 't', matchId: 'W1-1', draft: { first: 5 } })).toEqual({ tournamentId: 't', matchId: 'W1-1' })
		expect(parseLobbyRef({ tournamentId: 't', matchId: 'W1-1' })).toEqual({ tournamentId: 't', matchId: 'W1-1' })
		expect(parseLobbyRef({ matchId: 'W1-1' })).toBeUndefined()
		expect(parseLobbyRef(null)).toBeUndefined()
	})
})
