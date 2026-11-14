import { describe, expect, it } from 'vitest'
import { populatedPvpLobby } from '../../testing/pvp_fixtures'
import { emptyFacts, emptyPvp, refereeOf } from './state'
import type { StoredPvp } from './state'

describe('refereeOf', () => {
	const stored = (lobby = populatedPvpLobby()): StoredPvp => {
		const pvp = lobby.game.pvp as StoredPvp | undefined
		if (!pvp) throw new Error('the fixture has a pvp state')
		return pvp
	}
	const withPvp = (pvp: StoredPvp) => {
		const lobby = populatedPvpLobby()
		return { ...lobby, game: { ...lobby.game, pvp } }
	}

	it('returns a stored referee as stored, plus runId and lastStart', () => {
		const lobby = populatedPvpLobby()
		const pvp = stored(lobby)
		expect(refereeOf(lobby)).toEqual({ ...pvp.referee, runId: pvp.runId, lastStart: pvp.lastStart })
	})

	it('fills nothing in: a referee without `round` or `facts.clocks` stays without them', () => {
		const pvp = stored()
		if (!pvp.referee) throw new Error('the fixture has a referee')
		const { round: _round, ...partial } = pvp.referee
		const { clocks: _clocks, ...facts } = partial.facts
		const lobby = withPvp({ ...pvp, referee: { ...partial, facts: facts as typeof partial.facts } as unknown as StoredPvp['referee'] })
		const read = refereeOf(lobby)
		if (!read) throw new Error('the lobby has a referee')
		expect(read).not.toHaveProperty('round')
		expect(read.facts).not.toHaveProperty('clocks')
		expect(read).toEqual({ ...partial, facts, runId: pvp.runId, lastStart: pvp.lastStart })
	})

	it('a game with no referee yet reads as the idle state', () => {
		const pvp = stored()
		const { referee: _referee, ...ready } = pvp
		expect(refereeOf(withPvp(ready))).toEqual({
			...emptyPvp(),
			facts: emptyFacts(),
			runId: pvp.runId,
			lastStart: pvp.lastStart,
		})
	})
})

// One assertion per docs/pvp-match.md section 4 idle value.
describe('emptyPvp', () => {
	const idle = emptyPvp()

	it('pvp.rules', () => {
		expect(idle.rules).toEqual({ runId: null, mode: null, startedCount: 0 })
	})
	it('pvp.round', () => {
		expect(idle.round).toEqual({
			runId: null,
			roundId: 0,
			phase: 'shop',
			players: {},
			lastResult: null,
		})
	})
	it('pvp.lives', () => {
		expect(idle.lives).toEqual({
			runId: null,
			players: {},
			teamLives: null,
			pending: [],
		})
	})
	it('pvp.teams', () => {
		expect(idle.teams).toEqual({ runId: null, teams: {} })
	})
	it('pvp.votes', () => {
		expect(idle.votes).toEqual({ runId: null, draw: [], seed: [] })
	})
	it('pvp.result', () => {
		expect(idle.result).toEqual({
			runId: null,
			kind: null,
			winnerId: null,
			winnerTeam: null,
			places: [],
		})
	})
	it('cardTargets', () => {
		expect(idle.cardTargets).toBeNull()
	})
	it('has no other keys', () => {
		expect(Object.keys(idle).sort()).toEqual([
			'cardTargets',
			'lives',
			'pairing',
			'result',
			'round',
			'rules',
			'teams',
			'votes',
		])
	})
	it('is a fresh value each call', () => {
		const a = emptyPvp()
		a.votes.draw.push('x')
		expect(emptyPvp().votes.draw).toEqual([])
	})
})
