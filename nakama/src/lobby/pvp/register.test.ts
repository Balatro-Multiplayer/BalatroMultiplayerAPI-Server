// A request that changes state a PvP key is derived from announces that
// key too, though the reducer names only the keys it wrote. The mode's view is
// a stub, so the derived key (pvp.targets) moves with a score.
import { reportedPlayer } from '../../testing/pvp_fixtures'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { seedFromHex } from '../../actions/registry'
import { testContext } from '../../testing/request_context'
import { ServerOp, type StateMessage } from '../protocol'
import { action } from '../relay'
import { handleRequest } from '../requests'
import { type Lobby, type Outbound, join, newLobby } from '../state'
import type { ModeView } from './state'

// Extra fields the stub view returns beside the ones the targets read.
const viewExtras = vi.hoisted(
	(): {
		fields: {
			cardTargets?: { [id: string]: string | null }
			teamScores?: { A: string; B: string } | null
		}
	} => ({ fields: {} }),
)

vi.mock('./modes', async () => {
	const { inertMode } = await import('./modes/testing')
	return {
		modeOfGame: () => mode(),
		pickMode: () => mode(),
	}
	function mode() {
		return {
			...inertMode('royale'),
			// the score of a is what the targets read
			view: (state: ModeView) => ({
				opponents: { a: state.round.players.a?.score ?? null },
				safe: { a: true },
				pairingAnte: 3,
				...viewExtras.fields,
			}),
		}
	}
})

import { matchStateOf } from '../match_state'
import { checkTeamPick } from './register'
import { refereeOf, withReferee } from './state'
import { projectTargets } from './view'
import { withRules } from '../../testing/pvp_rules'

const info = (name: string) => ({
	displayName: name,
	preferredJoker: null,
	mods: null,
})

const actionCtx = {
	now: 1000,
	newSeed: () => seedFromHex('ab'.repeat(16)),
	newId: () => 'r1',
	random: () => 0,
}

function playing(): Lobby {
	let lobby = newLobby({
		code: 'ABCD',
		modId: 'MultiplayerPvP',
		maxPlayers: 8,
		creatorId: 'a',
		now: 0,
		graceMs: 10_000,
	})
	lobby = { ...lobby, metadata: withRules({ ruleset: 'ruleset_mp_traditional' }) }
	for (const id of ['a', 'b'])
		lobby = join(lobby, id, `${id}-s`, info(id), 0).lobby
	lobby = action(
		lobby,
		'b',
		{ cid: 'r', action: 'mpapi_ready', to: 'server', params: { ready: true } },
		actionCtx,
	).lobby
	lobby = action(
		lobby,
		'a',
		{ cid: 's', action: 'mpapi_start_game', to: 'server', params: {} },
		actionCtx,
	).lobby
	const state = refereeOf(lobby)
	if (!state) throw new Error('no game')
	const seat = {
		lives: 4,
		eliminated: false,
		forfeited: false,
		left: false,
		events: [],
	}
	const entry = reportedPlayer({
		score: '0',
		handsLeft: 4,
		reportedHands: 4,
		highestScore: '0',
		ante: 1,
		furthestBlind: 0,
	})
	return withReferee(lobby, {
		...state,
		rules: {
			runId: 'r1',
			mode: 'royale',
			startedCount: 2,
			startingLives: 4,
			hunterLives: 7,
			deathOnRoundLoss: true,
			pvpStartAnte: 2,
			clocks: { ante: 'none', pvp: null, personal: null },
			timerBaseMs: 150_000,
			timerForgiveness: 0,
			timerIncrementMs: 60_000,
			skipTimeRule: 'lead',
		},
		round: {
			runId: 'r1',
			roundId: 1,
			phase: 'playing',
			players: { a: entry, b: entry },
			lastResult: null,
		},
		lives: {
			runId: 'r1',
			players: { a: seat, b: seat },
			teamLives: null,
			pending: [],
		},
	})
}

const ctx = testContext(1000)
const hand = (lobby: Lobby, sender: string, score: string, handsLeft: number) =>
	handleRequest(
		lobby,
		sender,
		{
			reqId: `h${Math.random()}`,
			type: 'pvp.hand',
			payload: {
				runId: 'r1',
				roundId: 1,
				score,
				handsLeft,
				timerLossesApplied: 0,
			},
		},
		ctx,
	)

// The keys one player is sent (the sender is also sent the keys their mask flipped on).
const announced = (pushes: Outbound[], to?: string): string[] =>
	pushes
		.filter(
			(o) =>
				o.kind === 'send' &&
				o.op === ServerOp.STATE &&
				(to === undefined || o.to.includes(to)),
		)
		.flatMap((o) =>
			Object.keys(
				((o as Extract<Outbound, { kind: 'send' }>).payload as StateMessage)
					.changed,
			),
		)

describe('factReducer announces derived keys', () => {
	// a and b have played a hand this round, so b is not masked and reads the
	// scores, and a 0 from a is a hand spent, not the blind-start report.
	const bPlayed = (): Lobby => {
		const lobby = playing()
		const state = refereeOf(lobby)
		if (!state) throw new Error('no game')
		return withReferee(lobby, {
			...state,
			facts: { ...state.facts, handRound: { a: 1, b: 1 } },
		})
	}

	it.each([
		['a hand that moves the score the targets read', '10', 3, true],
		['a hand that only spends a hand', '0', 3, false],
	])(
		'%s: an unmasked viewer is sent pvp.targets = %s',
		(_what, score, hands, targets) => {
			const r = hand(bPlayed(), 'a', score, hands)
			expect(r.answer).toMatchObject({ ok: true })
			const keys = announced(r.pushes, 'b')
			expect(keys).toContain('pvp.round')
			expect(keys.includes('pvp.targets')).toBe(targets)
		},
	)

	it.each([
		['a hand that moves the score the targets read', '10'],
		['a hand that only spends a hand', '0'],
	])('%s: a masked viewer is never sent pvp.targets for it', (_what, score) => {
		const r = hand(playing(), 'a', score, 3)
		expect(r.answer).toMatchObject({ ok: true })
		const keys = announced(r.pushes, 'b')
		expect(keys).not.toContain('pvp.targets')
	})

	it('a hand from a player the view does not read leaves pvp.targets alone', () => {
		const keys = announced(hand(playing(), 'b', '10', 3).pushes, 'a')
		expect(keys).toContain('pvp.round')
		expect(keys).not.toContain('pvp.targets')
	})

	it('publishes canTime to an unmasked viewer and not to a masked one', () => {
		const roundOf = (pushes: Outbound[], to: string) => {
			const sent = pushes.find(
				(o): o is Extract<Outbound, { kind: 'send' }> =>
					o.kind === 'send' &&
					o.op === ServerOp.STATE &&
					o.to.includes(to) &&
					'pvp.round' in (o.payload as StateMessage).changed,
			)
			if (!sent) throw new Error('no pvp.round was sent')
			return (
				(sent.payload as StateMessage).changed['pvp.round'] as {
					players: { [id: string]: { [k: string]: unknown } }
				}
			).players.a
		}
		const open = roundOf(hand(bPlayed(), 'a', '10', 3).pushes, 'b')
		expect(typeof open.canTime).toBe('boolean')
		const masked = roundOf(hand(playing(), 'a', '10', 3).pushes, 'b')
		expect('canTime' in masked).toBe(false)
		expect(masked.score).toBeNull()
	})

	it('a key is announced once, though the reducer and the diff both name it', () => {
		const keys = announced(hand(playing(), 'a', '10', 3).pushes, 'b')
		expect(keys.filter((k) => k === 'pvp.round')).toHaveLength(1)
	})

	it('a fact that changes no key announces nothing', () => {
		const r = handleRequest(
			playing(),
			'a',
			{
				reqId: 'blind1',
				type: 'pvp.blind',
				payload: {
					runId: 'r1',
					blindKey: '1:Small',
					beaten: false,
					roundLost: false,
				},
			},
			ctx,
		)
		expect(r.answer).toMatchObject({ ok: true })
		expect(announced(r.pushes)).toEqual([])
	})
})

describe('the picked rules view fills pvp.targets', () => {
	it("takes the view's opponents, safe and pairingAnte", () => {
		expect(projectTargets(playing())).toEqual({
			runId: 'r1',
			opponents: { a: '0' },
			cardTargets: {},
			teamScores: null,
			safe: { a: true },
			pairingAnte: 3,
		})
	})

	// R51: the card targets and the team scores come from the view too.
	describe("takes the view's cardTargets and teamScores", () => {
		afterEach(() => {
			viewExtras.fields = {}
		})

		it('both fields the view returns are projected', () => {
			viewExtras.fields = {
				cardTargets: { a: 'b', b: 'a' },
				teamScores: { A: '12', B: '7' },
			}
			expect(projectTargets(playing())).toEqual({
				runId: 'r1',
				opponents: { a: '0' },
				cardTargets: { a: 'b', b: 'a' },
				teamScores: { A: '12', B: '7' },
				safe: { a: true },
				pairingAnte: 3,
			})
		})

		it('a view with neither field keeps {} and null', () => {
			expect(projectTargets(playing())).toMatchObject({
				cardTargets: {},
				teamScores: null,
			})
		})

		it('a view with only one of them leaves the other idle', () => {
			viewExtras.fields = { cardTargets: { a: null } }
			expect(projectTargets(playing())).toMatchObject({
				cardTargets: { a: null },
				teamScores: null,
			})
		})
	})
})

// R35, R46: a lobby pick works with no game running; the sender picks for
// themself only; the start rule settles the rest.
describe('pvp.team takes a lobby pick', () => {
	const QUEUE: { [mode: string]: string } = {
		manhunt: 'pvp_manhunt',
		teams: 'pvp_teams',
		standard: 'pvp_standard',
		royale: 'pvp_royale',
	}
	const lobbyOf = (mode: string): Lobby => {
		let lobby = newLobby({
			code: 'ABCD',
			modId: 'MultiplayerPvP',
			maxPlayers: 8,
			creatorId: 'a',
			now: 0,
			graceMs: 10_000,
		})
		for (const id of ['a', 'b', 'c'])
			lobby = join(lobby, id, `${id}-s`, info(id), 0).lobby
		return { ...lobby, metadata: withRules({ ruleset: 'ruleset_mp_traditional', queue_mode: QUEUE[mode] }) }
	}
	const pick = (lobby: Lobby, sender: string, payload: object) =>
		handleRequest(
			lobby,
			sender,
			{ reqId: `t${Math.random()}`, type: 'pvp.team', payload },
			ctx,
		)
	const teamsOf = (lobby: Lobby): unknown =>
		matchStateOf(lobby, ['pvp.teams'])['pvp.teams']

	it('R35: a RUNNER pick in a Manhunt lobby is answered ok and pvp.teams shows it', () => {
		const r = pick(lobbyOf('manhunt'), 'b', { team: 'RUNNER' })
		expect(r.answer).toMatchObject({ ok: true })
		expect(r.changed).toBe(true)
		expect(announced(r.pushes)).toEqual(['pvp.teams'])
		expect(teamsOf(r.lobby)).toEqual({ runId: null, teams: { b: 'RUNNER' } })
	})

	it.each<[string, string, unknown]>([
		['R35: A in a Manhunt lobby', 'manhunt', 'A'],
		['R35: B in a Manhunt lobby', 'manhunt', 'B'],
		['R46: RUNNER in a Teams lobby', 'teams', 'RUNNER'],
		['R46: HUNTER in a Teams lobby', 'teams', 'HUNTER'],
		['a royale lobby takes no team', 'royale', 'A'],
		['a royale lobby takes no HUNTER', 'royale', 'HUNTER'],
		['an unknown team', 'manhunt', 'GREEN'],
		['a lower-case team', 'teams', 'a'],
		['a team that is not text', 'teams', 1],
		['no team', 'manhunt', undefined],
	])('%s is bad_team', (_name, mode, team) => {
		const r = pick(lobbyOf(mode), 'a', team === undefined ? {} : { team })
		expect(r.answer).toMatchObject({ ok: false, reason: 'bad_team' })
		expect(r.changed).toBe(false)
	})

	it.each<[string, string]>([
		['an empty list', '[]'],
		['an array', '[1]'],
		['text', '"A"'],
		['null', 'null'],
	])('a payload that is %s is bad_team', (_name, json) => {
		const r = pick(lobbyOf('teams'), 'a', JSON.parse(json))
		expect(r.answer).toMatchObject({ ok: false, reason: 'bad_team' })
	})

	it.each<[string, string, string]>([
		['Manhunt RUNNER', 'manhunt', 'RUNNER'],
		['Manhunt HUNTER', 'manhunt', 'HUNTER'],
		['Teams A', 'teams', 'A'],
		['Teams B', 'teams', 'B'],
	])('%s is accepted', (_name, mode, team) => {
		const r = pick(lobbyOf(mode), 'c', { team })
		expect(r.answer).toMatchObject({ ok: true })
		expect(r.lobby.teamPicks).toEqual({ c: team })
	})

	it('R35: after the start the answer is running, whatever the pick', () => {
		const started = {
			...playing(),
			metadata: withRules({ ruleset: 'ruleset_mp_traditional', queue_mode: 'pvp_manhunt' }),
		}
		for (const team of ['RUNNER', 'A', 'nonsense']) {
			const r = pick(started, 'a', { team })
			expect(r.answer).toMatchObject({ ok: false, reason: 'running' })
			expect(r.changed).toBe(false)
		}
	})

	it('a sender with no seat is no_seat', () => {
		const r = pick(lobbyOf('manhunt'), 'zz', { team: 'RUNNER' })
		expect(r.answer).toMatchObject({ ok: false, reason: 'no_seat' })
	})

	// handleRequest refuses a sender with no seat first, so only a direct call
	// reaches this branch of the pure check.
	it('checkTeamPick: an id with no seat is no_seat', () => {
		expect(checkTeamPick(lobbyOf('manhunt'), 'zz', { team: 'RUNNER' })).toEqual(
			{
				ok: false,
				reason: 'no_seat',
			},
		)
	})

	it('a player picks for themself: a playerId in the payload is ignored', () => {
		const r = pick(lobbyOf('manhunt'), 'a', { team: 'HUNTER', playerId: 'b' })
		expect(r.answer).toMatchObject({ ok: true })
		expect(r.lobby.teamPicks).toEqual({ a: 'HUNTER' })
	})

	it('a second pick replaces the first', () => {
		let lobby = pick(lobbyOf('teams'), 'a', { team: 'A' }).lobby
		const r = pick(lobby, 'a', { team: 'B' })
		lobby = r.lobby
		expect(r.changed).toBe(true)
		expect(teamsOf(lobby)).toEqual({ runId: null, teams: { a: 'B' } })
	})

	it('two RUNNER picks are both kept: the start rule settles it', () => {
		let lobby = pick(lobbyOf('manhunt'), 'a', { team: 'RUNNER' }).lobby
		lobby = pick(lobby, 'b', { team: 'RUNNER' }).lobby
		expect(lobby.teamPicks).toEqual({ a: 'RUNNER', b: 'RUNNER' })
	})

	it('the same pick again answers ok and changes nothing', () => {
		const first = pick(lobbyOf('manhunt'), 'a', { team: 'RUNNER' })
		const again = pick(first.lobby, 'a', { team: 'RUNNER' })
		expect(again.answer).toMatchObject({ ok: true })
		expect(again.changed).toBe(false)
		expect(again.pushes).toEqual([])
		expect(again.lobby.teamPicks).toEqual({ a: 'RUNNER' })
	})
})
