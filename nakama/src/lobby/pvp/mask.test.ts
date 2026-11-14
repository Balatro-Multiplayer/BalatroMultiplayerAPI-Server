// The score mask (docs/pvp-match.md section 4a): who sees which score, and that
// every channel that could carry a score to a masked viewer is closed (the STATE
// push, the snapshot and the snapshot request).
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { seedFromHex } from '../../actions/registry'
import { raced, reportedPlayer, unreportedPlayer } from '../../testing/pvp_fixtures'
import { withRules } from '../../testing/pvp_rules'
import { testContext } from '../../testing/request_context'
import {
	announceChange,
	announceDrift,
	changedKeys,
	matchKeys,
	matchStateOf,
} from '../match_state'
import { ServerOp, type StateMessage } from '../protocol'
import { action } from '../relay'
import { handleRequest } from '../requests'
import {
	type Lobby,
	type Outbound,
	join,
	newLobby,
	snapshotFor,
} from '../state'
import { maskedFor } from './mask'
import { openRound } from './modes/common'
import { NO_ENDS, pvpTick as tickWith } from './pvp_tick'
import {
	type PvpMode,
	type PvpRoundPlayer,
	type PvpTeam,
	type RefereeState,
	refereeOf,
	withReferee,
} from './state'
import {
	projectRound,
	projectRoundMasked,
	projectTargets,
	projectTargetsMasked,
} from './view'

// These tests end no game, so the tick gets no ends: reaching one throws.
const pvpTick = (
	lobby: Parameters<typeof tickWith>[0],
	ctx: Parameters<typeof tickWith>[1],
) => tickWith(lobby, ctx, NO_ENDS)

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

const entry = (
	score: string,
	handsLeft = 4,
	extra: Partial<PvpRoundPlayer> = {},
): PvpRoundPlayer =>
	reportedPlayer({
		score,
		handsLeft,
		reportedHands: handsLeft,
		highestScore: score,
		ante: 1,
		furthestBlind: 0,
		...extra,
	})

interface Setup {
	mode?: PvpMode
	phase?: 'playing' | 'resolved'
	// id -> round entry; every id is seated
	players: { [id: string]: PvpRoundPlayer }
	// ids that have played a hand of round 1
	played?: string[]
	teams?: { [id: string]: PvpTeam }
}

// A started game of MultiplayerPvP with the seats of `setup.players`.
function game(setup: Setup): Lobby {
	const ids = Object.keys(setup.players)
	let lobby = newLobby({
		code: 'ABCD',
		modId: 'MultiplayerPvP',
		maxPlayers: 8,
		creatorId: ids[0],
		now: 0,
		graceMs: 10_000,
	})
	for (const id of ids) lobby = join(lobby, id, `${id}-s`, info(id), 0).lobby
	lobby = { ...lobby, metadata: withRules({ ruleset: 'ruleset_mp_traditional' }) }
	for (const id of ids.slice(1))
		lobby = action(
			lobby,
			id,
			{
				cid: `r${id}`,
				action: 'mpapi_ready',
				to: 'server',
				params: { ready: true },
			},
			actionCtx,
		).lobby
	lobby = action(
		lobby,
		ids[0],
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
	const lives: { [id: string]: typeof seat } = {}
	for (const id of ids) lives[id] = seat
	const handRound: { [id: string]: number } = {}
	for (const id of setup.played ?? []) handRound[id] = 1
	return withReferee(lobby, {
		...state,
		facts: { ...state.facts, handRound },
		rules: {
			runId: 'r1',
			mode: setup.mode ?? 'royale',
			startedCount: ids.length,
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
			phase: setup.phase ?? 'playing',
			players: setup.players,
			lastResult: null,
		},
		lives: {
			runId: 'r1',
			players: lives,
			teamLives: setup.teams ? { A: 4, B: 4 } : null,
			pending: [],
		},
		teams: { runId: 'r1', teams: setup.teams ?? {} },
	})
}

function stateOf(lobby: Lobby): RefereeState {
	const s = refereeOf(lobby)
	if (!s) throw new Error('no game')
	return s
}

type Send = Extract<Outbound, { kind: 'send' }>
const stateSends = (out: Outbound[]): Send[] =>
	out.filter((o): o is Send => o.kind === 'send' && o.op === ServerOp.STATE)
const messageTo = (out: Outbound[], id: string): StateMessage => {
	const found = stateSends(out).filter((o) => o.to.includes(id))
	expect(found).toHaveLength(1)
	return found[0].payload as StateMessage
}

const four = {
	a: entry('10'),
	b: entry('20'),
	c: entry('30'),
	d: entry('40'),
}

// True when a payload carries a real score. The masked view has the keys but sends
// them null, so a masked viewer must never see one that is not.
const leaksScore = (value: unknown): boolean => {
	if (Array.isArray(value)) return value.some(leaksScore)
	if (typeof value !== 'object' || value === null) return false
	return Object.entries(value).some(
		([key, v]) =>
			((key === 'score' || key === 'highestScore') && v !== null) ||
			leaksScore(v),
	)
}

const unstartedFour = {
	a: unreportedPlayer(),
	b: unreportedPlayer(),
	c: unreportedPlayer(),
	d: unreportedPlayer(),
}

describe('maskedFor', () => {
	const base = (over: {
		phase: 'playing' | 'resolved'
		handsLeft: number
	}): Lobby =>
		game({
			phase: over.phase,
			players: { a: entry('10', over.handsLeft), b: entry('20') },
		})

	it.each<
		[string, 'playing' | 'resolved', number, number | undefined, boolean]
	>([
		['playing, no hand yet', 'playing', 4, undefined, true],
		['playing, a hand of an older round', 'playing', 4, 0, true],
		['playing, a hand of this round', 'playing', 4, 1, false],
		[
			'playing, out of hands with no hand played',
			'playing',
			0,
			undefined,
			false,
		],
		['resolved, no hand', 'resolved', 4, undefined, false],
		['resolved, a hand of this round', 'resolved', 4, 1, false],
	])('%s', (_what, phase, handsLeft, handRound, masked) => {
		const lobby = base({ phase, handsLeft })
		const state = stateOf(lobby)
		const played: { [id: string]: number } = {}
		if (handRound !== undefined) played.a = handRound
		const facts = { ...state.facts, handRound: played }
		expect(maskedFor({ ...state, facts }, 'a')).toBe(masked)
	})

	it('masks a viewer with no seat in the round while it is playing', () => {
		const state = stateOf(base({ phase: 'playing', handsLeft: 4 }))
		expect(maskedFor(state, 'spectator')).toBe(true)
	})

	it('masks nobody when there is no PvP game', () => {
		expect(maskedFor(null, 'a')).toBe(false)
	})

	it('unmasks a backstopped player: no hands left, handsSpent, a hand stamped', () => {
		const lobby = game({
			players: { a: entry('10', 0, { handsSpent: true }), b: entry('20') },
			played: ['a'],
		})
		expect(maskedFor(stateOf(lobby), 'a')).toBe(false)
		expect(maskedFor(stateOf(lobby), 'b')).toBe(true)
	})
})

describe('projectRoundMasked', () => {
	it('drops score and highestScore for every player and keeps the rest', () => {
		const lobby = game({
			players: {
				a: entry('10', 2, { handsSpent: true }),
				b: entry('20'),
			},
		})
		const masked = projectRoundMasked(lobby) as {
			[k: string]: unknown
			players: { [id: string]: { [k: string]: unknown } }
		}
		expect(masked.players.a).toEqual({
			score: null,
			handsLeft: 2,
			highestScore: null,
			ante: 1,
			furthestBlind: 0,
			timerLosses: 0,
			handsSpent: true,
			pvpLeftMs: null,
		})
		expect(masked.players.b).toEqual({
			score: null,
			handsLeft: 4,
			highestScore: null,
			ante: 1,
			furthestBlind: 0,
			timerLosses: 0,
			handsSpent: false,
			pvpLeftMs: null,
		})
		const { players: _m, ...maskedRest } = masked
		const { players: _u, ...openRest } = projectRound(lobby) as {
			players: unknown
		}
		expect(maskedRest).toEqual(openRest)
	})

	it('projects handsSpent as a boolean in the open projection too', () => {
		const lobby = game({
			players: { a: entry('10', 0, { handsSpent: true }), b: entry('20') },
		})
		const open = projectRound(lobby) as {
			players: { [id: string]: { [k: string]: unknown } }
		}
		expect(open.players.a.handsSpent).toBe(true)
		expect(open.players.b.handsSpent).toBe(false)
	})

	it('has no canTime in the masked projection (it would leak who is ahead)', () => {
		const lobby = game({ players: { a: entry('10'), b: entry('20') } })
		const masked = projectRoundMasked(lobby) as {
			players: { [id: string]: { [k: string]: unknown } }
		}
		expect('canTime' in masked.players.a).toBe(false)
		expect('canTime' in masked.players.b).toBe(false)
	})

	it('canTime is false for everyone unless the round is in its playing phase', () => {
		const lobby = game({ players: { a: entry('10'), b: entry('20') } })
		const s = stateOf(lobby)
		const playing = projectRound(lobby) as {
			players: { [id: string]: { [k: string]: unknown } }
		}
		expect(playing.players.a.canTime).toBe(false)
		const resolved = projectRound(
			withReferee(lobby, { ...s, round: { ...s.round, phase: 'resolved' } }),
		) as { players: { [id: string]: { [k: string]: unknown } } }
		expect(resolved.players.a.canTime).toBe(false)
		expect(resolved.players.b.canTime).toBe(false)
	})

	it('canTime is false for the player ahead when the ruleset has no PvP clock', () => {
		const lobby = game({
			players: { a: entry('30', 1), b: entry('20', 1) },
			played: ['a', 'b'],
		})
		const s = stateOf(lobby)
		const rules = s.rules
		if (rules.runId === null)
			throw new Error('the game helper freezes the rules')
		const timed = withReferee(lobby, {
			...s,
			rules: {
				...rules,
				clocks: { ...rules.clocks, pvp: { baseMs: 60_000, handMs: 10_000 } },
			},
		})
		const withClock = projectRound(timed) as {
			players: { [id: string]: { [k: string]: unknown } }
		}
		expect(withClock.players.a.canTime).toBe(true)
		const noClock = projectRound(lobby) as {
			players: { [id: string]: { [k: string]: unknown } }
		}
		expect(noClock.players.a.canTime).toBe(false)
	})

	it('keeps the open projection to the wire shape, canTime included', () => {
		const lobby = game({ players: { a: entry('10'), b: entry('20') } })
		const open = projectRound(lobby) as {
			players: { [id: string]: { [k: string]: unknown } }
		}
		for (const id of ['a', 'b'])
			expect(Object.keys(open.players[id])).toEqual([
				'score',
				'handsLeft',
				'highestScore',
				'ante',
				'furthestBlind',
				'timerLosses',
				'handsSpent',
				'pvpLeftMs',
				'canTime',
			])
		expect(open.players.a.score).toBe('10')
		expect(open.players.b.score).toBe('20')
	})
})

describe('openRound clears handsSpent', () => {
	it('the next round starts with hands again and no handsSpent', () => {
		const lobby = game({
			phase: 'resolved',
			players: { a: entry('10', 0, { handsSpent: true }), b: entry('20', 0) },
		})
		const opened = openRound(stateOf(lobby))
		expect(opened.round.phase).toBe('playing')
		// Every round fact is unknown again; the run's own facts are kept.
		expect(opened.round.players.a).toEqual(
			unreportedPlayer({ highestScore: '10', ante: 1, furthestBlind: 0 }),
		)
		expect(opened.round.players.a.handsSpent).toBe(false)
	})
})

describe('projectTargetsMasked', () => {
	it('has no team score', () => {
		const lobby = game({
			mode: 'teams',
			players: {
				a: entry('10'),
				b: entry('20'),
				c: entry('30'),
				d: entry('40'),
			},
			teams: { a: 'A', b: 'A', c: 'B', d: 'B' },
		})
		expect(
			(projectTargets(lobby) as { teamScores: unknown }).teamScores,
		).toEqual({
			A: '30',
			B: '70',
		})
		expect(
			(projectTargetsMasked(lobby) as { teamScores: unknown }).teamScores,
		).toBeNull()
	})

	const scores = fc.array(fc.nat({ max: 1_000_000 }).map(String), {
		minLength: 4,
		maxLength: 4,
	})
	const ids = ['a', 'b', 'c', 'd']
	const playersOf = (s: string[]): { [id: string]: PvpRoundPlayer } =>
		Object.fromEntries(ids.map((id, i) => [id, entry(s[i])]))

	// Risk 8: the order of a masked target list never derives from the score.
	it('royale: any scores give the same masked opponents and safe', () => {
		const reference = projectTargetsMasked(
			game({ players: playersOf(['0', '0', '0', '0']) }),
		)
		fc.assert(
			fc.property(scores, (s) => {
				expect(projectTargetsMasked(game({ players: playersOf(s) }))).toEqual(
					reference,
				)
			}),
			{ numRuns: 40 },
		)
	})

	it('manhunt: any scores give the same masked opponents', () => {
		const teams: { [id: string]: PvpTeam } = {
			a: 'RUNNER',
			b: 'HUNTER',
			c: 'HUNTER',
			d: 'HUNTER',
		}
		const reference = projectTargetsMasked(
			game({
				mode: 'manhunt',
				players: playersOf(['0', '0', '0', '0']),
				teams,
			}),
		)
		fc.assert(
			fc.property(scores, (s) => {
				expect(
					projectTargetsMasked(
						game({ mode: 'manhunt', players: playersOf(s), teams }),
					),
				).toEqual(reference)
			}),
			{ numRuns: 40 },
		)
	})

	it('royale: the open targets do move with the scores (so the property above has teeth)', () => {
		const a = projectTargets(game({ players: playersOf(['1', '2', '3', '4']) }))
		const b = projectTargets(game({ players: playersOf(['4', '3', '2', '1']) }))
		expect(a).not.toEqual(b)
	})
})

describe('announceChange groups the players by what they may see', () => {
	const keys = ['pvp.round', 'pvp.targets']

	it('sends the scores to the players who have played and the masked copy to the rest', () => {
		const lobby = game({ players: four, played: ['a', 'b'] })
		const step = announceChange(lobby, keys)
		expect(stateSends(step.out)).toHaveLength(2)
		const seen = messageTo(step.out, 'a')
		const hidden = messageTo(step.out, 'c')
		expect(messageTo(step.out, 'b')).toEqual(seen)
		expect(messageTo(step.out, 'd')).toEqual(hidden)
		expect(seen.rev).toBe(2)
		expect(hidden.rev).toBe(2)
		expect(JSON.stringify(seen.changed['pvp.round'])).toContain('"score":"30"')
		expect(leaksScore(hidden.changed['pvp.round'])).toBe(false)
		expect(
			(hidden.changed['pvp.targets'] as { teamScores: unknown }).teamScores,
		).toBeNull()
		expect(hidden.changed['pvp.targets']).toEqual(projectTargetsMasked(lobby))
	})

	it('sends one message with the unmasked values when nobody is masked (as before)', () => {
		const lobby = game({ players: four, played: ['a', 'b', 'c', 'd'] })
		const step = announceChange(lobby, keys)
		expect(stateSends(step.out)).toHaveLength(1)
		expect(step.out[0]).toEqual({
			kind: 'send',
			op: ServerOp.STATE,
			payload: { rev: 2, changed: matchStateOf({ ...lobby, rev: 2 }, keys) },
			to: ['a', 'b', 'c', 'd'],
		})
	})

	it('keys that carry no score are sent to a masked viewer as they are', () => {
		const lobby = game({ players: four })
		const step = announceChange(lobby, ['pvp.lives'])
		expect(stateSends(step.out)).toHaveLength(1)
		expect(Object.keys(messageTo(step.out, 'a').changed)).toEqual(['pvp.lives'])
	})

	it('gives a viewer whose mask flipped pvp.round and pvp.targets, though keys named neither', () => {
		const before = game({ players: four, played: ['a'] })
		const after = game({ players: four, played: ['a', 'b'] })
		const step = announceChange(after, ['pvp.ready'], before)
		const flipped = messageTo(step.out, 'b')
		expect(Object.keys(flipped.changed).sort()).toEqual([
			'pvp.ready',
			'pvp.round',
			'pvp.targets',
		])
		// b can now see the scores
		expect(JSON.stringify(flipped.changed['pvp.round'])).toContain(
			'"score":"30"',
		)
		// c is still masked and only gets what was named
		expect(Object.keys(messageTo(step.out, 'c').changed)).toEqual(['pvp.ready'])
		expect(flipped.rev).toBe(messageTo(step.out, 'c').rev)
	})

	it('announces a flip alone, when keys is empty', () => {
		const before = game({ players: four })
		const after = game({ players: four, played: ['a'] })
		const step = announceChange(after, [], before)
		expect(step.lobby.rev).toBe(2)
		expect(Object.keys(messageTo(step.out, 'a').changed).sort()).toEqual([
			'pvp.round',
			'pvp.targets',
		])
	})

	it('announces nothing for empty keys and no flip', () => {
		const lobby = game({ players: four })
		expect(announceChange(lobby, [], lobby)).toEqual({ lobby, out: [] })
	})
})

describe('a hand request announces per viewer (L1, L2)', () => {
	const hand = (
		lobby: Lobby,
		sender: string,
		score: string,
		handsLeft: number,
	) =>
		handleRequest(
			lobby,
			sender,
			{
				reqId: `h-${sender}-${score}-${handsLeft}`,
				type: 'pvp.hand',
				payload: {
					runId: 'r1',
					roundId: 1,
					score,
					handsLeft,
					timerLossesApplied: 0,
				},
			},
			testContext(1000),
		)

	it('L1: the opponents of a first hand are told no score; the player who played is', () => {
		const result = hand(game({ players: four }), 'a', '99', 3)
		expect(result.answer).toMatchObject({ ok: true })
		const toB = messageTo(result.pushes, 'b')
		const toA = messageTo(result.pushes, 'a')
		expect(leaksScore(toB.changed)).toBe(false)
		expect(JSON.stringify(toA.changed['pvp.round'])).toContain('"score":"99"')
	})

	it('L2: a masked viewer is never told a team score or a score-ordered target list', () => {
		const lobby = game({
			mode: 'teams',
			players: four,
			teams: { a: 'A', b: 'A', c: 'B', d: 'B' },
		})
		const result = hand(lobby, 'a', '99', 3)
		// c is masked and its masked targets did not change, so it is sent none
		expect(messageTo(result.pushes, 'c').changed['pvp.targets']).toBeUndefined()
		const masked = projectTargetsMasked(result.lobby) as { teamScores: unknown }
		expect(masked.teamScores).toBeNull()
		const toA = messageTo(result.pushes, 'a')
		expect(
			(toA.changed['pvp.targets'] as { teamScores: unknown }).teamScores,
		).toEqual({
			A: '119',
			B: '70',
		})
	})

	it('L2: a rank swap is not shown to a masked viewer by the arrival of pvp.targets', () => {
		const lobby = game({ players: four })
		const result = hand(lobby, 'a', '99', 3)
		// the real order moved (a took the top), so an unmasked viewer would be sent it
		expect(JSON.stringify(projectTargets(result.lobby))).not.toBe(
			JSON.stringify(projectTargets(lobby)),
		)
		expect(messageTo(result.pushes, 'c').changed['pvp.targets']).toBeUndefined()
		expect(messageTo(result.pushes, 'd').changed['pvp.targets']).toBeUndefined()
		// the player who played is unmasked by it and is sent the new order
		expect(messageTo(result.pushes, 'a').changed['pvp.targets']).toBeDefined()
	})

	it('the second hand of a masked viewer unmasks them: they get the scores', () => {
		let lobby = game({ players: four })
		lobby = hand(lobby, 'a', '99', 3).lobby
		const result = hand(lobby, 'b', '25', 3)
		const toB = messageTo(result.pushes, 'b')
		expect(JSON.stringify(toB.changed['pvp.round'])).toContain('"score":"99"')
		// c and d have still not played
		expect(leaksScore(messageTo(result.pushes, 'c').changed)).toBe(false)
	})

	const blindStart = (lobby: Lobby, sender: string, handsLeft: number) =>
		handleRequest(
			lobby,
			sender,
			{
				reqId: `bs-${sender}-${handsLeft}`,
				type: 'pvp.blind_start',
				payload: {
					runId: 'r1',
					roundId: 1,
					handsLeft,
					score: '0',
					timerLossesApplied: 0,
				},
			},
			testContext(1000),
		)

	it('a blind_start plays no hand: the player stays masked and no score is sent to them', () => {
		const result = blindStart(game({ players: unstartedFour }), 'a', 4)
		expect(result.answer).toMatchObject({ ok: true })
		expect(stateOf(result.lobby).facts.handRound.a).toBeUndefined()
		expect(maskedFor(stateOf(result.lobby), 'a')).toBe(true)
		for (const send of stateSends(result.pushes).filter((o) =>
			o.to.includes('a'),
		))
			expect(leaksScore(send.payload)).toBe(false)
	})

	it('a hand-adding joker: the first real hand after the blind_start counts', () => {
		// blind_start says 7 (base hands plus the joker), the first real hand leaves 6
		let lobby = game({ players: unstartedFour })
		lobby = blindStart(lobby, 'a', 7).lobby
		expect(stateOf(lobby).round.players.a.handsLeft).toBe(7)
		const result = hand(lobby, 'a', '50', 6)
		expect(result.answer).toMatchObject({ ok: true })
		expect(maskedFor(stateOf(result.lobby), 'a')).toBe(false)
		expect(stateOf(result.lobby).round.players.a).toMatchObject({
			score: '50',
			handsLeft: 6,
		})
	})

	it('a first hand that scores 0 is stamped and counts', () => {
		const result = hand(game({ players: unstartedFour }), 'a', '0', 3)
		expect(result.answer).toMatchObject({ ok: true })
		expect(stateOf(result.lobby).facts.handRound.a).toBe(1)
		expect(stateOf(result.lobby).round.players.a).toMatchObject({
			score: '0',
			handsLeft: 3,
		})
		expect(maskedFor(stateOf(result.lobby), 'a')).toBe(false)
	})

	it('a last hand that scores 0 still counts: no hands are left', () => {
		const result = hand(game({ players: unstartedFour }), 'a', '0', 0)
		expect(result.answer).toMatchObject({ ok: true })
		expect(maskedFor(stateOf(result.lobby), 'a')).toBe(false)
	})
})

describe('the tick and a drift announce a flip too', () => {
	it('a tick that puts a masked player out of hands unmasks them: targets and scores', () => {
		const lobby = game({ players: four })
		const lost = handleRequest(
			lobby,
			'c',
			{
				reqId: 'b1',
				type: 'pvp.blind',
				payload: {
					runId: 'r1',
					blindKey: '1:Small',
					beaten: false,
					roundLost: true,
				},
			},
			testContext(1000),
		)
		expect(lost.answer).toMatchObject({ ok: true })
		const ticked = pvpTick(raced(lost.lobby), testContext(1100))
		const toC = messageTo(ticked.out, 'c')
		expect(toC.changed['pvp.targets']).toBeDefined()
		expect(JSON.stringify(toC.changed['pvp.round'])).toContain('"score":"10"')
		// d has still not played a hand and stays masked
		expect(leaksScore(messageTo(ticked.out, 'd').changed)).toBe(false)
	})

	it('announceDrift: a game that leaves the playing phase unmasks the viewers it named no targets for', () => {
		const before = game({ players: four })
		const after = game({ players: four, phase: 'resolved' })
		expect(changedKeys(before, after)).not.toContain('pvp.targets')
		const step = announceDrift(before, { lobby: after, out: [] })
		const toA = messageTo(step.out, 'a')
		expect(toA.changed['pvp.targets']).toBeDefined()
		expect(JSON.stringify(toA.changed['pvp.round'])).toContain('"score":"10"')
	})
})

describe('the snapshot is masked per viewer (L1, L2)', () => {
	const lobby = game({ players: four, played: ['a'] })

	it('snapshotFor gives a viewer who has played the scores and one who has not none', () => {
		const seen = snapshotFor(lobby, 'a', 2000).match
		const hidden = snapshotFor(lobby, 'b', 2000).match
		expect(JSON.stringify(seen['pvp.round'])).toContain('"score":"30"')
		expect(leaksScore(hidden['pvp.round'])).toBe(false)
		expect(hidden['pvp.targets']).toEqual(projectTargetsMasked(lobby))
		// every other key is the same for both
		const { 'pvp.round': _r1, 'pvp.targets': _t1, ...seenRest } = seen
		const { 'pvp.round': _r2, 'pvp.targets': _t2, ...hiddenRest } = hidden
		expect(hiddenRest).toEqual(seenRest)
	})

	it('the snapshot request answers the sender with their own view', () => {
		const ask = (sender: string) => {
			const result = handleRequest(
				lobby,
				sender,
				{ reqId: `s${sender}`, type: 'snapshot', payload: {} },
				testContext(1000),
			)
			return messageTo(result.pushes, sender)
		}
		expect(ask('a').full).toBe(true)
		expect(JSON.stringify(ask('a').changed['pvp.round'])).toContain(
			'"score":"30"',
		)
		expect(leaksScore(ask('b').changed)).toBe(false)
		expect(Object.keys(ask('b').changed).sort()).toEqual(
			[...matchKeys()].sort(),
		)
	})
})
