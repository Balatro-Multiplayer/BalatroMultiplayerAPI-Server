import { readFileSync } from 'node:fs'
import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import {
	reportedPlayer,
	startOf,
	unreportedPlayer,
} from '../../testing/pvp_fixtures'
import {
	type Deadline,
	type TimerWorld,
	pvpRunOut,
	wouldTime,
} from './deadline'
import {
	reduceBlind,
	reduceBlindStart,
	reduceForfeit,
	reduceHand,
	reduceHandCommit,
	reduceProgress,
	reduceVote,
	reduceVoucher,
} from './facts'
import { maskedFor } from './mask'
import { allOutOfHands } from './modes/common'
import { type FactReducer, handsAfter } from './reducer'
import { type RefereeState, emptyFacts } from './state'
import { emptyPvp } from './state'

// A running game, round 3 in play, two players (the tick has frozen the rules).
function game(over: Partial<RefereeState> = {}): RefereeState {
	const idle = emptyPvp()
	return {
		...idle,
		facts: emptyFacts(),
		runId: 'r1',
		lastStart: startOf(['a', 'b'], 3, 'a', 2),
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
			...idle.round,
			runId: 'r1',
			roundId: 3,
			phase: 'playing',
			players: {
				a: reportedPlayer({ ante: 2 }),
				b: reportedPlayer({ ante: 2 }),
			},
		},
		lives: {
			...idle.lives,
			runId: 'r1',
			players: {
				a: {
					lives: 4,
					eliminated: false,
					forfeited: false,
					left: false,
					events: [],
				},
				b: {
					lives: 4,
					eliminated: false,
					forfeited: false,
					left: false,
					events: [],
				},
			},
		},
		...over,
	}
}

// The same game with both players seated but neither started: every game fact
// unknown, the way the tick seats them.
function notStarted(): RefereeState {
	const g = game()
	return {
		...g,
		round: {
			...g.round,
			players: { a: unreportedPlayer(), b: unreportedPlayer() },
		},
	}
}

function must(r: ReturnType<FactReducer>): RefereeState {
	if (!r.ok) throw new Error(`refused: ${r.reason}`)
	return r.state
}

const hand = (over: object = {}) => ({
	runId: 'r1',
	roundId: 3,
	score: '100',
	handsLeft: 3,
	timerLossesApplied: 0,
	...over,
})

describe('request x refusal', () => {
	const decided = game({
		result: {
			runId: 'r1',
			kind: 'win',
			winnerId: 'a',
			winnerTeam: null,
			places: [],
		},
	})
	const out = game({
		lives: {
			...game().lives,
			players: {
				...game().lives.players,
				a: {
					lives: 0,
					eliminated: true,
					forfeited: false,
					left: false,
					events: [],
				},
			},
		},
	})
	const resolved = game({ round: { ...game().round, phase: 'resolved' } })

	const cases: Array<[string, FactReducer, object, RefereeState, string]> = [
		['hand bad_payload', reduceHand, { runId: 'r1' }, game(), 'bad_payload'],
		[
			'hand bad_score',
			reduceHand,
			hand({ score: 'nope' }),
			game(),
			'bad_score',
		],
		[
			'hand stale runId',
			reduceHand,
			hand({ runId: 'r0' }),
			game(),
			'round_over',
		],
		[
			'hand stale roundId',
			reduceHand,
			hand({ roundId: 2 }),
			game(),
			'round_over',
		],
		['hand C1 result set', reduceHand, hand(), decided, 'round_over'],
		['hand eliminated', reduceHand, hand(), out, 'eliminated'],
		['hand not_playing', reduceHand, hand(), resolved, 'not_playing'],
		[
			'blind bad key',
			reduceBlind,
			{ runId: 'r1', blindKey: '2:Huge', beaten: false, roundLost: false },
			game(),
			'bad_payload',
		],
		[
			'blind beaten and lost',
			reduceBlind,
			{ runId: 'r1', blindKey: '2:Big', beaten: true, roundLost: true },
			game(),
			'bad_payload',
		],
		[
			'blind C1',
			reduceBlind,
			{ runId: 'r1', blindKey: '2:Big', beaten: true, roundLost: false },
			decided,
			'round_over',
		],
		[
			'blind eliminated',
			reduceBlind,
			{ runId: 'r1', blindKey: '2:Big', beaten: true, roundLost: false },
			out,
			'eliminated',
		],
		[
			'voucher C1',
			reduceVoucher,
			{ runId: 'r1', voucherKey: 'v_mp_hieroglyph' },
			decided,
			'round_over',
		],
		[
			'vote C1',
			reduceVote,
			{ runId: 'r1', kind: 'draw', yes: true },
			decided,
			'round_over',
		],
		[
			'progress bad_payload',
			reduceProgress,
			{ runId: 'r1', ante: -1, furthestBlind: 0 },
			game(),
			'bad_payload',
		],
		[
			'progress C1',
			reduceProgress,
			{ runId: 'r1', ante: 1, furthestBlind: 0 },
			decided,
			'round_over',
		],
		[
			'voucher bad key',
			reduceVoucher,
			{ runId: 'r1', voucherKey: '' },
			game(),
			'bad_payload',
		],
		[
			'voucher not_runner',
			reduceVoucher,
			{ runId: 'r1', voucherKey: 'v_mp_hieroglyph' },
			game(),
			'not_runner',
		],
		['forfeit bad_payload', reduceForfeit, {}, game(), 'bad_payload'],
		['forfeit eliminated', reduceForfeit, { runId: 'r1' }, out, 'eliminated'],
		['forfeit C1', reduceForfeit, { runId: 'r1' }, decided, 'round_over'],
		[
			'vote bad kind',
			reduceVote,
			{ runId: 'r1', kind: 'x', yes: true },
			game(),
			'bad_payload',
		],
		[
			'vote no_vote before rules',
			reduceVote,
			{ runId: 'r1', kind: 'draw', yes: true },
			game({ rules: emptyPvp().rules }),
			'no_vote',
		],
	]
	it.each(cases)('%s', (_name, reduce, args, state, reason) => {
		expect(reduce(state, 'a', args)).toEqual({ ok: false, reason })
	})

	it('refuses a non-record payload', () => {
		for (const r of [reduceHand, reduceBlind, reduceVote])
			expect(r(game(), 'a', null)).toEqual({ ok: false, reason: 'bad_payload' })
	})
})

describe('pvp.hand', () => {
	it('records the sender score and handsLeft', () => {
		const r = reduceHand(game(), 'a', hand())
		expect(r.ok && r.changed).toEqual(['pvp.round'])
		expect(must(r).round.players.a).toEqual(
			reportedPlayer({
				score: '100',
				handsLeft: 3,
				reportedHands: 3,
				highestScore: '100',
				ante: 2,
			}),
		)
	})

	it('stale_hand: handsLeft only goes down, score only goes up (R10)', () => {
		const s = must(reduceHand(game(), 'a', hand()))
		expect(reduceHand(s, 'a', hand({ handsLeft: 4 }))).toEqual({
			ok: false,
			reason: 'stale_hand',
		})
		expect(reduceHand(s, 'a', hand({ score: '99' }))).toEqual({
			ok: false,
			reason: 'stale_hand',
		})
		const next = must(reduceHand(s, 'a', hand({ score: '250', handsLeft: 2 })))
		expect(next.round.players.a.handsLeft).toBe(2)
		expect(next.round.players.a.score).toBe('250')
	})

	it('stale_hand: a higher score at the same handsLeft is refused, a spent hand accepts it', () => {
		const s = must(reduceHand(game(), 'a', hand()))
		expect(reduceHand(s, 'a', hand({ score: '250' }))).toEqual({
			ok: false,
			reason: 'stale_hand',
		})
		const next = must(reduceHand(s, 'a', hand({ score: '250', handsLeft: 2 })))
		expect(next.round.players.a.score).toBe('250')
	})

	it('a new roundId restarts the entry and keeps highestScore', () => {
		const s = must(
			reduceHand(game(), 'a', hand({ score: '900', handsLeft: 0 })),
		)
		// The tick opens round 4 with every round fact unknown and the run's best kept.
		const nextRound = {
			...s,
			round: {
				...s.round,
				roundId: 4,
				players: {
					...s.round.players,
					a: unreportedPlayer({ highestScore: '900' }),
				},
			},
		}
		const first = hand({ roundId: 4, score: '10', handsLeft: 4 })
		expect(must(reduceHand(nextRound, 'a', first)).round.players.a.score).toBe(
			'10',
		)
		const r = must(reduceHand(nextRound, 'a', first))
		expect(r.round.players.a.score).toBe('10')
		expect(r.round.players.a.highestScore).toBe('900')
	})

	it('refuses a request from a player with no entry (no_entry)', () => {
		const empty = game({ round: { ...game().round, players: {} } })
		expect(reduceHand(empty, 'a', hand())).toEqual({
			ok: false,
			reason: 'no_entry',
		})
	})

	it('refuses a late hand once the server ended the hands (hands_spent)', () => {
		const spent = game()
		const s: RefereeState = {
			...spent,
			round: {
				...spent.round,
				players: {
					...spent.round.players,
					a: reportedPlayer({ ante: 2, handsSpent: true, handsLeft: 1 }),
				},
			},
		}
		expect(reduceHand(s, 'a', hand())).toEqual({
			ok: false,
			reason: 'hands_spent',
		})
	})

	it.each([
		['absent', undefined],
		['negative', -1],
		['above the server count', 1],
	])('timerLossesApplied %s is bad_payload', (_what, applied) => {
		expect(
			reduceHand(game(), 'a', hand({ timerLossesApplied: applied })),
		).toEqual({ ok: false, reason: 'bad_payload' })
	})

	it('a hand counts the run-outs the sender had not yet subtracted', () => {
		const s = game()
		const twoLosses: RefereeState = {
			...s,
			round: {
				...s.round,
				players: {
					...s.round.players,
					a: reportedPlayer({ ante: 2, timerLosses: 2, handsLeft: 2 }),
				},
			},
		}
		const stale = must(
			reduceHand(twoLosses, 'a', hand({ handsLeft: 3, timerLossesApplied: 0 })),
		)
		expect(stale.round.players.a.handsLeft).toBe(1)
		const current = must(
			reduceHand(twoLosses, 'a', hand({ handsLeft: 3, timerLossesApplied: 2 })),
		)
		expect(current.round.players.a.handsLeft).toBe(3)
		const one = must(
			reduceHand(twoLosses, 'a', hand({ handsLeft: 3, timerLossesApplied: 1 })),
		)
		expect(one.round.players.a.handsLeft).toBe(2)
	})

	it('a repeat hand changes nothing', () => {
		const s = must(reduceHand(game(), 'a', hand()))
		const again = reduceHand(s, 'a', hand())
		expect(again).toEqual({ ok: true, state: s, changed: [] })
	})
})

describe('pvp.blind', () => {
	const blind = (beaten: boolean, roundLost: boolean) => ({
		runId: 'r1',
		blindKey: '2:Big',
		beaten,
		roundLost,
	})

	it('a failure is final and roundLost is a separate fact (R12, 1700-1705)', () => {
		let s = must(reduceBlind(game(), 'a', blind(false, false)))
		s = must(reduceBlind(s, 'a', blind(true, false)))
		expect(s.facts.blinds.a['2:Big']).toEqual({
			beaten: false,
			roundLost: false,
		})
		s = must(reduceBlind(s, 'a', blind(false, true)))
		expect(s.facts.blinds.a['2:Big']).toEqual({
			beaten: false,
			roundLost: true,
		})
		expect(s.facts.log.filter((f) => f.type === 'blind')).toHaveLength(2)
	})

	it('a repeat is no new fact', () => {
		const s = must(reduceBlind(game(), 'a', blind(false, true)))
		expect(reduceBlind(s, 'a', blind(false, true))).toEqual({
			ok: true,
			state: s,
			changed: [],
		})
	})

	it('beaten first then failure: the failure wins either order', () => {
		const ab = must(
			reduceBlind(
				must(reduceBlind(game(), 'a', blind(true, false))),
				'a',
				blind(false, false),
			),
		)
		const ba = must(
			reduceBlind(
				must(reduceBlind(game(), 'a', blind(false, false))),
				'a',
				blind(true, false),
			),
		)
		expect(ab.facts.blinds).toEqual(ba.facts.blinds)
	})
})

// An Ante run-out names the deadline it saw (1..timerN), so the game has run
// four deadlines.
const anteGame = (): RefereeState => {
	const g = game()
	return { ...g, facts: { ...g.facts, timerN: 4 } }
}


describe('pvp.hand_commit and the hand credit', () => {
	// a PvP-clock ruleset, `a` and `b` each on 4 hands with the watermark at 4
	const clocked = (over: Partial<RefereeState['round']['players']['a']> = {}) => {
		const g = game()
		const player = reportedPlayer({ ante: 2, creditedHands: 4, ...over })
		return game({
			rules: {
				runId: 'r1',
				mode: 'royale',
				startedCount: 2,
				startingLives: 4,
				hunterLives: 7,
				deathOnRoundLoss: true,
				pvpStartAnte: 2,
				timerBaseMs: 150_000,
				timerForgiveness: 0,
				timerIncrementMs: 60_000,
				skipTimeRule: 'lead',
				clocks: {
					ante: 'bank',
					pvp: { baseMs: 60_000, handMs: 10_000 },
					personal: null,
				},
			},
			round: {
				...g.round,
				players: { a: player, b: { ...player } },
			},
		})
	}
	const commit = (handsLeft: number, over: object = {}) => ({
		runId: 'r1',
		roundId: 3,
		handsLeft,
		timerLossesApplied: 0,
		...over,
	})
	const credits = (s: RefereeState): number =>
		s.facts.log.reduce(
			(sum, f) => (f.type === 'hand_credit' ? sum + f.hands : sum),
			0,
		)
	const mine = (s: RefereeState) => s.round.players.a

	it('a commit one hand down is accepted and credits that hand', () => {
		const s = must(reduceHandCommit(clocked(), 'a', commit(3)))
		expect(credits(s)).toBe(1)
		expect(mine(s)).toMatchObject({ committedHands: 3, creditedHands: 3 })
		expect(s.facts.log).toContainEqual({
			type: 'hand_credit',
			playerId: 'a',
			hands: 1,
		})
	})

	it.each([
		['the count it already has', 4],
		['two hands down', 2],
	])('a commit with %s is stale_commit', (_what, handsLeft) => {
		expect(reduceHandCommit(clocked(), 'a', commit(handsLeft))).toEqual({
			ok: false,
			reason: 'stale_commit',
		})
	})

	it('a second commit while one is pending is stale_commit', () => {
		const s = must(reduceHandCommit(clocked(), 'a', commit(3)))
		expect(reduceHandCommit(s, 'a', commit(2))).toEqual({
			ok: false,
			reason: 'stale_commit',
		})
	})

	it('a commit on a ruleset with no PvP clock is no_timer', () => {
		expect(reduceHandCommit(game(), 'a', commit(3))).toEqual({
			ok: false,
			reason: 'no_timer',
		})
	})

	it('the watermark follows the ruleset: the reported count with a PvP clock, none without', () => {
		const withClock = clocked()
		const fresh = (s: RefereeState): RefereeState => ({
			...s,
			round: {
				...s.round,
				players: { a: unreportedPlayer(), b: unreportedPlayer() },
			},
		})
		const startArgs = {
			runId: 'r1',
			roundId: 3,
			handsLeft: 4,
			score: '0',
			timerLossesApplied: 0,
		}
		const on = must(reduceBlindStart(fresh(withClock), 'a', startArgs))
		expect(mine(on).creditedHands).toBe(4)
		const off = must(reduceBlindStart(notStarted(), 'a', startArgs))
		expect(mine(off).creditedHands).toBeNull()
		// a hand there earns nothing and writes no credit fact
		const played = must(reduceHand(off, 'a', hand({ score: '50', handsLeft: 3 })))
		expect(credits(played)).toBe(0)
		expect(mine(played).creditedHands).toBeNull()
	})

	it.each([
		['no runId', { runId: undefined }],
		['no roundId', { roundId: undefined }],
		['a fractional handsLeft', { handsLeft: 1.5 }],
		['no timerLossesApplied', { timerLossesApplied: undefined }],
		['a timerLossesApplied above the server count', { timerLossesApplied: 1 }],
	])('a commit with %s is bad_payload', (_what, over) => {
		expect(reduceHandCommit(clocked(), 'a', commit(3, over))).toEqual({
			ok: false,
			reason: 'bad_payload',
		})
	})

	it('a commit for another round is round_over', () => {
		expect(
			reduceHandCommit(clocked(), 'a', commit(3, { roundId: 2 })),
		).toEqual({ ok: false, reason: 'round_over' })
	})

	it('the hand that matches its commit is accepted, credits nothing more and clears the commit', () => {
		let s = must(reduceHandCommit(clocked(), 'a', commit(3)))
		s = must(reduceHand(s, 'a', hand({ handsLeft: 3 })))
		expect(credits(s)).toBe(1)
		expect(mine(s)).toMatchObject({ handsLeft: 3, committedHands: null })
	})

	it('a hand with fewer hands left than its commit clears the commit and is credited once (the commit hand was lost)', () => {
		// the commit for hand 1 (3 left) arrived, hand 1's pvp.hand was lost on a silent
		// link, then hand 2 (2 left) arrives: scores are cumulative, so it covers hand 1
		const committed = must(reduceHandCommit(clocked(), 'a', commit(3)))
		const s = must(reduceHand(committed, 'a', hand({ handsLeft: 2, score: '300' })))
		expect(mine(s)).toMatchObject({
			score: '300',
			handsLeft: 2,
			committedHands: null,
			creditedHands: 2,
		})
		expect(credits(s)).toBe(2)
	})

	it('after the lost hand, later hands are accepted and each is credited once', () => {
		const committed = must(reduceHandCommit(clocked(), 'a', commit(3)))
		let s = must(reduceHand(committed, 'a', hand({ handsLeft: 2, score: '300' })))
		const resend = reduceHand(s, 'a', hand({ handsLeft: 2, score: '300' }))
		expect(resend.ok && resend.changed).toEqual([])
		expect(credits(s)).toBe(2)
		s = must(reduceHand(s, 'a', hand({ handsLeft: 1, score: '500' })))
		expect(mine(s)).toMatchObject({ score: '500', handsLeft: 1, creditedHands: 1 })
		expect(credits(s)).toBe(3)
	})

	it('the order the client sends them in (commit, then its hand, every hand) credits every hand of the round', () => {
		// pvp_api/net.lua handCommit sends hands_left - 1 on Play; playHand follows once scored.
		let s = clocked()
		for (const left of [3, 2, 1, 0]) {
			s = must(reduceHandCommit(s, 'a', commit(left)))
			s = must(reduceHand(s, 'a', hand({ handsLeft: left, score: String(100 * (4 - left)) })))
		}
		expect(credits(s)).toBe(4)
		expect(mine(s)).toMatchObject({ handsLeft: 0, committedHands: null, creditedHands: 0 })
	})

	it('commit, then the hand it announced, then the next: no double credit', () => {
		let s = must(reduceHandCommit(clocked(), 'a', commit(3)))
		s = must(reduceHand(s, 'a', hand({ handsLeft: 3 })))
		s = must(reduceHand(s, 'a', hand({ handsLeft: 2, score: '300' })))
		expect(credits(s)).toBe(2)
	})

	it('commit, a refused second commit, the real hand: credited once in total', () => {
		let s = must(reduceHandCommit(clocked(), 'a', commit(3)))
		expect(reduceHandCommit(s, 'a', commit(2))).toEqual({
			ok: false,
			reason: 'stale_commit',
		})
		s = must(reduceHand(s, 'a', hand({ handsLeft: 3 })))
		expect(credits(s)).toBe(1)
	})

	it('a hand with no commit, one down, credits that hand', () => {
		const s = must(reduceHand(clocked(), 'a', hand({ handsLeft: 3 })))
		expect(credits(s)).toBe(1)
		expect(mine(s).creditedHands).toBe(3)
	})

	it('an equal-handsLeft resend with a higher score is refused and credits nothing', () => {
		const s = must(reduceHand(clocked(), 'a', hand({ handsLeft: 3 })))
		expect(reduceHand(s, 'a', hand({ handsLeft: 3, score: '200' }))).toEqual({
			ok: false,
			reason: 'stale_hand',
		})
		expect(credits(s)).toBe(1)
		expect(mine(s).score).toBe('100')
	})

	it('a commit sent before the client applied a run-out is accepted on the derived count', () => {
		// the server ran a hand out (4 -> 3, watermark 3); the client, still at 4,
		// plays a hand and commits 3 with no run-out applied: derived 2
		const behind = clocked({ timerLosses: 1, handsLeft: 3, creditedHands: 3 })
		const s = must(reduceHandCommit(behind, 'a', commit(3)))
		expect(mine(s)).toMatchObject({ committedHands: 2, creditedHands: 2 })
		expect(credits(s)).toBe(1)
	})

	it('a commit after the server ended the hands of the sender is hands_spent', () => {
		const spent = clocked({ handsSpent: true })
		expect(reduceHandCommit(spent, 'a', commit(3))).toEqual({
			ok: false,
			reason: 'hands_spent',
		})
	})
})

describe('pvp.progress', () => {
	it('ante and furthestBlind only go up', () => {
		let s = must(
			reduceProgress(game(), 'a', { runId: 'r1', ante: 3, furthestBlind: 7 }),
		)
		const same = reduceProgress(s, 'a', {
			runId: 'r1',
			ante: 2,
			furthestBlind: 5,
		})
		// The round is as it was: a lower report changes nothing.
		expect(must(same).round).toEqual(s.round)
		expect(same).toMatchObject({ ok: true, changed: [] })
		s = must(reduceProgress(s, 'a', { runId: 'r1', ante: 4, furthestBlind: 6 }))
		expect(s.round.players.a.ante).toBe(4)
		expect(s.round.players.a.furthestBlind).toBe(7)
	})
})

describe('pvp.voucher', () => {
	// Only a Manhunt game lets a Runner redeem (`mayRedeemVoucher`).
	const frozen = game().rules
	if (frozen.runId === null) throw new Error('game() has frozen rules')
	const runner = game({
		rules: { ...frozen, mode: 'manhunt' },
		teams: { runId: 'r1', teams: { a: 'RUNNER', b: 'HUNTER' } },
	})
	const v = (voucherKey: string) => ({ runId: 'r1', voucherKey })

	it('once per voucherKey (R42)', () => {
		let s = must(reduceVoucher(runner, 'a', v('v_mp_hieroglyph')))
		expect(reduceVoucher(s, 'a', v('v_mp_hieroglyph'))).toEqual({
			ok: false,
			reason: 'already_redeemed',
		})
		s = must(reduceVoucher(s, 'a', v('v_mp_petroglyph')))
		expect(s.facts.log).toHaveLength(2)
	})

	it.each([
		['empty', ''],
		['not a string', 7],
		['too long', 'v'.repeat(65)],
	])('a key that is %s is bad_payload', (_name, key) => {
		expect(reduceVoucher(runner, 'a', { runId: 'r1', voucherKey: key })).toEqual({
			ok: false,
			reason: 'bad_payload',
		})
	})

	it('only the Runner', () => {
		expect(reduceVoucher(runner, 'b', v('v_mp_hieroglyph'))).toEqual({
			ok: false,
			reason: 'not_runner',
		})
	})
})

describe('pvp.forfeit and pvp.vote', () => {
	it('records a forfeit once; later requests from the sender are eliminated', () => {
		const s = must(reduceForfeit(game(), 'a', { runId: 'r1' }))
		expect(reduceForfeit(s, 'a', { runId: 'r1' })).toEqual({
			ok: true,
			state: s,
			changed: [],
		})
		expect(reduceHand(s, 'a', hand())).toEqual({
			ok: false,
			reason: 'eliminated',
		})
	})

	it('a vote is idempotent and can be withdrawn', () => {
		const v = (yes: boolean) => ({ runId: 'r1', kind: 'draw', yes })
		let s = must(reduceVote(game(), 'a', v(true)))
		expect(s.votes).toEqual({ runId: 'r1', draw: ['a'], seed: [] })
		expect(reduceVote(s, 'a', v(true))).toEqual({
			ok: true,
			state: s,
			changed: [],
		})
		s = must(reduceVote(s, 'b', v(true)))
		s = must(reduceVote(s, 'a', v(false)))
		expect(s.votes.draw).toEqual(['b'])
	})
})

describe('invariants', () => {
	const ids = fc.constantFrom('a', 'b')
	const requests: fc.Arbitrary<[FactReducer, string, object]> = fc.oneof(
		fc.tuple(
			fc.constant<FactReducer>(reduceHand),
			ids,
			fc.record({
				runId: fc.constant('r1'),
				roundId: fc.constant(3),
				score: fc.nat({ max: 5000 }).map(String),
				handsLeft: fc.integer({ min: 0, max: 4 }),
				timerLossesApplied: fc.constant(0),
			}),
		),
		fc.tuple(
			fc.constant<FactReducer>(reduceBlind),
			ids,
			fc.record({
				runId: fc.constant('r1'),
				blindKey: fc.constantFrom('1:Small', '2:Big'),
				beaten: fc.boolean(),
				roundLost: fc.constant(false),
			}),
		),
		fc.tuple(
			fc.constant<FactReducer>(reduceProgress),
			ids,
			fc.record({
				runId: fc.constant('r1'),
				ante: fc.integer({ min: 0, max: 8 }),
				furthestBlind: fc.integer({ min: 0, max: 24 }),
			}),
		),
	)

	it('replaying any accepted request changes nothing', () => {
		fc.assert(
			fc.property(fc.array(requests, { maxLength: 12 }), (sequence) => {
				let s = anteGame()
				for (const [reduce, id, args] of sequence) {
					const first = reduce(s, id, args)
					if (!first.ok) continue
					s = first.state
					const again = reduce(s, id, args)
					expect(again.ok).toBe(true)
					if (again.ok) {
						expect(again.state).toEqual(s)
						expect(again.changed).toEqual([])
					}
				}
			}),
		)
	})

	it('handsLeft never goes below 0 and never rises within a round', () => {
		fc.assert(
			fc.property(fc.array(requests, { maxLength: 15 }), (sequence) => {
				let s = anteGame()
				let last: { [id: string]: number } = {}
				for (const [reduce, id, args] of sequence) {
					const r = reduce(s, id, args)
					if (!r.ok) continue
					// The first hand of a round sets the base, so only a count the
					// sender has already reported must not rise.
					const stamped = s.facts.handRound
					s = r.state
					for (const pid of Object.keys(s.round.players)) {
						const h = s.round.players[pid].handsLeft
						if (h === null) continue
						expect(h).toBeGreaterThanOrEqual(0)
						if (last[pid] !== undefined && stamped[pid] === 3)
							expect(h).toBeLessThanOrEqual(last[pid])
						last = { ...last, [pid]: h }
					}
				}
			}),
		)
	})
})

describe('pvp.blind_start', () => {
	const start = (handsLeft: number, over: object = {}) => ({
		runId: 'r1',
		roundId: 3,
		handsLeft,
		score: '0',
		timerLossesApplied: 0,
		...over,
	})
	// The server's PvP run-out of `a` as the tick writes it (deadline.ts pvpRunOut).
	const ranOut = (s: RefereeState): RefereeState =>
		pvpRunOut(s, 'a', 10_000)

	it('publishes pvp.round with the count and the score and stamps nothing', () => {
		const r = reduceBlindStart(notStarted(), 'a', start(7, { score: '12' }))
		expect(r.ok && r.changed).toEqual(['pvp.round'])
		const s = must(r)
		expect(s.round.players.a.handsLeft).toBe(7)
		expect(s.round.players.a.score).toBe('12')
		expect(s.facts.handRound.a).toBeUndefined()
		expect(s.facts.log).toEqual([])
	})

	it('is idempotent for the same roundId and count', () => {
		const s = must(reduceBlindStart(notStarted(), 'a', start(7)))
		expect(reduceBlindStart(s, 'a', start(7))).toEqual({
			ok: true,
			state: s,
			changed: [],
		})
	})

	it('a resend after a hand changes nothing', () => {
		let s = must(reduceBlindStart(notStarted(), 'a', start(7)))
		s = must(reduceHand(s, 'a', hand({ score: '50', handsLeft: 6 })))
		expect(reduceBlindStart(s, 'a', start(7))).toEqual({
			ok: true,
			state: s,
			changed: [],
		})
		expect(reduceBlindStart(s, 'a', start(9))).toEqual({
			ok: true,
			state: s,
			changed: [],
		})
	})

	it('refuses a stale roundId as round_over', () => {
		expect(
			reduceBlindStart(notStarted(), 'a', start(7, { roundId: 2 })),
		).toEqual({ ok: false, reason: 'round_over' })
	})

	it('refuses outside the playing phase and with a stale or ended run', () => {
		const resolved = {
			...notStarted(),
			round: { ...notStarted().round, phase: 'resolved' as const },
		}
		expect(reduceBlindStart(resolved, 'a', start(7))).toEqual({
			ok: false,
			reason: 'not_playing',
		})
		expect(
			reduceBlindStart(notStarted(), 'a', start(7, { runId: 'old' })),
		).toEqual({ ok: false, reason: 'round_over' })
	})

	it('refuses a player with no entry as no_entry', () => {
		const empty = game({ round: { ...game().round, players: {} } })
		expect(reduceBlindStart(empty, 'a', start(7))).toEqual({
			ok: false,
			reason: 'no_entry',
		})
	})

	it.each([
		['no handsLeft', { handsLeft: undefined }],
		['negative', { handsLeft: -1 }],
		['fractional', { handsLeft: 1.5 }],
		['above the cap', { handsLeft: 101 }],
		['a string', { handsLeft: '4' }],
		['no roundId', { roundId: undefined }],
		['no score', { score: undefined }],
		['no timerLossesApplied', { timerLossesApplied: undefined }],
		['a timerLossesApplied above the server count', { timerLossesApplied: 1 }],
	])('refuses a bad payload: %s', (_what, over) => {
		expect(reduceBlindStart(notStarted(), 'a', start(4, over))).toEqual({
			ok: false,
			reason: 'bad_payload',
		})
	})

	it('counts a PvP-timer run-out already accepted: handsLeft = count - 1', () => {
		let s = ranOut(notStarted())
		expect(s.facts.handRound.a).toBeUndefined()
		s = must(reduceBlindStart(s, 'a', start(5)))
		expect(s.round.players.a.handsLeft).toBe(4)
		expect(s.facts.handRound.a).toBeUndefined()
		// a later run-out takes one more, from the same base
		s = ranOut(s)
		expect(s.round.players.a.handsLeft).toBe(3)
	})

	it('a run-out before the blind_start leaves the same count as after it', () => {
		const early = ranOut(notStarted())
		const a = must(reduceBlindStart(early, 'a', start(6)))
		const b = ranOut(must(reduceBlindStart(notStarted(), 'a', start(6))))
		expect(a.round.players.a.handsLeft).toBe(b.round.players.a.handsLeft)
	})

	it('a resend after a run-out does not subtract it twice', () => {
		let s = must(reduceBlindStart(notStarted(), 'a', start(5)))
		s = ranOut(s)
		expect(s.round.players.a.handsLeft).toBe(4)
		// the same blind_start again (a retry), then one a rejoined client sends
		// having counted the run-out already
		expect(reduceBlindStart(s, 'a', start(5))).toEqual({
			ok: true,
			state: s,
			changed: [],
		})
		expect(
			reduceBlindStart(s, 'a', start(4, { timerLossesApplied: 1 })),
		).toEqual({ ok: true, state: s, changed: [] })
		const hands = must(
			reduceHand(s, 'a', hand({ handsLeft: 4, timerLossesApplied: 1 })),
		)
		expect(hands.round.players.a.handsLeft).toBe(4)
	})

	it.each([
		['a missing timerLossesApplied', { timerLossesApplied: undefined }],
		['a negative count', { timerLossesApplied: -1 }],
		['a text count', { timerLossesApplied: '0' }],
		['a missing handsLeft', { handsLeft: undefined }],
	])('a resend carrying %s is bad_payload, not an ok no-op', (_name, over) => {
		const s = must(reduceBlindStart(notStarted(), 'a', start(7)))
		expect(reduceBlindStart(s, 'a', start(7, over))).toEqual({
			ok: false,
			reason: 'bad_payload',
		})
	})

	it('a resend whose applied count is above the server losses still answers ok', () => {
		const s = must(reduceBlindStart(notStarted(), 'a', start(5)))
		expect(
			reduceBlindStart(s, 'a', start(4, { timerLossesApplied: 3 })),
		).toEqual({ ok: true, state: s, changed: [] })
	})

	it('a first hand scoring 0 is stamped and counts', () => {
		const s = must(reduceHand(game(), 'a', hand({ score: '0', handsLeft: 3 })))
		expect(s.facts.handRound.a).toBe(3)
		expect(s.round.players.a).toMatchObject({ score: '0', handsLeft: 3 })
		expect(maskedFor(s, 'a')).toBe(false)
	})

	describe('a player who has not started (handsLeft unknown)', () => {
		const world: TimerWorld = {
			readyIds: [],
			requiredIds: ['a', 'b'],
			opponentOf: (id) => (id === 'a' ? 'b' : 'a'),
			firstPlayer: 'a',
		}
		// b has played and is ahead; a has not started.
		const startedBefore = (): RefereeState => {
			const idle = notStarted()
			return must(
				reduceHand(
					{
						...idle,
						round: {
							...idle.round,
							players: {
								...idle.round.players,
								b: reportedPlayer({ ante: 2 }),
							},
						},
					},
					'b',
					hand({ score: '500', handsLeft: 3 }),
				),
			)
		}

		it('is masked and is not out of hands', () => {
			const pre = startedBefore()
			expect(pre.round.players.a.handsLeft).toBeNull()
			expect(maskedFor(pre, 'a')).toBe(true)
			expect(allOutOfHands(pre, ['a'])).toBe(false)
			expect(allOutOfHands(pre, ['a', 'b'])).toBe(false)
		})

		it.each([1, 4, 9])(
			'and stays masked after a blind_start of %d',
			(count) => {
				const pre = startedBefore()
				const post = must(reduceBlindStart(pre, 'a', start(count)))
				expect(post.round.players.a.handsLeft).toBe(count)
				expect(maskedFor(post, 'a')).toBe(true)
				expect(maskedFor(pre, 'b')).toBe(maskedFor(post, 'b'))
				expect(allOutOfHands(post, ['a'])).toBe(false)
			},
		)

		it('cannot be timed against (not_started)', () => {
			const pre = startedBefore()
			const timing = wouldTime('pvp', 'b', pre, world)
			expect(timing).toEqual({ ok: false, reason: 'not_started' })
		})
	})
})

describe('the wire fixtures feed the reducers', () => {
	it('request_blind_start.json is an ok blind_start for a player who has not started', () => {
		const request = JSON.parse(
			readFileSync(
				new URL(
					'../__fixtures__/net-v1/request_blind_start.json',
					import.meta.url,
				),
				'utf8',
			),
		) as { payload: object }
		const state: RefereeState = JSON.parse(
			JSON.stringify(notStarted()).split('"r1"').join('"r-abc"'),
		)
		const r = reduceBlindStart(state, 'a', request.payload)
		expect(r.ok).toBe(true)
		expect(must(r).round.players.a.handsLeft).toBe(5)
	})
})
