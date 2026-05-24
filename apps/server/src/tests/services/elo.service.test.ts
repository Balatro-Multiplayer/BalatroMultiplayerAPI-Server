import { describe, expect, it } from 'vitest'
import {
	K_ESTABLISHED,
	PLACEMENT_GAMES,
	RATING_FLOOR,
	SOFT_RESET_ANCHOR,
	applySoftReset,
	compute1v1,
	computeFFA,
	computeTeam,
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
				{ playerId: 'p1', rating: 1000, gamesPlayed: 10, performance: 0, isWinner: true },
			])
			expect(result.get('p1')).toBe(0)
		})

		it('returns zeros when no winner is marked', () => {
			const result = computeFFA([
				{ playerId: 'a', rating: 1000, gamesPlayed: 10, performance: 0, isWinner: false },
				{ playerId: 'b', rating: 1000, gamesPlayed: 10, performance: 0, isWinner: false },
			])
			expect(result.get('a')).toBe(0)
			expect(result.get('b')).toBe(0)
		})

		it('winner gains and loser loses in 2-player FFA', () => {
			const result = computeFFA([
				{ playerId: 'w', rating: 1000, gamesPlayed: 10, performance: 0, isWinner: true },
				{ playerId: 'l', rating: 1000, gamesPlayed: 10, performance: 0, isWinner: false },
			])
			expect(result.get('w')).toBeGreaterThan(0)
			expect(result.get('l')).toBeLessThan(0)
		})

		it('all losers receive negative delta in N-player FFA', () => {
			const result = computeFFA([
				{ playerId: 'w', rating: 1000, gamesPlayed: 10, performance: 0, isWinner: true },
				{ playerId: 'l1', rating: 1000, gamesPlayed: 10, performance: 0, isWinner: false },
				{ playerId: 'l2', rating: 1000, gamesPlayed: 10, performance: 0, isWinner: false },
				{ playerId: 'l3', rating: 1000, gamesPlayed: 10, performance: 0, isWinner: false },
			])
			expect(result.get('w')).toBeGreaterThan(0)
			expect(result.get('l1')).toBeLessThan(0)
			expect(result.get('l2')).toBeLessThan(0)
			expect(result.get('l3')).toBeLessThan(0)
		})

		it('equal-rated losers receive the same delta', () => {
			const result = computeFFA([
				{ playerId: 'w', rating: 1000, gamesPlayed: 10, performance: 0, isWinner: true },
				{ playerId: 'l1', rating: 1000, gamesPlayed: 10, performance: 0, isWinner: false },
				{ playerId: 'l2', rating: 1000, gamesPlayed: 10, performance: 0, isWinner: false },
			])
			expect(result.get('l1')).toBe(result.get('l2'))
		})

		it('includes all player IDs in the result', () => {
			const players = [
				{ playerId: 'a', rating: 1000, gamesPlayed: 10, performance: 0, isWinner: true },
				{ playerId: 'b', rating: 1000, gamesPlayed: 10, performance: 0, isWinner: false },
				{ playerId: 'c', rating: 1000, gamesPlayed: 10, performance: 0, isWinner: false },
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

	describe('applySoftReset', () => {
		it('leaves ratings at or below SOFT_RESET_ANCHOR unchanged', () => {
			expect(applySoftReset(SOFT_RESET_ANCHOR)).toBe(SOFT_RESET_ANCHOR)
			expect(applySoftReset(1000)).toBe(1000)
			expect(applySoftReset(RATING_FLOOR)).toBe(RATING_FLOOR)
		})

		it('compresses ratings above anchor toward anchor by half', () => {
			// 1600 → 1200 + (400)/2 = 1400
			expect(applySoftReset(1600)).toBe(1400)
			// 2400 → 1200 + (1200)/2 = 1800
			expect(applySoftReset(2400)).toBe(1800)
		})

		it('result is always >= SOFT_RESET_ANCHOR for any input above anchor', () => {
			expect(applySoftReset(99_999)).toBeGreaterThanOrEqual(SOFT_RESET_ANCHOR)
		})

		it('approaches anchor for extreme ratings', () => {
			const result = applySoftReset(99_999)
			// Still above anchor but reasonable
			expect(result).toBeLessThan(99_999)
			expect(result).toBeGreaterThan(SOFT_RESET_ANCHOR)
		})
	})
})
