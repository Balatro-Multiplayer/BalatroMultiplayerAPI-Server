import { describe, expect, it } from 'vitest'
import type { RunRecord } from '../lobby/protocol'
import { resolveBracket } from './engine/resolve'
import { seededRng } from './engine/seeding'
import { type RatingsLookup, advance, createTournament, joinTournament, openRegistration, start } from './lifecycle'
import {
	claimLobby,
	clearResult,
	currentMatchOf,
	extend,
	gameEnded,
	lobbiesNeeded,
	lobbyClosed,
	lobbyLost,
	lobbyOpened,
	lobbyReused,
	outcomeFromRun,
	readyUp,
	setPaused,
	setResult,
	startNextRound,
} from './matches'
import { lobbiesToClose } from './lobby_state'
import type { Input, Tournament, TournamentLobbyRef } from './model'

const MIN = 60 * 1000
const NOW = Date.UTC(2026, 10, 7, 12, 0)
const ORG = { id: 'org', name: 'Organiser' }
const noRatings: RatingsLookup = () => ({})

function value(r: { ok: true; value: Tournament } | { ok: false; error: { message: string } } | null): Tournament {
	if (!r) throw new Error('null change')
	if (!r.ok) throw new Error(r.error.message)
	return r.value
}

// A running tournament with n players p1..pn (seeded in that order).
function running(n: number, extra: Input = {}): Tournament {
	let t = value(
		createTournament(
			't1',
			ORG,
			{
				name: 'Match Cup',
				format: 'single_elim',
				maxPlayers: 8,
				startsAt: NOW + 60 * MIN,
				checkInMinutes: null,
				seeding: { kind: 'manual' },
				rounds: { defaults: { gameMode: 'pvp_nemesis', ruleset: 'ruleset_mp_balanced', bestOf: 1 } },
				timetable: { kind: 'preset', preset: 'live_event', options: { readyUpMinutes: 10, seriesReadyUpMinutes: 3 } },
				...extra,
			},
			'CODE',
			NOW,
		),
	)
	t = value(openRegistration(t, 'org', NOW))
	for (let i = 1; i <= n; i++) t = value(joinTournament(t, { id: `p${i}`, name: `P${i}` }, NOW))
	return value(start(t, NOW, noRatings, seededRng(1)))
}

function bothReady(t: Tournament, matchId: string, a: string, b: string, now = NOW): Tournament {
	return value(readyUp(value(readyUp(t, a, matchId, true, now)), b, matchId, true, now))
}

function run(status: RunRecord['status'], placements: [string, number][], runId = 'run1'): RunRecord {
	return {
		runId,
		code: 'LOBBY',
		modId: 'MultiplayerPvP',
		seed: 'S',
		stake: 1,
		options: null,
		startedAt: NOW,
		endedAt: NOW,
		status,
		placements: placements.map(([playerId, place]) => ({ playerId, place })),
		reports: {},
		players: [],
	}
}

// Readies both, claims and opens the lobby; returns the tournament and the lobby's ref.
function inLobby(t: Tournament, matchId: string, a: string, b: string): { t: Tournament; ref: TournamentLobbyRef } {
	let next = bothReady(t, matchId, a, b)
	const need = lobbiesNeeded(next).find((x) => x.matchId === matchId)
	if (!need) throw new Error('no lobby needed')
	next = value(claimLobby(next, need, 'LOBBY', NOW))
	next = value(lobbyOpened(next, matchId, need.handoff, NOW))
	return { t: next, ref: { tournamentId: next.id, matchId } }
}

describe('ready-up', () => {
	it('finds the caller\'s match, and needs a lobby once both are ready', () => {
		let t = running(4)
		expect(currentMatchOf(t, 'p1')).toBe('W1-1')
		t = value(readyUp(t, 'p1', null, true, NOW))
		expect(lobbiesNeeded(t)).toEqual([])
		t = value(readyUp(t, 'p4', null, true, NOW))
		const needs = lobbiesNeeded(t)
		expect(needs).toHaveLength(1)
		expect(needs[0]).toMatchObject({ matchId: 'W1-1', game: 1, players: ['p1', 'p4'], settings: { ruleset: 'ruleset_mp_balanced', bestOf: 1 } })
	})

	it('refuses players outside the match, and while paused', () => {
		const t = running(4)
		expect(readyUp(t, 'p2', 'W1-1', true, NOW).ok).toBe(false)
		expect(readyUp(t, 'nobody', null, true, NOW).ok).toBe(false)
		const paused = value(setPaused(t, 'org', true, NOW))
		expect(readyUp(paused, 'p1', null, true, NOW).ok).toBe(false)
	})

	it('can be taken back before the other player readies', () => {
		let t = value(readyUp(running(2), 'p1', null, true, NOW))
		t = value(readyUp(t, 'p1', null, false, NOW))
		t = value(readyUp(t, 'p2', null, true, NOW))
		expect(lobbiesNeeded(t)).toEqual([])
	})
})

describe('lobbies', () => {
	it('is claimed once per hand-off', () => {
		const t = bothReady(running(2), 'W1-1', 'p1', 'p2')
		const need = lobbiesNeeded(t)[0]
		const claimed = value(claimLobby(t, need, 'AAAAA', NOW))
		expect(lobbiesNeeded(claimed)).toEqual([])
		expect(claimLobby(claimed, need, 'BBBBB', NOW).ok).toBe(false)
	})

	it('records the lobby\'s result, then marks the lobby to close', () => {
		const { t, ref } = inLobby(running(2), 'W1-1', 'p1', 'p2')
		expect(lobbiesToClose(t)).toEqual([])
		const done = value(gameEnded(t, ref, run('agreed', [['p1', 2], ['p2', 1]]), NOW + 10 * MIN))
		expect(done.status).toBe('finished')
		expect(done.lobbies?.['W1-1']).toMatchObject({ status: 'open', runId: 'run1' })
		expect(done.events.map((e) => e.kind)).toContain('game_recorded')
		expect(lobbiesToClose(done)).toEqual([{ matchId: 'W1-1', code: 'LOBBY' }])
		const closed = value(lobbyClosed(done, 'W1-1', 'LOBBY', NOW + 11 * MIN))
		expect(closed.lobbies?.['W1-1'].status).toBe('closed')
		expect(lobbiesToClose(closed)).toEqual([])
		expect(lobbyClosed(closed, 'W1-1', 'LOBBY', NOW)).toBe(null)
	})

	it('plays a whole Bo3 in the one lobby', () => {
		let { t, ref } = inLobby(running(2, { rounds: { defaults: { gameMode: 'pvp_nemesis', ruleset: 'ruleset_mp_balanced', bestOf: 3 } } }), 'W1-1', 'p1', 'p2')
		t = value(gameEnded(t, ref, run('agreed', [['p1', 1], ['p2', 2]]), NOW + 5 * MIN))
		expect(t.clock?.matches['W1-1']).toMatchObject({ phase: 'ready_up', deadline: NOW + 8 * MIN })
		// Between games the match isn't decided: the lobby stays.
		expect(lobbiesToClose(t)).toEqual([])
		t = bothReady(t, 'W1-1', 'p1', 'p2', NOW + 6 * MIN)
		const need = lobbiesNeeded(t)[0]
		expect(need).toMatchObject({ matchId: 'W1-1', game: 2, handoff: 2 })
		t = value(lobbyReused(t, need, NOW + 6 * MIN))
		expect(t.lobbies?.['W1-1']).toMatchObject({ code: 'LOBBY', game: 2, handoff: 2, status: 'open' })
		expect(t.events[t.events.length - 1]).toMatchObject({ kind: 'lobby_opened', code: 'LOBBY', game: 2, wins: [1, 0], reused: true })
		// A run from some other lobby code doesn't count.
		expect(gameEnded(t, ref, { ...run('agreed', [['p1', 2], ['p2', 1]], 'stray'), code: 'OTHER' }, NOW)).toBe(null)
		t = value(gameEnded(t, ref, run('agreed', [['p1', 1], ['p2', 2]], 'run2'), NOW + 15 * MIN))
		expect(t.status).toBe('finished')
		expect(resolveBracket(t.bracket as NonNullable<Tournament['bracket']>).byId['W1-1'].wins).toEqual([2, 0])
	})

	it('holds a disputed game for the organisers, who settle it', () => {
		const { t, ref } = inLobby(running(2), 'W1-1', 'p1', 'p2')
		const disputed = value(gameEnded(t, ref, run('disputed', [['p1', 1], ['p2', 1]]), NOW))
		expect(disputed.lobbies?.['W1-1'].status).toBe('disputed')
		expect(disputed.clock?.matches['W1-1'].phase).toBe('in_game')
		expect(setResult(disputed, 'p1', { matchId: 'W1-1', scope: 'game', winner: 'p1' }, NOW).ok).toBe(false)
		const settled = value(setResult(disputed, 'org', { matchId: 'W1-1', scope: 'game', winner: 'p2' }, NOW))
		expect(settled.status).toBe('finished')
		expect(lobbiesToClose(settled)).toEqual([{ matchId: 'W1-1', code: 'LOBBY' }])
	})

	it('replays an abandoned game in the same lobby; a lost lobby is replaced', () => {
		const { t, ref } = inLobby(running(2), 'W1-1', 'p1', 'p2')
		const abandoned = value(gameEnded(t, ref, run('abandoned', []), NOW + MIN))
		expect(abandoned.clock?.matches['W1-1']).toMatchObject({ phase: 'ready_up', deadline: NOW + 4 * MIN })
		expect(abandoned.lobbies?.['W1-1'].status).toBe('open')
		const ready = bothReady(abandoned, 'W1-1', 'p1', 'p2', NOW + 2 * MIN)
		const need = lobbiesNeeded(ready)[0]
		expect(need).toMatchObject({ game: 1, handoff: 2 })
		const lost = value(lobbyLost(value(lobbyReused(ready, need, NOW + 2 * MIN)), 'W1-1', 2, NOW + 3 * MIN))
		expect(lost.clock?.matches['W1-1'].phase).toBe('ready_up')
		expect(lost.lobbies?.['W1-1'].status).toBe('lost')
		expect(lobbyLost(lost, 'W1-1', 2, NOW)).toBe(null)
		// The next hand-off can't reuse a lost lobby: a new one gets claimed.
		const again = bothReady(lost, 'W1-1', 'p1', 'p2', NOW + 4 * MIN)
		const next = lobbiesNeeded(again)[0]
		expect(lobbyReused(again, next, NOW).ok).toBe(false)
		expect(claimLobby(again, next, 'NEWER', NOW).ok).toBe(true)
	})

	it('reads the game from the placements', () => {
		const pair: [string, string] = ['a', 'b']
		expect(outcomeFromRun(run('agreed', [['a', 1], ['b', 2]]), pair)).toBe(0)
		expect(outcomeFromRun(run('partial', [['b', 1]]), pair)).toBe(1)
		expect(outcomeFromRun(run('agreed', [['a', 1], ['b', 1]]), pair)).toBe('draw')
		expect(outcomeFromRun(run('contested', [['a', 1], ['b', 2]]), pair)).toBe('dispute')
		expect(outcomeFromRun(run('abandoned', []), pair)).toBe('none')
	})

	it('closes every open lobby when the tournament ends', () => {
		const { t } = inLobby(running(4), 'W1-1', 'p1', 'p4')
		expect(lobbiesToClose({ ...t, status: 'cancelled' })).toEqual([{ matchId: 'W1-1', code: 'LOBBY' }])
	})
})

describe('organiser controls', () => {
	it('sets a match result, and asks before clearing later results', () => {
		let t = running(4)
		t = value(setResult(t, 'org', { matchId: 'W1-1', scope: 'match', winner: 'p4' }, NOW))
		t = value(setResult(t, 'org', { matchId: 'W1-2', scope: 'match', winner: 'p2' }, NOW))
		t = value(setResult(t, 'org', { matchId: 'W2-1', scope: 'match', winner: 'p4' }, NOW))
		expect(t.status).toBe('finished')
		// Undoing round 1 would change the final, which has a result.
		const refused = clearResult({ ...t, status: 'running' }, 'org', 'W1-1', false, NOW)
		expect(refused.ok).toBe(false)
	})

	it('reopens a match whose result was cleared', () => {
		let t = running(4)
		t = value(setResult(t, 'org', { matchId: 'W1-1', scope: 'match', winner: 'p1' }, NOW))
		expect(t.clock?.matches['W1-1'].phase).toBe('closed')
		t = value(clearResult(t, 'org', 'W1-1', false, NOW + MIN))
		expect(t.clock?.matches['W1-1']).toMatchObject({ phase: 'ready_up', openedAt: NOW + MIN })
		expect(t.events.map((e) => e.kind)).toContain('match_reset')
	})

	it('extends a deadline, and gives an unplayed match another chance', () => {
		let t = running(2, { timetable: { kind: 'preset', preset: 'live_event', options: { readyUpMinutes: 10, fallbackAfterHours: 2 } } })
		t = value(extend(t, 'org', 'W1-1', 15, NOW))
		expect(t.clock?.matches['W1-1'].deadline).toBe(NOW + 25 * MIN)
		t = advance(t, NOW + 25 * MIN, noRatings, seededRng(1)) as Tournament
		expect(t.clock?.matches['W1-1'].phase).toBe('unplayed')
		t = value(extend(t, 'org', 'W1-1', 5, NOW + 30 * MIN))
		expect(t.clock?.matches['W1-1']).toMatchObject({ phase: 'ready_up', deadline: NOW + 35 * MIN })
		expect(extend(t, 'p1', 'W1-1', 5, NOW).ok).toBe(false)
	})

	it('lets co-organisers settle results but not the organiser-only things', () => {
		let t = running(2)
		t = { ...t, coOrganiserIds: ['helper'] }
		expect(setResult(t, 'helper', { matchId: 'W1-1', scope: 'match', winner: 'p2' }, NOW).ok).toBe(true)
	})

	it('starts a manual round when the organiser says so', () => {
		let t = running(4, { timetable: { kind: 'preset', preset: 'live_fixed_rounds', options: { roundStarts: [] } } })
		t = value(setResult(t, 'org', { matchId: 'W1-1', scope: 'match', winner: 'p1' }, NOW))
		t = value(setResult(t, 'org', { matchId: 'W1-2', scope: 'match', winner: 'p2' }, NOW))
		expect(t.clock?.matches['W2-1']).toBeUndefined()
		t = value(startNextRound(t, 'org', NOW + MIN))
		expect(t.clock?.matches['W2-1']).toMatchObject({ phase: 'ready_up' })
	})
})

describe('dev bots', () => {
	it('ready up at once and lose to a human who readies', () => {
		let t = running(2)
		t = { ...t, bracket: { ...(t.bracket as NonNullable<Tournament['bracket']>), seeds: ['p1', 'dev-bot-1'] }, entrants: [t.entrants[0], { userId: 'dev-bot-1', name: 'Bot 1', joinedAt: NOW }] }
		// Rebuild the clock for the new pairing.
		t = advance({ ...t, nextWakeAt: NOW }, NOW, noRatings, seededRng(1)) as Tournament
		expect(t.clock?.matches['W1-1'].ready).toEqual([false, true])
		t = value(readyUp(t, 'p1', null, true, NOW))
		expect(t.status).toBe('finished')
		expect(resolveBracket(t.bracket as NonNullable<Tournament['bracket']>).byId['W1-1'].outcome?.winner).toBe('p1')
	})
})
