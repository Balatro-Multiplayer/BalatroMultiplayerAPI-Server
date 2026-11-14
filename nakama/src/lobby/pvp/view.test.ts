import { raced, reportedPlayer } from '../../testing/pvp_fixtures'
import { readFileSync } from 'node:fs'
import { join as pathJoin } from 'node:path'
import { describe, expect, it } from 'vitest'
import { seedFromHex } from '../../actions/registry'
import { testContext } from '../../testing/request_context'
import { matchKeys, matchStateOf } from '../match_state'
import { ServerOp } from '../protocol'
import { action } from '../relay'
import { handleRequest } from '../requests'
import { type Lobby, join, newLobby } from '../state'
import { pvpTick } from './referee'
import type { Deadline } from './deadline'
import { type PvpMode, emptyFacts, refereeOf, withReferee } from './state'
import {
	projectRound,
	projectRoundMasked,
	projectSkips,
	projectTargets,
	projectTeams,
	withLiveClocks,
} from './view'
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

function pvpLobby(
	modId: string,
	start: boolean,
	ruleset = 'ruleset_mp_traditional',
): Lobby {
	const ids = ['a', 'b']
	let lobby = newLobby({
		code: 'ABCD',
		modId,
		maxPlayers: 8,
		creatorId: 'a',
		now: 0,
		graceMs: 10_000,
	})
	for (const id of ids) lobby = join(lobby, id, `${id}-s`, info(id), 0).lobby
	lobby = { ...lobby, metadata: withRules({ ruleset }) }
	if (!start) return lobby
	lobby = action(
		lobby,
		'b',
		{ cid: 'r', action: 'mpapi_ready', to: 'server', params: { ready: true } },
		actionCtx,
	).lobby
	return raced(
		action(
			lobby,
			'a',
			{ cid: 's', action: 'mpapi_start_game', to: 'server', params: {} },
			actionCtx,
		).lobby,
	)
}

const IDLE = {
	'pvp.rules': { runId: null, mode: null, startedCount: 0 },
	'pvp.round': {
		runId: null,
		roundId: 0,
		phase: 'shop',
		players: {},
		lastResult: null,
		deadline: null,
	},
	'pvp.lives': { runId: null, players: {}, teamLives: null, pending: [] },
	'pvp.targets': {
		runId: null,
		opponents: {},
		cardTargets: {},
		teamScores: null,
		safe: {},
		pairingAnte: null,
	},
	'pvp.teams': { runId: null, teams: {} },
	'pvp.votes': { runId: null, draw: [], seed: [] },
	'pvp.result': {
		runId: null,
		kind: null,
		winnerId: null,
		winnerTeam: null,
		places: [],
	},
}

const keysOf = (lobby: Lobby) => matchStateOf(lobby, Object.keys(IDLE))

describe('idle projections (section 4)', () => {
	it('a lobby that is not playing PvP projects every idle value', () => {
		expect(keysOf(pvpLobby('MultiplayerPvP', false))).toEqual(IDLE)
	})

	it('a non-PvP game projects the idle values too', () => {
		expect(keysOf(pvpLobby('MultiplayerSPDRN', true))).toEqual(IDLE)
	})

	it('a started PvP game the tick has not seen yet is still idle', () => {
		expect(keysOf(pvpLobby('MultiplayerPvP', true))).toEqual(IDLE)
	})

	it('the keys are registered', () => {
		for (const k of Object.keys(IDLE)) expect(matchKeys()).toContain(k)
	})
})

describe('pvp.skips', () => {
	function skipsLobby(deadline: Deadline | null): Lobby {
		const lobby = pvpLobby('MultiplayerPvP', true)
		const s = refereeOf(lobby)
		if (!s) throw new Error('no game')
		const entry = { skips: 0, skipsAtPvp: 0, facing: null, spentMs: 0 }
		const seat = { lives: 4, eliminated: false, forfeited: false, left: false, events: [] }
		return withReferee(lobby, {
			...s,
			runId: 'r1',
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
			lives: {
				...s.lives,
				runId: 'r1',
				players: { a: seat, b: seat },
			},
			facts: {
				...emptyFacts(),
				deadline,
				skips: {
					a: { ...entry, skips: 2, spentMs: 20_000 },
					b: entry,
				},
			},
		})
	}

	it('lists every player with the skips and the derived bank', () => {
		expect(projectSkips(skipsLobby(null))).toEqual({
			runId: 'r1',
			players: {
				a: { skips: 2, anteBankMs: 150_000 + 2 * 60_000 - 20_000 },
				b: { skips: 0, anteBankMs: 150_000 },
			},
		})
	})

	it("a starter's running server deadline shows the bank frozen at its open, not live", () => {
		const opened = 150_000 + 2 * 60_000 - 20_000
		const running: Deadline = {
			kind: 'ante',
			by: 'a',
			against: ['b'],
			endsAt: 1_000_000,
			shownMs: opened,
			n: 1,
		}
		const projected = projectSkips(skipsLobby(running))
		expect(projected).toMatchObject({
			runId: 'r1',
			players: { a: { skips: 2, anteBankMs: opened } },
		})
		// a spend recorded while it runs does not move the frozen bank
		const lobby = skipsLobby(running)
		const s = refereeOf(lobby)
		if (!s) throw new Error('no game')
		const spent = withReferee(lobby, {
			...s,
			facts: {
				...s.facts,
				skips: { ...s.facts.skips, a: { ...s.facts.skips.a, spentMs: 90_000 } },
			},
		})
		expect(projectSkips(spent)).toMatchObject({
			players: { a: { anteBankMs: opened }, b: { anteBankMs: 150_000 } },
		})
	})
})

describe('populated projections', () => {
	function filled(): Lobby {
		const lobby = pvpLobby('MultiplayerPvP', true)
		const s = refereeOf(lobby)
		if (!s) throw new Error('no game')
		return withReferee(lobby, {
			...s,
			facts: { ...emptyFacts(), applied: 3 },
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
				roundId: 3,
				phase: 'playing',
				players: {
					a: reportedPlayer({ score: '10', handsLeft: 2, reportedHands: 2, highestScore: '50', ante: 2, furthestBlind: 5 }),
				},
				lastResult: { roundId: 2, losers: ['b'] },
			},
			lives: {
				runId: 'r1',
				players: {
					a: {
						lives: 3,
						eliminated: false,
						forfeited: false,
						left: false,
						events: [{ delta: -1, key: '2:Big' }],
					},
					b: {
						lives: 4,
						eliminated: false,
						forfeited: false,
						left: false,
						events: [],
					},
				},
				teamLives: { A: 5, B: 6 },
				pending: [{ playerId: 'a', blindKey: '2:Big', waitsOn: ['b'] }],
			},
			teams: { runId: 'r1', teams: { a: 'A', b: 'B' } },
			votes: { runId: 'r1', draw: ['a'], seed: [] },
			result: {
				runId: 'r1',
				kind: 'win',
				winnerId: 'a',
				winnerTeam: null,
				places: [{ playerId: 'a', place: 1 }],
			},
		})
	}

	it('equal the section 4 JSON', () => {
		expect(keysOf(filled())).toEqual({
			'pvp.rules': {
				runId: 'r1',
				mode: 'royale',
				startedCount: 2,
				startingLives: 4,
				hunterLives: 7,
				deathOnRoundLoss: true,
				pvpStartAnte: 2,
				clocks: { ante: 'none', pvp: null, personal: null },
			},
			'pvp.round': {
				runId: 'r1',
				roundId: 3,
				phase: 'playing',
				players: {
					a: {
						score: '10',
						handsLeft: 2,
						highestScore: '50',
						ante: 2,
						furthestBlind: 5,
						timerLosses: 0,
						handsSpent: false,
						pvpLeftMs: null,
						canTime: false,
					},
				},
				lastResult: { roundId: 2, losers: ['b'] },
				deadline: null,
			},
			'pvp.lives': {
				runId: 'r1',
				players: {
					a: {
						lives: 3,
						eliminated: false,
						forfeited: false,
						left: false,
						events: [{ delta: -1, key: '2:Big' }],
					},
					b: {
						lives: 4,
						eliminated: false,
						forfeited: false,
						left: false,
						events: [],
					},
				},
				teamLives: { A: 5, B: 6 },
				pending: [{ playerId: 'a', blindKey: '2:Big', waitsOn: ['b'] }],
			},
			'pvp.targets': {
				runId: 'r1',
				opponents: { a: 'b', b: 'a' },
				cardTargets: {},
				teamScores: null,
				safe: {},
				pairingAnte: null,
			},
			'pvp.teams': { runId: 'r1', teams: { a: 'A', b: 'B' } },
			'pvp.votes': { runId: 'r1', draw: ['a'], seed: [] },
			'pvp.result': {
				runId: 'r1',
				kind: 'win',
				winnerId: 'a',
				winnerTeam: null,
				places: [{ playerId: 'a', place: 1 }],
			},
		})
	})

	it('projects no opponents for a mode with no view yet', () => {
		const lobby = filled()
		const s = refereeOf(lobby)
		if (!s) throw new Error('no game')
		const three = withReferee(lobby, {
			...s,
			rules: {
				runId: 'r1',
				mode: 'manhunt',
				startedCount: 3,
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
		})
		expect(projectTargets(three)).toEqual({
			runId: 'r1',
			opponents: {},
			cardTargets: {},
			teamScores: null,
			safe: {},
			pairingAnte: null,
		})
	})
})

// R35, R46: pvp.teams is the picks before a run and after it, the roster during it.
describe('pvp.teams shows the picks when no run is open', () => {
	// Picks made in a Manhunt lobby.
	const picked = (lobby: Lobby): Lobby => ({
		...lobby,
		metadata: withRules({ ruleset: 'ruleset_mp_traditional', ...lobby.metadata, queue_mode: 'pvp_manhunt' }),
		teamPicks: { a: 'RUNNER', b: 'HUNTER' },
	})
	const inQueue = (lobby: Lobby, queueMode: string): Lobby => ({
		...lobby,
		metadata: withRules({ ruleset: 'ruleset_mp_traditional', ...lobby.metadata, queue_mode: queueMode }),
	})
	const running = (): Lobby => {
		const lobby = picked(pvpLobby('MultiplayerPvP', true))
		const s = refereeOf(lobby)
		if (!s) throw new Error('no game')
		return withReferee(lobby, {
			...s,
			teams: { runId: 'r1', teams: { a: 'HUNTER', b: 'RUNNER' } },
		})
	}
	const teamsOf = (lobby: Lobby): unknown =>
		matchStateOf(lobby, ['pvp.teams'])['pvp.teams']

	it('a lobby shows its picks with a null run id', () => {
		expect(teamsOf(picked(pvpLobby('MultiplayerPvP', false)))).toEqual({
			runId: null,
			teams: { a: 'RUNNER', b: 'HUNTER' },
		})
	})

	it('a lobby with no picks shows an empty roster', () => {
		expect(teamsOf(pvpLobby('MultiplayerPvP', false))).toEqual({
			runId: null,
			teams: {},
		})
	})

	it('a started game the tick has not seen yet still shows the picks', () => {
		expect(teamsOf(picked(pvpLobby('MultiplayerPvP', true)))).toEqual({
			runId: null,
			teams: { a: 'RUNNER', b: 'HUNTER' },
		})
	})

	it('during a run it shows the settled roster with the run id, not the picks', () => {
		expect(teamsOf(running())).toEqual({
			runId: 'r1',
			teams: { a: 'HUNTER', b: 'RUNNER' },
		})
	})

	it('after the game ends it shows the picks again', () => {
		const ended: Lobby = {
			...running(),
			game: { ...running().game, started: null, pvp: undefined },
		}
		expect(teamsOf(ended)).toEqual({
			runId: null,
			teams: { a: 'RUNNER', b: 'HUNTER' },
		})
	})

	it.each<[string, string, unknown]>([
		[
			'the host moves the lobby to the Teams queue: Manhunt picks are hidden',
			'pvp_teams',
			{},
		],
		['a standard lobby offers no teams', 'pvp_standard', {}],
		['a Royale lobby offers no teams', 'pvp_royale', {}],
		[
			'back in the Manhunt queue the picks show again',
			'pvp_manhunt',
			{ a: 'RUNNER', b: 'HUNTER' },
		],
	])('R35, R46: %s', (_name, queueMode, teams) => {
		const lobby = inQueue(picked(pvpLobby('MultiplayerPvP', false)), queueMode)
		expect(teamsOf(lobby)).toEqual({ runId: null, teams })
		expect(lobby.teamPicks).toEqual({ a: 'RUNNER', b: 'HUNTER' })
	})

	it('only the picks the mode offers show', () => {
		const mixed: Lobby = {
			...inQueue(pvpLobby('MultiplayerPvP', false), 'pvp_teams'),
			teamPicks: { a: 'RUNNER', b: 'B', c: 'A' },
		}
		expect(teamsOf(mixed)).toEqual({ runId: null, teams: { b: 'B', c: 'A' } })
	})

	it('the picks are copied: a caller cannot change the lobby through them', () => {
		const lobby = picked(pvpLobby('MultiplayerPvP', false))
		const shown = projectTeams(lobby) as { teams: { [id: string]: string } }
		shown.teams.a = 'HUNTER'
		expect(lobby.teamPicks).toEqual({ a: 'RUNNER', b: 'HUNTER' })
	})
})

describe('registered requests', () => {
	const ctx = testContext(1000)
	const send = (lobby: Lobby, sender: string, type: string, payload: object) =>
		handleRequest(
			lobby,
			sender,
			{ reqId: `q${Math.random()}`, type, payload },
			ctx,
		)

	it('refuses with not_running outside a PvP game', () => {
		for (const lobby of [
			pvpLobby('MultiplayerPvP', false),
			pvpLobby('MultiplayerSPDRN', true),
		])
			expect(
				send(lobby, 'a', 'pvp.forfeit', { runId: 'r1' }).answer,
			).toMatchObject({ ok: false, reason: 'not_running' })
	})
	it('a fact before the first tick freezes the rules and seats the player (D1d)', () => {
		const lobby = pvpLobby('MultiplayerPvP', true)
		const r = send(lobby, 'a', 'pvp.progress', {
			runId: 'r1',
			ante: 3,
			furthestBlind: 7,
		})
		expect(r.answer).toMatchObject({ ok: true })
		expect(refereeOf(r.lobby)?.rules.runId).toBe(r.lobby.game.started?.runId)
		expect(r.changed).toBe(true)
	})

	it('records a progress fact, bumps the rev and projects it', () => {
		const lobby = pvpTick(
			pvpLobby('MultiplayerPvP', true),
			testContext(1000),
		).lobby
		const r = send(lobby, 'a', 'pvp.progress', {
			runId: 'r1',
			ante: 3,
			furthestBlind: 7,
		})
		expect(r.answer).toMatchObject({ ok: true })
		expect(r.changed).toBe(true)
		expect(matchStateOf(r.lobby, ['pvp.round'])['pvp.round']).toMatchObject({
			runId: 'r1',
			players: { a: { ante: 3, furthestBlind: 7 } },
		})
	})

	it('keeps a blind fact in the lobby without announcing a key', () => {
		const lobby = pvpTick(
			pvpLobby('MultiplayerPvP', true),
			testContext(1000),
		).lobby
		const r = send(lobby, 'b', 'pvp.blind', {
			runId: 'r1',
			blindKey: '1:Small',
			beaten: false,
			roundLost: false,
		})
		expect(r.answer).toMatchObject({ ok: true })
		expect(r.changed).toBe(false)
		expect(refereeOf(r.lobby)?.facts.blinds.b['1:Small']).toEqual({
			beaten: false,
			roundLost: false,
		})
	})

	it('a stale runId is round_over', () => {
		const lobby = pvpLobby('MultiplayerPvP', true)
		expect(
			send(lobby, 'a', 'pvp.forfeit', { runId: 'other' }).answer,
		).toMatchObject({ ok: false, reason: 'round_over' })
	})
})

describe('pvp.targets reads the picked rules view', () => {
	const withRules = (mode: PvpMode, startedCount: number): Lobby => {
		const lobby = pvpLobby('MultiplayerPvP', true)
		const s = refereeOf(lobby)
		if (!s) throw new Error('no game')
		return withReferee(lobby, {
			...s,
			rules: {
				runId: 'r1',
				mode,
				startedCount,
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
				...s.round,
				players: {
					a: reportedPlayer({ score: '0', handsLeft: 4, reportedHands: 4, highestScore: '0', ante: 1, furthestBlind: 0 }),
					b: reportedPlayer({ score: '0', handsLeft: 4, reportedHands: 4, highestScore: '0', ante: 1, furthestBlind: 0 }),
				},
			},
		})
	}

	it('a duel projects each seat opposite the other, with the idle safe and pairingAnte', () => {
		expect(projectTargets(withRules('royale', 2))).toEqual({
			runId: 'r1',
			opponents: { a: 'b', b: 'a' },
			cardTargets: {},
			teamScores: null,
			safe: {},
			pairingAnte: null,
		})
	})

	it.each<[PvpMode, number]>([
		['royale', 5],
		['nemesis', 3],
	])(
		'%s with %i players (rules without a view yet) projects the idle values under the run',
		(mode, count) => {
			expect(projectTargets(withRules(mode, count))).toEqual({
				runId: 'r1',
				opponents: {},
				cardTargets: {},
				teamScores: null,
				safe: {},
				pairingAnte: null,
			})
		},
	)
})

// The shared wire fixtures are produced by the real code: the STATE a client
// gets for a Teams 2v2 game, projected by the match's own key projections.
describe('the full-state wire fixtures', () => {
	const A = ['a1', 'a2']
	const B = ['b1', 'b2']
	const ids = [...A, ...B]
	const RUN = 'r1'
	const PVP_BLIND = '2:Boss'

	function teamsLobby(): Lobby {
		let lobby = newLobby({
			code: 'ABCD',
			modId: 'MultiplayerPvP',
			maxPlayers: 8,
			creatorId: 'a1',
			teamPlan: [A, B],
			now: 0,
			graceMs: 10_000,
		})
		for (const id of ids) lobby = join(lobby, id, `${id}-s`, info(id), 0).lobby
		lobby = { ...lobby, metadata: withRules({ ruleset: 'ruleset_mp_traditional', queue_mode: 'pvp_teams' }) }
		for (const id of ids.slice(1))
			lobby = action(
				lobby,
				id,
				{
					cid: `r-${id}`,
					action: 'mpapi_ready',
					to: 'server',
					params: { ready: true },
				},
				actionCtx,
			).lobby
		const started = action(
			lobby,
			'a1',
			{ cid: 's', action: 'mpapi_start_game', to: 'server', params: {} },
			actionCtx,
		)
		return pvpTick(raced(started.lobby), testContext(1000)).lobby
	}

	function ask(
		lobby: Lobby,
		from: string,
		type: string,
		payload: object,
		now: number,
	) {
		const reqId = `c1:${from}:${type}:${now}`
		return handleRequest(
			lobby,
			from,
			{ reqId, type, payload },
			testContext(now),
		)
	}
	function accepted(
		lobby: Lobby,
		from: string,
		type: string,
		payload: object,
		now: number,
	): Lobby {
		const r = ask(lobby, from, type, { runId: RUN, ...payload }, now)
		if (!r.answer?.ok)
			throw new Error(`${type} refused: ${JSON.stringify(r.answer)}`)
		return r.lobby
	}

	const ready = (lobby: Lobby, id: string, roundId: number, now: number) =>
		accepted(
			lobby,
			id,
			'pvp.ready',
			{ roundId, blindKey: PVP_BLIND },
			now,
		)

	// Round `roundId`: everyone Ready, the tick opens it, every player plays
	// their last hand with `scores`, and the tick resolves it.
	function playRound(
		lobby: Lobby,
		roundId: number,
		scores: { [id: string]: string },
	) {
		const now = 1000 + roundId * 10_000
		let next = lobby
		for (const id of ids) next = ready(next, id, roundId, now)
		next = pvpTick(next, testContext(now)).lobby
		for (const id of ids)
			next = accepted(
				next,
				id,
				'pvp.hand',
				{ roundId, score: scores[id], handsLeft: 0, timerLossesApplied: 0 },
				now + 5000,
			)
		return pvpTick(next, testContext(now + 5000))
	}

	// Team A scores less than team B every round, so A pays a life each time.
	const SCORES = { a1: '100', a2: '50', b1: '300', b2: '200' }

	const fixture = (name: string): unknown =>
		JSON.parse(
			readFileSync(
				pathJoin(__dirname, '..', '__fixtures__', 'net-v1', `${name}.json`),
				'utf8',
			),
		)
	const wire = (message: unknown): unknown =>
		JSON.parse(JSON.stringify(message))

	it('state_pvp_midgame: every pvp.* key of a Teams game after one resolved round', () => {
		let lobby = playRound(teamsLobby(), 1, SCORES).lobby
		lobby = accepted(
			lobby,
			'b1',
			'pvp.vote',
			{ kind: 'draw', yes: true },
			20_000,
		)
		lobby = ready(lobby, 'a1', 2, 20_000)
		const snapshot = ask(lobby, 'a2', 'snapshot', {}, 21_000).pushes[0]
		if (snapshot.kind !== 'send') throw new Error('no STATE')
		expect(wire(snapshot.payload)).toEqual(fixture('state_pvp_midgame'))
	})

	it('state_pvp_masked: a viewer who has not played a hand sees no score and no canTime', () => {
		let lobby = teamsLobby()
		for (const id of ids) lobby = ready(lobby, id, 1, 11_000)
		lobby = pvpTick(lobby, testContext(11_000)).lobby
		for (const id of ids)
			lobby = accepted(
				lobby,
				id,
				'pvp.blind_start',
				{ roundId: 1, handsLeft: 4, score: '0', timerLossesApplied: 0 },
				12_000,
			)
		lobby = accepted(
			lobby,
			'b1',
			'pvp.hand',
			{ roundId: 1, score: '300', handsLeft: 3, timerLossesApplied: 0 },
			13_000,
		)
		const snapshot = ask(lobby, 'a2', 'snapshot', {}, 14_000).pushes[0]
		if (snapshot.kind !== 'send') throw new Error('no STATE')
		expect(wire(snapshot.payload)).toEqual(fixture('state_pvp_masked'))
	})

	it('state_pvp_result: the STATE that ends a Teams game carries the result', () => {
		let lobby = teamsLobby()
		let last = playRound(lobby, 1, SCORES)
		for (const roundId of [2, 3, 4]) {
			lobby = last.lobby
			last = playRound(lobby, roundId, SCORES)
		}
		const states = last.out.filter(
			(o) => o.kind === 'send' && o.op === ServerOp.STATE,
		)
		expect(states).toHaveLength(1)
		const state = states[0]
		if (state.kind !== 'send') throw new Error('no STATE')
		expect(wire(state.payload)).toEqual(fixture('state_pvp_result'))
	})
})

describe('the personal clocks in the projections (section 4, section 8)', () => {
	const PRESSURE = 'ruleset_mp_experimental'
	const pressureGame = (): Lobby =>
		pvpTick(pvpLobby('MultiplayerPvP', true, PRESSURE), testContext(1000)).lobby
	const traditionalGame = (): Lobby =>
		pvpTick(pvpLobby('MultiplayerPvP', true), testContext(1000)).lobby
	const rulesOf = (lobby: Lobby): { clocks: unknown } =>
		matchStateOf(lobby, ['pvp.rules'])['pvp.rules'] as { clocks: unknown }

	it('pvp.rules shows the clock rules of a Pressure ruleset', () => {
		const base = refereeOf(pressureGame())?.rules
		if (!base || base.runId === null) throw new Error('no game')
		expect(rulesOf(pressureGame()).clocks).toEqual({
			ante: 'personal',
			pvp: { baseMs: 60_000, handMs: 10_000 },
			personal: {
				kind: 'pressure',
				baseMs: base.timerBaseMs * 2,
				timedRate: 2,
				previewCostMs: 3500,
			},
		})
	})

	it('pvp.rules shows a ruleset with no personal clock as personal null', () => {
		expect(rulesOf(traditionalGame()).clocks).toEqual({
			ante: 'none',
			pvp: null,
			personal: null,
		})
	})

	it('pvp.clocks is absent without a personal clock ruleset', () => {
		expect(matchStateOf(traditionalGame(), ['pvp.clocks'])['pvp.clocks']).toBe(
			undefined,
		)
		expect(matchStateOf(pvpLobby('MultiplayerPvP', false), ['pvp.clocks'])).toEqual({
			'pvp.clocks': undefined,
		})
	})

	it('pvp.clocks shows ms, running, rate, n and a boolean spent, never since or graceUntil', () => {
		const lobby = pressureGame()
		const shown = matchStateOf(lobby, ['pvp.clocks'])['pvp.clocks'] as {
			[id: string]: { [k: string]: unknown }
		}
		const base = (refereeOf(lobby)?.facts.clocks.a ?? { ms: -1 }).ms
		for (const id of ['a', 'b'])
			expect(shown[id]).toEqual({
				ms: base,
				running: true,
				rate: 1,
				n: 2,
				spent: false,
			})
	})

	it('a snapshot shows the live value of a running clock', () => {
		const lobby = pressureGame()
		const state = refereeOf(lobby)
		if (!state) throw new Error('no game')
		const match = matchStateOf(lobby, ['pvp.clocks'])
		const base = state.facts.clocks.a.ms
		const live = withLiveClocks(match, state, state.facts.clocks.a.since + 5000)
		const shown = live['pvp.clocks'] as { [id: string]: { ms: number } }
		expect(shown.a.ms).toBe(base - 5000)
		expect(shown.b.ms).toBe(base - 5000)
		// a match with no clocks is the same object
		const plain = matchStateOf(traditionalGame(), ['pvp.clocks'])
		expect(withLiveClocks(plain, refereeOf(traditionalGame()), 9)).toBe(plain)
	})

	describe('pvpLeftMs in pvp.round', () => {
		const withLeft = (): Lobby => {
			const lobby = pvpLobby('MultiplayerPvP', true)
			const s = refereeOf(lobby)
			if (!s) throw new Error('no game')
			return withReferee(lobby, {
				...s,
				round: {
					...s.round,
					players: {
						a: reportedPlayer({ pvpLeftMs: 70_000 }),
						b: reportedPlayer({ pvpLeftMs: null }),
					},
				},
			})
		}
		const leftOf = (round: unknown): unknown[] => {
			const players = (round as { players: { [id: string]: { pvpLeftMs: unknown } } })
				.players
			return [players.a.pvpLeftMs, players.b.pvpLeftMs]
		}

		it('is shown unmasked', () => {
			expect(leftOf(projectRound(withLeft()))).toEqual([70_000, null])
		})

		it('is shown masked too: a time, not a score', () => {
			expect(leftOf(projectRoundMasked(withLeft()))).toEqual([70_000, null])
		})
	})
})
