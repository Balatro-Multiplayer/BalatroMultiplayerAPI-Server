import * as fc from 'fast-check'
import { describe, expect, it } from 'vitest'
// The duel rules (rules R1, R9, R16-R21 of docs/pvp-match.md).
import { reportedPlayer, unreportedPlayer } from '../../../testing/pvp_fixtures'
import { testContext } from '../../../testing/request_context'
import { decidePending } from '../pending'
import { type ModeView, emptyPvp } from '../state'
import { openRound } from './common'
import { duelMode, duelOpponents } from './duel'
import { pickMode } from './index'

const ctx = testContext(0)
const RUN = 'r1'
const A = 'alice'
const B = 'bob'

// A duel that has just started: init has run for the seats A and B.
function started(startingLives = 4): ModeView {
	const s = emptyPvp()
	s.rules = {
		runId: RUN,
		mode: 'nemesis',
		startedCount: 2,
		startingLives,
		hunterLives: 7,
		deathOnRoundLoss: true,
		pvpStartAnte: 2,
		clocks: { ante: 'none', pvp: null, personal: null },
		timerBaseMs: 150_000,
		timerForgiveness: 0,
		timerIncrementMs: 60_000,
		skipTimeRule: 'lead',
	}
	s.lives.players = {
		[A]: {
			lives: 0,
			eliminated: false,
			forfeited: false,
			left: false,
			events: [],
		},
		[B]: {
			lives: 0,
			eliminated: false,
			forfeited: false,
			left: false,
			events: [],
		},
	}
	s.round.players = {
		[A]: reportedPlayer({
			score: '0',
			handsLeft: 4,
			reportedHands: 4,
			highestScore: '0',
			ante: 1,
			furthestBlind: 0,
		}),
		[B]: reportedPlayer({
			score: '0',
			handsLeft: 4,
			reportedHands: 4,
			highestScore: '0',
			ante: 1,
			furthestBlind: 0,
		}),
	}
	return duelMode.init(s, ctx, { startedIds: [], picks: {}, teamPlan: null })
}

// What the tick does with a resolve: each loser of the new `lastResult` loses a
// life (lives.ts), so the tests can read the mode's checkWinner on the outcome.
function takeLives(
	state: ModeView,
	before: ModeView['round']['lastResult'],
): ModeView {
	if (state.round.lastResult === before) return state
	const players = { ...state.lives.players }
	for (const id of state.round.lastResult?.losers ?? []) {
		const left = players[id].lives - 1
		players[id] = { ...players[id], lives: left, eliminated: left <= 0 }
	}
	return { ...state, lives: { ...state.lives, players } }
}

function playing(state = started()): ModeView {
	return duelMode.roundReady(state, ctx)
}

function withHands(
	state: ModeView,
	a: [string, number],
	b: [string, number],
): ModeView {
	return {
		...state,
		round: {
			...state.round,
			players: {
				...state.round.players,
				[A]: { ...state.round.players[A], score: a[0], handsLeft: a[1] },
				[B]: { ...state.round.players[B], score: b[0], handsLeft: b[1] },
			},
		},
	}
}

const livesOf = (s: ModeView, id: string) => s.lives.players[id].lives

describe('R1 start (referee_reset 867-897)', () => {
	it('settles lives and an empty round entry (every game fact unknown) for both seats', () => {
		const s = started(5)
		expect(s.lives.runId).toBe(RUN)
		expect(s.round.runId).toBe(RUN)
		expect(s.votes.runId).toBe(RUN)
		for (const id of [A, B]) {
			expect(s.lives.players[id]).toEqual({
				lives: 5,
				eliminated: false,
				forfeited: false,
				left: false,
				events: [],
			})
			expect(s.round.players[id]).toEqual(unreportedPlayer())
		}
		expect(s.round.roundId).toBe(0)
		expect(s.round.phase).toBe('shop')
	})
	it('runs once per runId', () => {
		const s = playing()
		expect(
			duelMode.init(s, ctx, { startedIds: [], picks: {}, teamPlan: null }),
		).toBe(s)
	})
	it('does nothing before the rules are frozen', () => {
		const s = emptyPvp()
		expect(
			duelMode.init(s, ctx, { startedIds: [], picks: {}, teamPlan: null }),
		).toBe(s)
	})
})

describe('R9 a blind start (1065-1077)', () => {
	it('opens the round and resets the score to unknown', () => {
		const s = withHands(started(), ['500', 0], ['300', 1])
		const next = duelMode.roundReady(s, ctx)
		expect(next.round.phase).toBe('playing')
		for (const id of [A, B]) expect(next.round.players[id].score).toBeNull()
	})
	it('keeps the best score of the run', () => {
		const s = started()
		s.round.players[A].highestScore = '900'
		expect(playing(s).round.players[A].highestScore).toBe('900')
	})
	it('does not reopen a round in play', () => {
		const s = playing()
		expect(duelMode.roundReady(s, ctx)).toBe(s)
	})
})

describe('R16-R18 resolve a round (1088-1103, 1385-1399)', () => {
	it.each([
		['R16 both have hands: nothing', ['10', 2], ['5', 1], null],
		['R16 the leader is out of hands: nothing', ['10', 0], ['5', 1], null],
		[
			'R16 the trailing player is out of hands: they lose',
			['5', 0],
			['10', 3],
			A,
		],
		['R16 b trailing and out of hands: b loses', ['10', 3], ['5', 0], B],
		['R16 both out of hands: the lower score loses', ['5', 0], ['10', 0], A],
		[
			'R17 a tie with both out of hands: nobody loses',
			['7', 0],
			['7', 0],
			'tie',
		],
		['R17 equal spellings tie', ['7.9', 0], ['7', 0], 'tie'],
		[
			'R17 a tie with one player with hands left: nothing',
			['7', 0],
			['7', 2],
			null,
		],
		['R16 score text order, not text order', ['9', 0], ['10', 0], A],
		[
			'R16 array text beats a plain number',
			['100,1', 0],
			['999999999999999', 0],
			B,
		],
	] as const)('%s', (_name, a, b, loser) => {
		const s = withHands(playing(), [a[0], a[1]], [b[0], b[1]])
		const next = duelMode.resolveRound(s, ctx)
		if (loser === null) {
			expect(next).toBe(s)
			return
		}
		expect(next.round.phase).toBe('resolved')
		expect(next.round.roundId).toBe(0)
		// the mode only names the loser: every life change is the tick's
		expect(next.lives).toBe(s.lives)
		expect(next.round.lastResult).toEqual({
			roundId: 0,
			losers: loser === 'tie' ? [] : [loser],
		})
		expect(next.result.runId).toBeNull()
	})

	it.each([
		['neither has started', [null, null], [null, null]],
		['only a has started, and is out of hands', ['5', 0], [null, null]],
		['only b has started, and is out of hands', [null, null], ['5', 0]],
	] as const)('A5 the round waits while %s', (_name, a, b) => {
		const s = withHands(
			playing(),
			a as unknown as [string, number],
			b as unknown as [string, number],
		)
		expect(duelMode.resolveRound(s, ctx)).toBe(s)
	})

	it('R18 a loss to 0 eliminates the loser (the result is checkWinner)', () => {
		const s = withHands(playing(started(1)), ['1', 0], ['9', 0])
		const next = takeLives(duelMode.resolveRound(s, ctx), null)
		expect(livesOf(next, A)).toBe(0)
		expect(next.lives.players[A].eliminated).toBe(true)
		expect(next.result.runId).toBeNull()
		const done = duelMode.checkWinner(next, ctx)
		expect(done.result).toEqual({
			runId: RUN,
			kind: 'win',
			winnerId: B,
			winnerTeam: null,
			places: [
				{ playerId: B, place: 1 },
				{ playerId: A, place: 2 },
			],
		})
	})

	it('resolves a round once: a second call changes nothing (the guard)', () => {
		const s = withHands(playing(), ['1', 0], ['9', 0])
		const once = duelMode.resolveRound(s, ctx)
		expect(duelMode.resolveRound(once, ctx)).toBe(once)
	})

	it('a resolve names the round it ends and leaves the roundId to the next open', () => {
		let s = withHands(playing(), ['1', 0], ['9', 0])
		s = { ...s, round: { ...s.round, roundId: 3 } }
		s = duelMode.resolveRound(s, ctx)
		expect(s.round.lastResult).toEqual({ roundId: 3, losers: [A] })
		s = withHands(duelMode.roundReady(s, ctx), ['1', 0], ['9', 0])
		s = duelMode.resolveRound(s, ctx)
		expect(s.round.lastResult).toEqual({ roundId: 3, losers: [A] })
		expect(s.round.roundId).toBe(3)
	})

	it('does nothing outside a playing round', () => {
		const s = withHands(started(), ['1', 0], ['9', 0])
		expect(duelMode.resolveRound(s, ctx)).toBe(s)
	})

	it('every hook leaves a state with a result alone (C1)', () => {
		// both alive, phase playing, hands at 0, different scores, result already set
		const base = withHands(playing(), ['1', 0], ['9', 0])
		const frozen: ModeView = {
			...base,
			result: {
				runId: RUN,
				kind: 'draw',
				winnerId: null,
				winnerTeam: null,
				places: [],
			},
		}
		expect(duelMode.resolveRound(frozen, ctx)).toBe(frozen)
		expect(duelMode.checkWinner(frozen, ctx)).toBe(frozen)
		const resolved = {
			...frozen,
			round: { ...frozen.round, phase: 'resolved' as const },
		}
		expect(duelMode.roundReady(resolved, ctx)).toBe(resolved)
		expect(openRound(resolved)).toBe(resolved)
	})

	it('a resolved round stays resolved until roundReady is called', () => {
		let s = withHands(playing(), ['1', 0], ['9', 0])
		s = duelMode.resolveRound(s, ctx)
		expect(s.round.phase).toBe('resolved')
		for (const hook of [
			duelMode.resolveRound,
			duelMode.checkWinner,
			duelMode.onForfeit,
		])
			expect(hook(s, ctx).round.phase).toBe('resolved')
		expect(duelMode.roundReady(s, ctx).round.phase).toBe('playing')
	})

	it('a round opens with the hands unknown, never the previous count', () => {
		const s = withHands(started(), ['5', 0], ['3', 0])
		const next = openRound(s)
		expect(next.round.players[A].handsLeft).toBeNull()
		expect(next.round.players[B].handsLeft).toBeNull()
		expect(next.round.players[A].score).toBeNull()
		// the blind_start reports them (R9); the hook invents nothing
		const reopened = duelMode.roundReady(s, ctx)
		expect(reopened.round.players[A].handsLeft).toBeNull()
		expect(reopened.round.players[B].handsLeft).toBeNull()
	})

	it('both players out of hands: the next round reopens unknown and resolves once', () => {
		let s = withHands(playing(), ['4', 0], ['4', 0])
		s = duelMode.resolveRound(s, ctx)
		expect(s.round.roundId).toBe(0)
		expect(s.round.lastResult).toEqual({ roundId: 0, losers: [] })
		s = duelMode.roundReady(s, ctx)
		expect(s.round.players[A].handsLeft).toBeNull()
		expect(s.round.players[B].handsLeft).toBeNull()
		// nobody has started, so a resolve right after the reopen finds nothing to end
		expect(duelMode.resolveRound(s, ctx)).toBe(s)
		expect(s.round.roundId).toBe(0)
	})
})

describe('R20 forfeit and leave', () => {
	it.each([
		['forfeited', { forfeited: true }],
		['left', { left: true }],
	] as const)('%s: the other player wins', (_name, flag) => {
		const s = playing()
		s.lives.players[A] = { ...s.lives.players[A], ...flag }
		const next = duelMode.onForfeit(s, ctx)
		expect(next.lives.players[A].eliminated).toBe(true)
		expect(next.result).toEqual({
			runId: RUN,
			kind: 'win',
			winnerId: B,
			winnerTeam: null,
			places: [
				{ playerId: B, place: 1 },
				{ playerId: A, place: 2 },
			],
		})
	})
	it('both gone: a draw, both in place 1', () => {
		const s = playing()
		s.lives.players[A] = { ...s.lives.players[A], left: true }
		s.lives.players[B] = { ...s.lives.players[B], forfeited: true }
		const next = duelMode.onForfeit(s, ctx)
		expect(next.result.kind).toBe('draw')
		expect(next.result.places.map((p) => p.place)).toEqual([1, 1])
	})
	it('nobody gone: nothing changes', () => {
		const s = playing()
		expect(duelMode.onForfeit(s, ctx)).toBe(s)
	})
	it('a leave while a pending death waits leaves the result to the tick', () => {
		const s = playing()
		s.lives.players[A] = { ...s.lives.players[A], lives: 0 }
		s.lives.players[B] = { ...s.lives.players[B], left: true }
		s.lives.pending = [{ playerId: A, blindKey: '2:Big', waitsOn: [B] }]
		const next = duelMode.onForfeit(s, ctx)
		expect(next.result.runId).toBeNull()
		// the awaited player left before beating the blind: the dead player wins
		expect(
			decidePending(
				{ playerId: A, blindKey: '2:Big' },
				B,
				{},
				{ present: false, forfeited: false, lives: 4 },
			),
		).toEqual({ outcome: 'win', winner: A })
	})
	it('the dead player leaving is not a forfeit', () => {
		const s = playing()
		s.lives.players[A] = { ...s.lives.players[A], lives: 0, left: true }
		s.lives.pending = [{ playerId: A, blindKey: '2:Big', waitsOn: [B] }]
		const next = duelMode.onForfeit(s, ctx)
		expect(next.lives.players[A].eliminated).toBe(false)
		expect(next.result.runId).toBeNull()
	})
	it('the result is frozen once set (C1)', () => {
		const s = playing()
		s.lives.players[A] = { ...s.lives.players[A], forfeited: true }
		const done = duelMode.onForfeit(s, ctx)
		done.lives.players[B] = { ...done.lives.players[B], left: true }
		expect(duelMode.onForfeit(done, ctx)).toBe(done)
	})
})

describe('R11, R21 a pending death holds the result (400-470)', () => {
	it('checkWinner waits while a pending death is open', () => {
		const s = playing()
		s.lives.players[A] = { ...s.lives.players[A], lives: 0 }
		s.lives.pending = [{ playerId: A, blindKey: '2:Big', waitsOn: [B] }]
		expect(duelMode.checkWinner(s, ctx)).toBe(s)
	})
	it('checkWinner decides once the pending death is settled away', () => {
		const s = playing()
		s.lives.players[A] = { ...s.lives.players[A], lives: 0 }
		const next = duelMode.checkWinner(s, ctx)
		expect(next.result.winnerId).toBe(B)
	})
	it('two players alive: no result', () => {
		const s = playing()
		expect(duelMode.checkWinner(s, ctx)).toBe(s)
	})
	it('no result before init', () => {
		const s = emptyPvp()
		expect(duelMode.checkWinner(s, ctx)).toBe(s)
	})
})

describe('R19, R24 and the other hooks', () => {
	it('the view is the opponent of each seat, derived and never stored', () => {
		const s = playing()
		expect(duelMode.view?.(s)).toEqual({ opponents: { [A]: B, [B]: A } })
		expect(duelOpponents(s)).toEqual({ [A]: B, [B]: A })
	})
	it('has no ante hook', () => {
		expect(duelMode.onAnte).toBeUndefined()
	})
	// R16, R22: a lobby that started at 2 uses the
	// pairwise rule; one that started at N>2 keeps rank-and-cut. A Royale lobby
	// of exactly 2 therefore plays the duel, as pickMode says.
	it.each([
		['royale', 2],
		['nemesis', 2],
	] as const)('R24 %s with 2 players plays the duel', (mode, n) => {
		expect(pickMode(mode, n)).toBe(duelMode)
	})
})

describe('invariants', () => {
	const score = fc.nat({ max: 10_000 }).map(String)
	const hands = fc.integer({ min: 0, max: 4 })

	it('lives never go below 0 and one resolve costs at most one life', () => {
		fc.assert(
			fc.property(
				fc.integer({ min: 1, max: 5 }),
				score,
				hands,
				score,
				hands,
				(startLives, sa, ha, sb, hb) => {
					const s = withHands(playing(started(startLives)), [sa, ha], [sb, hb])
					const once = duelMode.resolveRound(s, ctx)
					// a resolve names at most one loser and never touches lives
					expect(once.lives).toBe(s.lives)
					expect(once.round.lastResult?.losers.length ?? 0).toBeLessThanOrEqual(
						1,
					)
					// the guard: a second resolve at the same roundId changes nothing
					expect(duelMode.resolveRound(once, ctx)).toBe(once)
					// the roundId is the start's: a resolve leaves it alone
					expect(once.round.roundId).toBe(s.round.roundId)
				},
			),
		)
	})

	it('a long duel: lives >= 0, one life per round, the result frozen once set', () => {
		fc.assert(
			fc.property(
				fc.array(fc.tuple(score, score), { minLength: 1, maxLength: 30 }),
				(rounds) => {
					let s = started(3)
					let frozen: ModeView['result'] | null = null
					for (const [sa, sb] of rounds) {
						s = duelMode.roundReady(s, ctx)
						s = withHands(s, [sa, 0], [sb, 0])
						const before = livesOf(s, A) + livesOf(s, B)
						s = takeLives(duelMode.resolveRound(s, ctx), s.round.lastResult)
						s = duelMode.checkWinner(s, ctx)
						expect(
							before - (livesOf(s, A) + livesOf(s, B)),
						).toBeLessThanOrEqual(1)
						expect(livesOf(s, A)).toBeGreaterThanOrEqual(0)
						expect(livesOf(s, B)).toBeGreaterThanOrEqual(0)
						if (frozen !== null) expect(s.result).toEqual(frozen)
						else if (s.result.runId !== null) frozen = s.result
						if (frozen !== null) {
							// once decided, further rounds change neither lives nor result
							const again = duelMode.resolveRound(
								duelMode.roundReady(s, ctx),
								ctx,
							)
							expect(again.result).toEqual(frozen)
							expect(livesOf(again, A)).toBe(livesOf(s, A))
							// forfeiting the winner afterwards cannot change the frozen result
							if (frozen.winnerId !== null) {
								const w = frozen.winnerId
								const gone: ModeView = {
									...s,
									lives: {
										...s.lives,
										players: {
											...s.lives.players,
											[w]: { ...s.lives.players[w], forfeited: true },
										},
									},
								}
								expect(duelMode.checkWinner(gone, ctx).result).toEqual(frozen)
								expect(duelMode.onForfeit(gone, ctx).result).toEqual(frozen)
							}
						}
					}
				},
			),
		)
	})

	it('conservation: places are a permutation of the seats', () => {
		fc.assert(
			fc.property(fc.boolean(), fc.boolean(), (aGone, bGone) => {
				const s = playing()
				s.lives.players[A] = { ...s.lives.players[A], left: aGone }
				s.lives.players[B] = { ...s.lives.players[B], forfeited: bGone }
				const r = duelMode.onForfeit(s, ctx).result
				if (!aGone && !bGone) {
					expect(r.runId).toBeNull()
					return
				}
				expect(r.places.map((p) => p.playerId).sort()).toEqual([A, B])
				expect(r.kind).toBe(aGone && bGone ? 'draw' : 'win')
			}),
		)
	})
})
