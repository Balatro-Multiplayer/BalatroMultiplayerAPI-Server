import { describe, expect, it } from 'vitest'
import {
	INITIAL_HIDDEN_RATING,
	K_ESTABLISHED,
	PLACEMENT_GAMES,
	RATING_FLOOR,
	SOFT_RESET_ANCHOR,
	applySoftReset,
	compute1v1,
	computeFFA,
	computeRatingDeltas,
	computeTeam,
	detectRatingMode,
	effectiveK,
	expectedScore,
} from '../../features/matchmaking/elo.service.js'

describe('elo.service', () => {
	describe('effectiveK', () => {
		it('returns K_ESTABLISHED for players at or above PLACEMENT_GAMES', () => {
			expect(effectiveK(PLACEMENT_GAMES, 0.5)).toBe(K_ESTABLISHED)
			expect(effectiveK(PLACEMENT_GAMES + 1, 0.5)).toBe(K_ESTABLISHED)
			expect(effectiveK(100, 1)).toBe(K_ESTABLISHED)
		})

		it('returns higher K for placement players (game 0)', () => {
			// baseK = 200 - 0*40 = 200; performance = 0 → 200*(1+0) = 200
			expect(effectiveK(0, 0)).toBe(200)
		})

		it('scales down K with each placement game', () => {
			// game 1: baseK = 200 - 40 = 160
			expect(effectiveK(1, 0)).toBe(160)
			// game 2: baseK = 120
			expect(effectiveK(2, 0)).toBe(120)
			// game 4: baseK = 40 (last placement)
			expect(effectiveK(4, 0)).toBe(40)
		})

		it('scales K by performance during placement', () => {
			// game 0: baseK = 200; performance 1 → 200*(1+1) = 400
			expect(effectiveK(0, 1)).toBe(400)
			// game 0: performance 0.5 → 200*(1+0.5) = 300
			expect(effectiveK(0, 0.5)).toBe(300)
		})

		it('clamps performance below 0 to 0', () => {
			// performance -1 → clamped to 0 → 200*(1+0) = 200
			expect(effectiveK(0, -1)).toBe(200)
		})

		it('clamps performance above 1 to 1', () => {
			// performance 2 → clamped to 1 → 200*(1+1) = 400
			expect(effectiveK(0, 2)).toBe(400)
		})
	})

	describe('expectedScore', () => {
		it('returns 0.5 for equal ratings', () => {
			expect(expectedScore(1000, 1000)).toBeCloseTo(0.5)
			expect(expectedScore(600, 600)).toBeCloseTo(0.5)
		})

		it('returns > 0.5 when A is rated higher than B', () => {
			expect(expectedScore(1200, 800)).toBeGreaterThan(0.5)
		})

		it('returns < 0.5 when A is rated lower than B', () => {
			expect(expectedScore(800, 1200)).toBeLessThan(0.5)
		})

		it('approaches 1 for very large rating advantage', () => {
			expect(expectedScore(3000, 100)).toBeGreaterThan(0.99)
		})

		it('expected scores for A and B sum to 1', () => {
			const ea = expectedScore(1400, 1000)
			const eb = expectedScore(1000, 1400)
			expect(ea + eb).toBeCloseTo(1)
		})
	})

	describe('compute1v1', () => {
		const equal = { rating: 1000, gamesPlayed: 10, performance: 0 }

		it('winner gains and loser loses the same amount at equal ratings', () => {
			const { deltaA, deltaB } = compute1v1(equal, equal, 'a_wins')
			expect(deltaA).toBeGreaterThan(0)
			expect(deltaB).toBeLessThan(0)
			expect(deltaA).toBe(-deltaB)
		})

		it('draw at equal ratings produces zero deltas', () => {
			const { deltaA, deltaB } = compute1v1(equal, equal, 'draw')
			expect(deltaA).toBe(0)
			expect(deltaB).toBe(0)
		})

		it('b_wins produces exactly opposite deltas to a_wins for the same players', () => {
			const p = { rating: 1000, gamesPlayed: 10, performance: 0 }
			const q = { rating: 1000, gamesPlayed: 10, performance: 0 }
			const aWins = compute1v1(p, q, 'a_wins')
			const bWins = compute1v1(p, q, 'b_wins')
			expect(aWins.deltaA).toBe(-bWins.deltaA)
			expect(aWins.deltaB).toBe(-bWins.deltaB)
		})

		it('underdog gains more than even-match winner on an upset', () => {
			const strong = { rating: 1400, gamesPlayed: 10, performance: 0 }
			const weak = { rating: 1000, gamesPlayed: 10, performance: 0 }
			const upset = compute1v1(weak, strong, 'a_wins')
			const even = compute1v1(equal, equal, 'a_wins')
			expect(upset.deltaA).toBeGreaterThan(even.deltaA)
		})

		it('favourite gains less than even-match winner on expected win', () => {
			const strong = { rating: 1400, gamesPlayed: 10, performance: 0 }
			const weak = { rating: 1000, gamesPlayed: 10, performance: 0 }
			const expected = compute1v1(strong, weak, 'a_wins')
			const even = compute1v1(equal, equal, 'a_wins')
			expect(expected.deltaA).toBeLessThan(even.deltaA)
		})

		it('placement K produces larger deltas than established K', () => {
			const placing = { rating: 1000, gamesPlayed: 0, performance: 0 }
			const estab = { rating: 1000, gamesPlayed: 10, performance: 0 }
			const { deltaA: placingDelta } = compute1v1(placing, placing, 'a_wins')
			const { deltaA: estabDelta } = compute1v1(estab, estab, 'a_wins')
			expect(Math.abs(placingDelta)).toBeGreaterThan(Math.abs(estabDelta))
		})
	})

	describe('computeFFA', () => {
		it('returns zero delta for single player', () => {
			const result = computeFFA([
				{ playerId: 'p1', rating: 1000, gamesPlayed: 10, performance: 0, place: 1 },
			])
			expect(result.get('p1')).toBe(0)
		})

		it('winner gains and loser loses in 2-player FFA', () => {
			const result = computeFFA([
				{ playerId: 'w', rating: 1000, gamesPlayed: 10, performance: 0, place: 1 },
				{ playerId: 'l', rating: 1000, gamesPlayed: 10, performance: 0, place: 2 },
			])
			expect(result.get('w')).toBeGreaterThan(0)
			expect(result.get('l')).toBeLessThan(0)
		})

		it('deltas are strictly ordered by place and zero-sum for equal-rated players', () => {
			// With every pairing scored against a 0.5 expectation, a
			// better-than-median finish (e.g. 2nd of 4) can still net
			// positive -- only last place is guaranteed negative. This is
			// the correct round-robin generalization, unlike the old
			// winner-take-all model where every non-winner was negative
			// regardless of how many players they outplaced.
			const result = computeFFA([
				{ playerId: 'w', rating: 1000, gamesPlayed: 10, performance: 0, place: 1 },
				{ playerId: 'l1', rating: 1000, gamesPlayed: 10, performance: 0, place: 2 },
				{ playerId: 'l2', rating: 1000, gamesPlayed: 10, performance: 0, place: 3 },
				{ playerId: 'l3', rating: 1000, gamesPlayed: 10, performance: 0, place: 4 },
			])
			expect(result.get('w')!).toBeGreaterThan(result.get('l1')!)
			expect(result.get('l1')!).toBeGreaterThan(result.get('l2')!)
			expect(result.get('l2')!).toBeGreaterThan(result.get('l3')!)
			expect(result.get('w')).toBeGreaterThan(0)
			expect(result.get('l3')).toBeLessThan(0)
			const total = [...result.values()].reduce((sum, d) => sum + d, 0)
			expect(total).toBe(0)
		})

		it('equal-rated equal-place losers receive the same delta', () => {
			const result = computeFFA([
				{ playerId: 'w', rating: 1000, gamesPlayed: 10, performance: 0, place: 1 },
				{ playerId: 'l1', rating: 1000, gamesPlayed: 10, performance: 0, place: 2 },
				{ playerId: 'l2', rating: 1000, gamesPlayed: 10, performance: 0, place: 2 },
			])
			expect(result.get('l1')).toBe(result.get('l2'))
		})

		it('a worse place than another loser still loses more (mid-table placement matters)', () => {
			const result = computeFFA([
				{ playerId: 'w', rating: 1000, gamesPlayed: 10, performance: 0, place: 1 },
				{ playerId: 'second', rating: 1000, gamesPlayed: 10, performance: 0, place: 2 },
				{ playerId: 'last', rating: 1000, gamesPlayed: 10, performance: 0, place: 3 },
			])
			expect(result.get('last')!).toBeLessThan(result.get('second')!)
		})

		it('co-winners tied for first both gain -- neither is silently zeroed', () => {
			// Regression test: a prior implementation picked only the first
			// same-place entry as "the" winner, so a tied co-winner listed
			// second in the array got excluded from both the winner and
			// loser paths and ended up with a delta of exactly 0.
			const result = computeFFA([
				{ playerId: 'w1', rating: 1000, gamesPlayed: 10, performance: 0, place: 1 },
				{ playerId: 'w2', rating: 1000, gamesPlayed: 10, performance: 0, place: 1 },
				{ playerId: 'l', rating: 1000, gamesPlayed: 10, performance: 0, place: 3 },
			])
			expect(result.get('w1')).toBeGreaterThan(0)
			expect(result.get('w2')).toBeGreaterThan(0)
			expect(result.get('w1')).toBe(result.get('w2'))
			expect(result.get('l')).toBeLessThan(0)
		})

		it('players tied at the same place score a draw against each other', () => {
			const tiedForFirst = computeFFA([
				{ playerId: 'w1', rating: 1000, gamesPlayed: 10, performance: 0, place: 1 },
				{ playerId: 'w2', rating: 1000, gamesPlayed: 10, performance: 0, place: 1 },
			])
			// Two equal-rated players who tie score expectedScore = 0.5 each
			// with outcome 0.5 each -- a wash, same as compute1v1's draw case.
			expect(tiedForFirst.get('w1')).toBe(0)
			expect(tiedForFirst.get('w2')).toBe(0)
		})

		it('includes all player IDs in the result', () => {
			const players = [
				{ playerId: 'a', rating: 1000, gamesPlayed: 10, performance: 0, place: 1 },
				{ playerId: 'b', rating: 1000, gamesPlayed: 10, performance: 0, place: 2 },
				{ playerId: 'c', rating: 1000, gamesPlayed: 10, performance: 0, place: 2 },
			]
			const result = computeFFA(players)
			expect(result.has('a')).toBe(true)
			expect(result.has('b')).toBe(true)
			expect(result.has('c')).toBe(true)
		})
	})

	describe('computeTeam', () => {
		it('returns zeros for non-2-team input', () => {
			const teams = [
				[{ playerId: 'a', rating: 1000, gamesPlayed: 10, performance: 0 }],
				[{ playerId: 'b', rating: 1000, gamesPlayed: 10, performance: 0 }],
				[{ playerId: 'c', rating: 1000, gamesPlayed: 10, performance: 0 }],
			]
			const result = computeTeam(teams, 0)
			expect(result.get('a')).toBe(0)
			expect(result.get('b')).toBe(0)
			expect(result.get('c')).toBe(0)
		})

		it('winning team gains and losing team loses at equal ratings', () => {
			const teams = [
				[{ playerId: 'w', rating: 1000, gamesPlayed: 10, performance: 0 }],
				[{ playerId: 'l', rating: 1000, gamesPlayed: 10, performance: 0 }],
			]
			const result = computeTeam(teams, 0)
			expect(result.get('w')).toBeGreaterThan(0)
			expect(result.get('l')).toBeLessThan(0)
		})

		it('equal-rated equal-sized teams have symmetric deltas', () => {
			const teams = [
				[{ playerId: 'w', rating: 1000, gamesPlayed: 10, performance: 0 }],
				[{ playerId: 'l', rating: 1000, gamesPlayed: 10, performance: 0 }],
			]
			const result = computeTeam(teams, 0)
			expect(result.get('w')).toBe(-(result.get('l') ?? 0))
		})

		it('all winning team members receive the same delta', () => {
			const teams = [
				[
					{ playerId: 'w1', rating: 1000, gamesPlayed: 10, performance: 0 },
					{ playerId: 'w2', rating: 1000, gamesPlayed: 10, performance: 0 },
				],
				[{ playerId: 'l', rating: 1000, gamesPlayed: 10, performance: 0 }],
			]
			const result = computeTeam(teams, 0)
			expect(result.get('w1')).toBe(result.get('w2'))
			expect(result.get('w1')).toBeGreaterThan(0)
		})

		it('winnerTeamIndex selects which team wins', () => {
			const teams = [
				[{ playerId: 'a', rating: 1000, gamesPlayed: 10, performance: 0 }],
				[{ playerId: 'b', rating: 1000, gamesPlayed: 10, performance: 0 }],
			]
			const aWins = computeTeam(teams, 0)
			const bWins = computeTeam(teams, 1)
			expect(aWins.get('a')).toBeGreaterThan(0)
			expect(bWins.get('b')).toBeGreaterThan(0)
			expect(aWins.get('a')).toBe(bWins.get('b'))
		})
	})

	describe('detectRatingMode', () => {
		it('returns solo for two placements with no teamId', () => {
			expect(detectRatingMode([
				{ playerId: 'a', place: 1 },
				{ playerId: 'b', place: 2 },
			])).toBe('solo')
		})

		it('returns ffa for three or more placements with no teamId', () => {
			expect(detectRatingMode([
				{ playerId: 'a', place: 1 },
				{ playerId: 'b', place: 2 },
				{ playerId: 'c', place: 3 },
			])).toBe('ffa')
		})

		it('returns team when any placement has a teamId', () => {
			expect(detectRatingMode([
				{ playerId: 'a', place: 1, teamId: 't1' },
				{ playerId: 'b', place: 2, teamId: 't2' },
			])).toBe('team')
		})

		it('returns team even for two placements when teamId is present', () => {
			expect(detectRatingMode([
				{ playerId: 'a', place: 1, teamId: 't1' },
				{ playerId: 'b', place: 1, teamId: 't1' },
				{ playerId: 'c', place: 2, teamId: 't2' },
				{ playerId: 'd', place: 2, teamId: 't2' },
			])).toBe('team')
		})
	})

	describe('computeRatingDeltas', () => {
		const r = (rating = 1000, gamesPlayed = 10) => ({ rating, gamesPlayed })

		describe('solo mode', () => {
			it('winner gains positive delta, loser negative', () => {
				const ratings = new Map([['a', r()], ['b', r()]])
				const deltas = computeRatingDeltas(
					'solo',
					[{ playerId: 'a', place: 1 }, { playerId: 'b', place: 2 }],
					ratings,
				)
				expect(deltas.get('a')).toBeGreaterThan(0)
				expect(deltas.get('b')).toBeLessThan(0)
			})

			it('draw produces near-zero deltas for equal-rated players', () => {
				const ratings = new Map([['a', r()], ['b', r()]])
				const deltas = computeRatingDeltas(
					'solo',
					[{ playerId: 'a', place: 1 }, { playerId: 'b', place: 1 }],
					ratings,
				)
				expect(deltas.get('a')).toBe(0)
				expect(deltas.get('b')).toBe(0)
			})

			it('includes both players in result', () => {
				const ratings = new Map([['a', r()], ['b', r()]])
				const deltas = computeRatingDeltas(
					'solo',
					[{ playerId: 'a', place: 1 }, { playerId: 'b', place: 2 }],
					ratings,
				)
				expect(deltas.has('a')).toBe(true)
				expect(deltas.has('b')).toBe(true)
			})
		})

		describe('ffa mode', () => {
			it('winner gains, last place loses, placements ordered in between', () => {
				const ratings = new Map([['a', r()], ['b', r()], ['c', r()]])
				const deltas = computeRatingDeltas(
					'ffa',
					[
						{ playerId: 'a', place: 1 },
						{ playerId: 'b', place: 2 },
						{ playerId: 'c', place: 3 },
					],
					ratings,
				)
				expect(deltas.get('a')).toBeGreaterThan(0)
				expect(deltas.get('c')).toBeLessThan(0)
				expect(deltas.get('a')!).toBeGreaterThan(deltas.get('b')!)
				expect(deltas.get('b')!).toBeGreaterThan(deltas.get('c')!)
			})

			it('co-winners tied for first both gain in a real 3-player match shape', () => {
				// Regression test for the live bug: a 3-player match where two
				// players tied for 1st used to silently zero the delta for
				// whichever tied winner was NOT first in the placements array.
				const ratings = new Map([['a', r()], ['b', r()], ['c', r()]])
				const deltas = computeRatingDeltas(
					'ffa',
					[
						{ playerId: 'a', place: 1 },
						{ playerId: 'b', place: 1 },
						{ playerId: 'c', place: 3 },
					],
					ratings,
				)
				expect(deltas.get('a')).toBeGreaterThan(0)
				expect(deltas.get('b')).toBeGreaterThan(0)
				expect(deltas.get('c')).toBeLessThan(0)
			})
		})

		describe('team mode', () => {
			it('winning team gains, losing team loses', () => {
				const ratings = new Map([
					['w1', r()], ['w2', r()],
					['l1', r()], ['l2', r()],
				])
				const deltas = computeRatingDeltas(
					'team',
					[
						{ playerId: 'w1', place: 1, teamId: 'team-a' },
						{ playerId: 'w2', place: 1, teamId: 'team-a' },
						{ playerId: 'l1', place: 2, teamId: 'team-b' },
						{ playerId: 'l2', place: 2, teamId: 'team-b' },
					],
					ratings,
				)
				expect(deltas.get('w1')).toBeGreaterThan(0)
				expect(deltas.get('w2')).toBeGreaterThan(0)
				expect(deltas.get('l1')).toBeLessThan(0)
				expect(deltas.get('l2')).toBeLessThan(0)
			})
		})
	})

	// §11.9/§11.10: every rating is pulled halfway back toward
	// INITIAL_HIDDEN_RATING (600) regardless of direction, then hard-clamped to
	// SOFT_RESET_ANCHOR (1200) if still above it.
	describe('applySoftReset', () => {
		it('leaves a rating exactly at the anchor unchanged', () => {
			expect(applySoftReset(INITIAL_HIDDEN_RATING)).toBe(INITIAL_HIDDEN_RATING)
		})

		it('pulls a rating above the anchor halfway back down', () => {
			// 1000 → 600 + (400)/2 = 800
			expect(applySoftReset(1000)).toBe(800)
		})

		it('pulls a rating below the anchor halfway back up (symmetric, not just compression from above)', () => {
			// 400 → 600 + (-200)/2 = 500
			expect(applySoftReset(400)).toBe(500)
			// RATING_FLOOR (100) → 600 + (-500)/2 = 350
			expect(applySoftReset(RATING_FLOOR)).toBe(350)
		})

		it('hard-clamps to SOFT_RESET_ANCHOR when the pulled value is still above it', () => {
			// 2400 → pulled to 600 + 1800/2 = 1500, then clamped to 1200
			expect(applySoftReset(2400)).toBe(SOFT_RESET_ANCHOR)
		})

		it('never returns more than SOFT_RESET_ANCHOR for any input', () => {
			expect(applySoftReset(99_999)).toBe(SOFT_RESET_ANCHOR)
		})
	})
})
