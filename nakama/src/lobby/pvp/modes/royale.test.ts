import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
// The Royale rules (rules R22-R26 of docs/pvp-match.md): rank-and-cut round resolution,
// the live target + safe marker, and one tick-level round of three players.
import { raced, reportedPlayer } from '../../../testing/pvp_fixtures'
import { withRules } from '../../../testing/pvp_rules'
import { testContext } from '../../../testing/request_context'
import { fromRuntime } from '../../../testing/runtime_state'
import { ServerOp } from '../../protocol'
import { action } from '../../relay'
import { handleRequest } from '../../requests'
import { type Lobby, type Outbound, join, newLobby } from '../../state'
import { NO_ENDS, pvpTick as tickWith } from '../pvp_tick'
import { pvpOf, readyReducer } from '../ready'
import { compare } from '../score'
import { type ModeView, emptyPvp, refereeOf } from '../state'
import { pickMode } from './index'
import { rankRoyale, royaleMode } from './royale'

// These tests end no game, so the tick gets no ends: reaching one throws.
const pvpTick = (
	lobby: Parameters<typeof tickWith>[0],
	ctx: Parameters<typeof tickWith>[1],
) => tickWith(lobby, ctx, NO_ENDS)

const ctx = testContext(0)
const RUN = 'r1'

// A Royale that has started and opened round 1: one seat per score, named p1...
// with `hands` left each. init and roundReady are the real hooks.
function playing(
	scores: string[],
	hands: number[] = scores.map(() => 0),
): ModeView {
	const s = emptyPvp()
	s.rules = {
		runId: RUN,
		mode: 'royale',
		startedCount: scores.length,
		startingLives: 4,
		hunterLives: 7,
		deathOnRoundLoss: true,
		pvpStartAnte: 2,
		clocks: { ante: 'none', pvp: null, personal: null },
		timerBaseMs: 150_000,
		timerForgiveness: 0,
		timerIncrementMs: 60_000,
		skipTimeRule: 'lead',
	}
	for (let i = 0; i < scores.length; i++) {
		const id = `p${i + 1}`
		s.lives.players[id] = {
			lives: 0,
			eliminated: false,
			forfeited: false,
			left: false,
			events: [],
		}
		s.round.players[id] = reportedPlayer({
			score: '0',
			handsLeft: 4,
			reportedHands: 4,
			highestScore: '0',
			ante: 1,
			furthestBlind: 0,
		})
	}
	const opened = royaleMode.roundReady(
		royaleMode.init(s, ctx, { startedIds: [], picks: {}, teamPlan: null }),
		ctx,
	)
	const players = { ...opened.round.players }
	scores.forEach((score, i) => {
		players[`p${i + 1}`] = {
			...players[`p${i + 1}`],
			score,
			handsLeft: hands[i],
		}
	})
	return { ...opened, round: { ...opened.round, players } }
}

const entries = (scores: string[]) =>
	scores.map((score, i) => ({ id: `p${i + 1}`, score }))
const ids = (...n: number[]) => n.map((i) => `p${i}`)

// A seat that is out of the run (R22: never ranked, never waited for).
function out(
	state: ModeView,
	id: string,
	seat: Partial<ModeView['lives']['players'][string]>,
): ModeView {
	return {
		...state,
		lives: {
			...state.lives,
			players: {
				...state.lives.players,
				[id]: { ...state.lives.players[id], ...seat },
			},
		},
	}
}

describe('R23 rank-and-cut (referee_rank_royale 1174-1207)', () => {
	it.each<[string, string[], number[]]>([
		['three players: the lowest', ['100', '200', '300'], [1]],
		['four players: the two lowest', ['100', '200', '300', '400'], [1, 2]],
		[
			'a tie at the cut folds into the losers',
			['100', '200', '200', '400'],
			[1, 2, 3],
		],
		[
			'the cut is under a tied top (only the lowest loses)',
			['100', '300', '300', '300'],
			[1],
		],
		[
			'the moved cut folds its own tie (both 100s lose)',
			['100', '100', '400', '400', '400', '400'],
			[1, 2],
		],
		['everyone tied: nobody loses', ['500', '500', '500'], []],
		['five players: the two lowest', ['5', '4', '3', '2', '1'], [4, 5]],
		[
			'Talisman strings, not text order ("300,1" is 10^300)',
			['300,1', '9007199254740991', '12', '1000'],
			[3, 4],
		],
		['a score is a string of digits, not a number', ['100', '99', '1000'], [2]],
	])('%s', (_name, scores, losers) => {
		expect(rankRoyale(entries(scores)).losers.sort()).toEqual(ids(...losers))
	})

	it('ranks ascending by score, ties by id', () => {
		expect(rankRoyale(entries(['300', '100', '300', '200'])).ranked).toEqual(
			ids(2, 4, 1, 3),
		)
	})

	describe('properties over 3-8 alive players', () => {
		// A small range so ties are common; some scores are arrays ("20,1" is 10^20)
		const scoreArb = fc.oneof(
			fc.nat({ max: 20 }).map(String),
			fc.integer({ min: 20, max: 24 }).map((n) => `${n},1`),
		)
		const fieldArb = fc.array(scoreArb, { minLength: 3, maxLength: 8 })

		it('the top scorer never loses and someone survives', () => {
			fc.assert(
				fc.property(fieldArb, (scores) => {
					const { ranked, losers } = rankRoyale(entries(scores))
					const top = ranked[ranked.length - 1]
					expect(losers).not.toContain(top)
					expect(losers.length).toBeLessThan(ranked.length)
				}),
			)
		})

		it('how many lose: someone unless all tie, and at least floor(N/2) when the cut is below the top', () => {
			fc.assert(
				fc.property(fieldArb, (scores) => {
					const { losers } = rankRoyale(entries(scores))
					const ascending = [...scores].sort(compare)
					const top = ascending[ascending.length - 1]
					const half = Math.max(1, Math.floor(scores.length / 2))
					if (compare(ascending[0], top) !== 0)
						expect(losers.length).toBeGreaterThanOrEqual(1)
					if (compare(top, ascending[half - 1]) > 0)
						expect(losers.length).toBeGreaterThanOrEqual(half)
				}),
			)
		})

		it('every loser scores no more than every survivor', () => {
			fc.assert(
				fc.property(fieldArb, (scores) => {
					const all = entries(scores)
					const { losers } = rankRoyale(all)
					const lost = all.filter((p) => losers.includes(p.id))
					const kept = all.filter((p) => !losers.includes(p.id))
					for (const l of lost)
						for (const k of kept)
							expect(compare(l.score, k.score)).toBeLessThanOrEqual(0)
				}),
			)
		})

		it('input order does not change the result', () => {
			fc.assert(
				fc.property(
					fieldArb.chain((scores) =>
						fc.tuple(
							fc.constant(entries(scores)),
							fc.shuffledSubarray(entries(scores), {
								minLength: scores.length,
								maxLength: scores.length,
							}),
						),
					),
					([a, b]) => {
						expect(rankRoyale(b)).toEqual(rankRoyale(a))
					},
				),
			)
		})

		it('the same input gives the same output', () => {
			fc.assert(
				fc.property(fieldArb, (scores) => {
					expect(rankRoyale(entries(scores))).toEqual(
						rankRoyale(entries(scores)),
					)
				}),
			)
		})
	})
})

describe('R22-R25 resolveRound', () => {
	const resolve = (s: ModeView) => royaleMode.resolveRound(s, ctx)

	it.each<[string, string[], number[]]>([
		['R22 three players: the lowest loses', ['100', '200', '300'], [1]],
		['R22 four players: the two lowest lose', ['4', '3', '2', '1'], [3, 4]],
		['R24 two alive after a 3+ start: the lower one', ['100', '200'], [1]],
		['R24 two alive tied: nobody', ['100', '100'], []],
		['R23 everyone tied: nobody', ['7', '7', '7'], []],
	])('%s', (_name, scores, losers) => {
		const s = resolve(playing(scores))
		expect(s.round.phase).toBe('resolved')
		expect(s.round.lastResult?.roundId).toBe(s.round.roundId)
		expect([...(s.round.lastResult?.losers ?? [])].sort()).toEqual(
			ids(...losers),
		)
	})

	it('A5 an unreported score ranks below every reported one', () => {
		const s = playing(['100', '200', '300'])
		const unreported: ModeView = {
			...s,
			round: {
				...s.round,
				players: {
					...s.round.players,
					p2: { ...s.round.players.p2, score: null },
				},
			},
		}
		const r = resolve(unreported)
		expect(r.round.phase).toBe('resolved')
		expect(r.round.lastResult?.losers).toEqual(['p2'])
	})

	it('R22 resolves once the last alive player runs out of hands, not before', () => {
		const waiting = playing(['100', '200', '300'], [0, 0, 2])
		expect(resolve(waiting)).toBe(waiting)
		const done = resolve(playing(['100', '200', '300'], [0, 0, 0]))
		expect(done.round.phase).toBe('resolved')
	})

	it('R22 one alive player with hands left holds the round, with 4 players', () => {
		const s = playing(['100', '200', '300', '400'], [0, 1, 0, 0])
		expect(resolve(s)).toBe(s)
	})

	it.each<[string, Partial<ModeView['lives']['players'][string]>]>([
		['dead', { lives: 0, eliminated: true }],
		['forfeited', { forfeited: true }],
		['left', { left: true }],
	])('R22 a %s player is not ranked and not waited for', (_n, seat) => {
		// p1 has the lowest score and 3 hands left, but is out of the run
		const s = out(playing(['1', '200', '300', '400'], [3, 0, 0, 0]), 'p1', seat)
		const r = resolve(s)
		expect(r.round.phase).toBe('resolved')
		expect([...(r.round.lastResult?.losers ?? [])].sort()).toEqual(ids(2))
	})

	it('R22 fewer than two alive: nothing to resolve', () => {
		const s = out(
			out(playing(['1', '2', '3']), 'p1', { eliminated: true }),
			'p2',
			{
				forfeited: true,
			},
		)
		expect(resolve(s)).toBe(s)
	})

	it('R22 resolves once: a resolved round, a settled game and a shop stay put', () => {
		const s = resolve(playing(['100', '200', '300']))
		expect(resolve(s)).toBe(s)
		const shop = {
			...playing(['1', '2', '3']),
			round: { ...playing(['1', '2', '3']).round, phase: 'shop' as const },
		}
		expect(resolve(shop)).toBe(shop)
		const decided: ModeView = {
			...playing(['1', '2', '3']),
			result: {
				runId: RUN,
				kind: 'draw',
				winnerId: null,
				winnerTeam: null,
				places: [],
			},
		}
		expect(resolve(decided)).toBe(decided)
	})

	it('R22 never writes the roundId or a life', () => {
		const before = playing(['100', '200', '300'])
		const after = resolve(before)
		expect(after.round.roundId).toBe(before.round.roundId)
		expect(after.lives).toEqual(before.lives)
	})

	it('R22 compares scores as Talisman strings', () => {
		const s = resolve(playing(['20,1', '9007199254740991', '12']))
		expect(s.round.lastResult?.losers).toEqual(ids(3))
	})

	it('R25 reuses the duel checkWinner: one alive wins, none draws', () => {
		const one = out(
			out(playing(['1', '2', '3']), 'p1', { eliminated: true }),
			'p2',
			{
				eliminated: true,
			},
		)
		const won = royaleMode.checkWinner(one, ctx)
		expect(won.result).toMatchObject({ kind: 'win', winnerId: 'p3' })
		const none = out(one, 'p3', { eliminated: true })
		expect(royaleMode.checkWinner(none, ctx).result.kind).toBe('draw')
		const many = playing(['1', '2', '3'])
		expect(royaleMode.checkWinner(many, ctx)).toBe(many)
	})
})

describe('R26 view (broadcast_royale_targets 1278-1292)', () => {
	it.each<[string, string[], { [id: string]: string | null }, number[]]>([
		[
			'a loser targets the next higher, a safe player the next lower',
			['100', '200', '300'],
			{ p1: 'p2', p2: 'p1', p3: 'p2' },
			[2, 3],
		],
		[
			'four players: two losers, two safe',
			['100', '200', '300', '400'],
			{ p1: 'p2', p2: 'p3', p3: 'p2', p4: 'p3' },
			[3, 4],
		],
		[
			'a tie at the cut: the folded player is a loser',
			['100', '200', '200', '400'],
			{ p1: 'p2', p2: 'p3', p3: 'p4', p4: 'p3' },
			[4],
		],
		[
			'all tied: every player shows unsafe and targets the next higher',
			['5', '5', '5'],
			{ p1: 'p2', p2: 'p3', p3: null },
			[],
		],
	])('%s', (_name, scores, opponents, safeIds) => {
		const v = royaleMode.view?.(
			playing(
				scores,
				scores.map(() => 4),
			),
		)
		expect(v?.opponents).toEqual(opponents)
		expect(v?.safe).toEqual(
			Object.fromEntries(
				Object.keys(opponents).map((id) => [
					id,
					safeIds.includes(Number(id.slice(1))),
				]),
			),
		)
		expect(v).not.toHaveProperty('pairingAnte')
	})

	it('the highest of an all-tied field has no next-higher', () => {
		// 2 alive tied: p1 (id order first) is ranked lower, both count as losers
		const v = royaleMode.view?.(
			out(playing(['5', '5', '5']), 'p3', { eliminated: true }),
		)
		expect(v?.opponents).toEqual({ p1: 'p2', p2: null })
		expect(v?.safe).toEqual({ p1: false, p2: false })
	})

	it('a dead, forfeited or left player gets no entry', () => {
		const s = out(playing(['1', '200', '300', '400']), 'p1', { left: true })
		const v = royaleMode.view?.(s)
		expect(Object.keys(v?.opponents ?? {})).toEqual(['p2', 'p3', 'p4'])
		expect(Object.keys(v?.safe ?? {})).toEqual(['p2', 'p3', 'p4'])
	})

	it('fewer than two alive: empty opponents and safe', () => {
		const s = out(
			out(playing(['1', '2', '3']), 'p1', { eliminated: true }),
			'p2',
			{
				forfeited: true,
			},
		)
		expect(royaleMode.view?.(s)).toEqual({ opponents: {}, safe: {} })
	})

	it('two alive after a 3+ start: the lower targets the higher and the higher the lower', () => {
		const v = royaleMode.view?.(playing(['100', '200']))
		expect(v).toEqual({
			opponents: { p1: 'p2', p2: 'p1' },
			safe: { p1: false, p2: true },
		})
	})

	it('is picked for a 3+ game of the royale mode', () => {
		expect(pickMode('royale', 3)).toBe(royaleMode)
		expect(pickMode('royale', 5)).toBe(royaleMode)
	})
})

// One full PvP round of three players through the real tick (the picked rules).
describe('tick: a round of three (R22, R26)', () => {
	const info = (name: string) => ({
		displayName: name,
		preferredJoker: null,
		mods: null,
	})
	const actionCtx = {
		now: 1000,
		newSeed: () => 'SEED',
		newId: () => 'RUN',
		random: () => 0,
	}
	const act = (lobby: Lobby, from: string, key: string, params: unknown) =>
		action(
			lobby,
			from,
			{ cid: `${key}-${from}`, action: key, to: 'server', params },
			actionCtx,
		)
	const stateOf = (lobby: Lobby): ModeView => {
		const s = refereeOf(lobby)
		if (!s) throw new Error('no referee state')
		return s
	}

	function game(players: string[]): Lobby {
		let lobby = newLobby({
			code: 'ABC123',
			modId: 'MultiplayerPvP',
			maxPlayers: 8,
			creatorId: players[0],
			now: 0,
			graceMs: 10_000,
			resultTimeoutMs: 60_000,
		})
		for (const id of players)
			lobby = join(lobby, id, `${id}-s1`, info(id)).lobby
		lobby = { ...lobby, metadata: withRules({ queue_mode: 'pvp_royale' }) }
		for (const id of players.slice(1))
			lobby = act(lobby, id, 'mpapi_ready', { ready: true }).lobby
		lobby = act(lobby, players[0], 'mpapi_start_game', { stake: 2 }).lobby
		lobby = pvpTick(raced(lobby), ctx).lobby
		for (const id of players) {
			const pvp = pvpOf(lobby)
			if (!pvp) throw new Error('no pvp state')
			const r = readyReducer.reduce(
				lobby,
				id,
				{
					runId: pvp.runId,
					roundId: pvp.round + 1,
					startingHands: 4,
					blindKey: '2:Boss',
				},
				ctx,
			)
			if (!r.ok) throw new Error(`refused: ${r.reason}`)
			lobby = r.lobby
		}
		return pvpTick(lobby, ctx).lobby
	}

	// A pvp.hand request, so the STATE it announces carries the derived targets.
	function hand(lobby: Lobby, id: string, score: string, handsLeft: number) {
		const s = stateOf(lobby)
		const r = handleRequest(
			lobby,
			id,
			{
				reqId: `hand-${id}-${score}`,
				type: 'pvp.hand',
				payload: {
					runId: s.round.runId,
					roundId: s.round.roundId,
					score,
					handsLeft,
					timerLossesApplied: 0,
				},
			},
			ctx,
		)
		if (r.refused) throw new Error(`refused: ${r.refused.reason}`)
		return { lobby: r.lobby, out: r.pushes }
	}

	const stateSend = (out: Outbound[]) =>
		out.find(
			(o): o is Extract<Outbound, { kind: 'send' }> =>
				o.kind === 'send' && o.op === ServerOp.STATE,
		)
	const changedOf = (out: Outbound[]) =>
		(stateSend(out)?.payload as { changed: { [k: string]: unknown } }).changed

	it('the tick takes one life from the loser and pvp.targets carries opponents and safe', () => {
		let l = game(['a', 'b', 'c'])
		expect(stateOf(l).round.phase).toBe('playing')
		const start = stateOf(l).lives.players.a.lives
		l = hand(l, 'a', '100', 0).lobby
		l = hand(l, 'b', '200', 0).lobby
		const last = hand(l, 'c', '300', 0)
		// c's last hand moves c to the top: the targets are announced with it
		expect(changedOf(last.out)['pvp.targets']).toMatchObject({
			opponents: { a: 'b', b: 'a', c: 'b' },
			safe: { a: false, b: true, c: true },
		})
		const step = pvpTick(fromRuntime(last.lobby), ctx)
		expect(stateOf(step.lobby).round.lastResult?.losers).toEqual(['a'])
		expect(changedOf(step.out)['pvp.round']).toMatchObject({
			phase: 'resolved',
		})
		const announced = changedOf(step.out)['pvp.lives'] as {
			players: { [id: string]: { lives: number } }
		}
		expect(announced.players.a.lives).toBe(start - 1)
		expect(announced.players.b.lives).toBe(start)
		expect(announced.players.c.lives).toBe(start)
		const { players } = stateOf(step.lobby).lives
		expect([players.a.lives, players.b.lives, players.c.lives]).toEqual([
			start - 1,
			start,
			start,
		])
	})
})
