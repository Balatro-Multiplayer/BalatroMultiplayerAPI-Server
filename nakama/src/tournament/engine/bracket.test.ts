import { describe, expect, it } from 'vitest'
import { clearMatch, createBracket, decideMatch, finalPlacements, recordGame, setRoundBestOf } from './bracket'
import { resolveBracket } from './resolve'
import { players } from './test_helpers'
import type { Bracket, GameOutcome } from './types'

function single(n: number, bestOf = 1): Bracket {
	const r = createBracket('single_elim', players(n), {}, bestOf)
	if (!r.ok) throw new Error(r.error.message)
	return r.value
}

function games(b: Bracket, matchId: string, outcomes: GameOutcome[]): Bracket {
	let out = b
	for (const g of outcomes) {
		const r = recordGame(out, matchId, g)
		if (!r.ok) throw new Error(`${r.error.code}: ${r.error.message}`)
		out = r.value
	}
	return out
}

describe('createBracket', () => {
	it('refuses fewer than 2 or more than 128 entrants, duplicates, and odd series lengths', () => {
		expect(createBracket('single_elim', players(1)).ok).toBe(false)
		expect(createBracket('single_elim', players(129)).ok).toBe(false)
		expect(createBracket('single_elim', ['a', 'a']).ok).toBe(false)
		expect(createBracket('single_elim', players(4), {}, 2).ok).toBe(false)
		expect(createBracket('swiss', players(4), { swissRounds: 4 }).ok).toBe(false)
	})
})

describe('series', () => {
	it('ends a Bo3 at two wins and refuses more games', () => {
		let b = single(2, 3)
		b = games(b, 'W1-1', [0, 1])
		expect(resolveBracket(b).byId['W1-1'].status).toBe('in_progress')
		b = games(b, 'W1-1', [0])
		const m = resolveBracket(b).byId['W1-1']
		expect(m.status).toBe('done')
		expect(m.wins).toEqual([2, 1])
		expect(m.outcome?.winner).toBe('p1')
		expect(recordGame(b, 'W1-1', 0).ok).toBe(false)
	})

	it('replays drawn games in elimination', () => {
		let b = single(2, 1)
		b = games(b, 'W1-1', ['draw', 'draw'])
		expect(resolveBracket(b).byId['W1-1'].status).toBe('in_progress')
		b = games(b, 'W1-1', [1])
		expect(resolveBracket(b).byId['W1-1'].outcome?.winner).toBe('p2')
	})

	it('refuses games for a match whose players are not known yet', () => {
		const r = recordGame(single(4), 'W2-1', 0)
		expect(r.ok).toBe(false)
		if (!r.ok) expect(r.error.code).toBe('not_playable')
	})

	it('changes the series length only for rounds not started', () => {
		let b = single(4, 1)
		b = games(b, 'W1-1', [0])
		const r = setRoundBestOf(b, 'W', 1, 3)
		if (!r.ok) throw new Error(r.error.message)
		expect(r.value.matches.find((m) => m.id === 'W1-1')?.bestOf).toBe(1)
		expect(r.value.matches.find((m) => m.id === 'W1-2')?.bestOf).toBe(3)
		expect(setRoundBestOf(b, 'W', 2, 4).ok).toBe(false)
	})
})

describe('forfeits, drops and overrides', () => {
	it('advances the opponent on a forfeit', () => {
		const r = decideMatch(single(4), 'W1-1', { kind: 'forfeit', winner: 1 })
		if (!r.ok) throw new Error(r.error.message)
		const m = resolveBracket(r.value).byId['W1-1']
		expect(m.outcome).toMatchObject({ winner: 'p4', reason: 'forfeit' })
		expect(resolveBracket(r.value).byId['W2-1'].players[0]).toBe('p4')
	})

	it('gives the next opponent a bye after a double forfeit', () => {
		let b = single(4)
		const r = decideMatch(b, 'W1-1', { kind: 'double_forfeit' })
		if (!r.ok) throw new Error(r.error.message)
		b = games(r.value, 'W1-2', [0])
		const final = resolveBracket(b).byId['W2-1']
		expect(final.players).toEqual([null, 'p2'])
		expect(final.outcome).toMatchObject({ winner: 'p2', reason: 'bye' })
		expect(finalPlacements(b)[0]).toEqual({ id: 'p2', place: 1 })
	})

	it('forfeits every unfinished match of a dropped player', () => {
		const b = games(single(4), 'W1-1', [0])
		const r = resolveBracket(b, ['p1'])
		// The finished match stands; the next one is forfeited.
		expect(r.byId['W1-1'].outcome?.winner).toBe('p1')
		expect(r.byId['W1-2'].status).toBe('ready')
		const after = resolveBracket(games(b, 'W1-2', [0]), ['p1'])
		expect(after.byId['W2-1'].outcome).toMatchObject({ winner: 'p2', reason: 'dropped' })
	})

	it('refuses an override that would change a later match with results, unless told to reset it', () => {
		let b = single(4)
		b = games(b, 'W1-1', [0])
		b = games(b, 'W1-2', [0])
		b = games(b, 'W2-1', [0])
		const refused = decideMatch(b, 'W1-1', { kind: 'override', outcome: 1 })
		expect(refused.ok).toBe(false)
		if (!refused.ok) expect(refused.error).toMatchObject({ code: 'downstream_played', matchIds: ['W2-1'] })

		const reset = decideMatch(b, 'W1-1', { kind: 'override', outcome: 1 }, { resetDownstream: true })
		if (!reset.ok) throw new Error(reset.error.message)
		const final = resolveBracket(reset.value).byId['W2-1']
		expect(final.players).toEqual(['p4', 'p2'])
		expect(final.status).toBe('ready')
		expect(final.def.games).toEqual([])
	})

	it('lets an override through when it does not change any later pairing', () => {
		let b = single(4, 3)
		b = games(b, 'W1-1', [0, 0])
		b = games(b, 'W1-2', [0, 0])
		b = games(b, 'W2-1', [0])
		// Same winner, so the final keeps its game.
		const r = decideMatch(b, 'W1-1', { kind: 'override', outcome: 0 })
		if (!r.ok) throw new Error(r.error.message)
		expect(resolveBracket(r.value).byId['W2-1'].wins).toEqual([1, 0])
	})

	it('refuses a draw in elimination', () => {
		expect(decideMatch(single(2), 'W1-1', { kind: 'override', outcome: 'draw' }).ok).toBe(false)
	})

	it('undoes a decision with clearMatch', () => {
		const decided = decideMatch(single(2), 'W1-1', { kind: 'forfeit', winner: 0 })
		if (!decided.ok) throw new Error(decided.error.message)
		const cleared = clearMatch(decided.value, 'W1-1')
		if (!cleared.ok) throw new Error(cleared.error.message)
		expect(resolveBracket(cleared.value).byId['W1-1'].status).toBe('ready')
	})

	it('marks results recorded for an older pairing as stale and ignores them', () => {
		let b = single(4)
		b = games(b, 'W1-1', [0])
		b = games(b, 'W1-2', [0])
		b = games(b, 'W2-1', [0])
		// Force the earlier result to change by editing the stored data directly
		// (as if a reset had been skipped).
		b = { ...b, matches: b.matches.map((m) => (m.id === 'W1-1' ? { ...m, games: [1] as GameOutcome[], playedBy: ['p1', 'p4'] as [string, string] } : m)) }
		const final = resolveBracket(b).byId['W2-1']
		expect(final.stale).toBe(true)
		expect(final.status).toBe('ready')
	})

	it('leaves the input bracket unchanged', () => {
		const b = single(2)
		const before = JSON.stringify(b)
		games(b, 'W1-1', [0])
		decideMatch(b, 'W1-1', { kind: 'forfeit', winner: 1 })
		expect(JSON.stringify(b)).toBe(before)
	})
})
