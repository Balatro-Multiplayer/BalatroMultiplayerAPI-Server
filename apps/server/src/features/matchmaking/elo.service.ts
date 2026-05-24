export const MATCHING_INTERVAL_MS = 2_000
export const INITIAL_HIDDEN_RATING = 600
export const PLACEMENT_GAMES = 5
export const K_ESTABLISHED = 40
export const RATING_FLOOR = 100
export const SOFT_RESET_ANCHOR = 1200
export const RANKED_SPREAD_INITIAL = 150
export const RANKED_SPREAD_EXPAND_RATE = 50
export const RANKED_SPREAD_CAP = 600
export const DECAY_INACTIVE_THRESHOLD_DAYS = 7
export const DECAY_RATE_PER_DAY = 5
export const LEADERBOARD_TOP_N = 100

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value))
}

// K-factor for a player. Placement games use a decaying base K scaled by performance.
export function effectiveK(gamesPlayed: number, performance: number): number {
	if (gamesPlayed >= PLACEMENT_GAMES) return K_ESTABLISHED
	const baseK = 200 - gamesPlayed * 40
	return baseK * (1 + clamp(performance, 0, 1))
}

// Probability that A beats B given their ratings.
export function expectedScore(ratingA: number, ratingB: number): number {
	return 1 / (1 + 10 ** ((ratingB - ratingA) / 400))
}

// 1v1 Elo delta. Returns integer-rounded deltas.
export function compute1v1(
	a: { rating: number; gamesPlayed: number; performance: number },
	b: { rating: number; gamesPlayed: number; performance: number },
	outcome: 'a_wins' | 'b_wins' | 'draw',
): { deltaA: number; deltaB: number } {
	const ea = expectedScore(a.rating, b.rating)
	const eb = 1 - ea
	let sa: number
	let sb: number
	if (outcome === 'a_wins') {
		sa = 1
		sb = 0
	} else if (outcome === 'b_wins') {
		sa = 0
		sb = 1
	} else {
		sa = 0.5
		sb = 0.5
	}
	const ka = effectiveK(a.gamesPlayed, a.performance)
	const kb = effectiveK(b.gamesPlayed, b.performance)
	return {
		deltaA: Math.round(ka * (sa - ea)),
		deltaB: Math.round(kb * (sb - eb)),
	}
}

// FFA: one winner, all others lose. Uses K/(N-1) per virtual matchup.
export function computeFFA(
	players: Array<{
		playerId: string
		rating: number
		gamesPlayed: number
		performance: number
		isWinner: boolean
	}>,
): Map<string, number> {
	const n = players.length
	if (n < 2) return new Map(players.map((p) => [p.playerId, 0]))

	const deltas = new Map<string, number>(players.map((p) => [p.playerId, 0]))
	const winner = players.find((p) => p.isWinner)
	if (!winner) return deltas

	const losers = players.filter((p) => !p.isWinner)
	const kDivisor = n - 1

	for (const loser of losers) {
		const ea = expectedScore(winner.rating, loser.rating)
		const eb = 1 - ea
		const ka = effectiveK(winner.gamesPlayed, winner.performance) / kDivisor
		const kb = effectiveK(loser.gamesPlayed, loser.performance) / kDivisor
		const winnerDelta = Math.round(ka * (1 - ea))
		const loserDelta = Math.round(kb * (0 - eb))
		deltas.set(winner.playerId, (deltas.get(winner.playerId) ?? 0) + winnerDelta)
		deltas.set(loser.playerId, (deltas.get(loser.playerId) ?? 0) + loserDelta)
	}

	return deltas
}

// Team mode: compute team averages, treat as 1v1, distribute equally per member.
export function computeTeam(
	teams: Array<
		Array<{ playerId: string; rating: number; gamesPlayed: number; performance: number }>
	>,
	winnerTeamIndex: number,
): Map<string, number> {
	const deltas = new Map<string, number>()

	if (teams.length !== 2) {
		for (const team of teams) {
			for (const p of team) deltas.set(p.playerId, 0)
		}
		return deltas
	}

	const avgRating = (team: (typeof teams)[number]) =>
		team.reduce((sum, p) => sum + p.rating, 0) / team.length

	const avgPerformance = (team: (typeof teams)[number]) =>
		team.reduce((sum, p) => sum + p.performance, 0) / team.length

	const avgGamesPlayed = (team: (typeof teams)[number]) =>
		team.reduce((sum, p) => sum + p.gamesPlayed, 0) / team.length

	const loserTeamIndex = winnerTeamIndex === 0 ? 1 : 0
	const winner = teams[winnerTeamIndex]
	const loser = teams[loserTeamIndex]

	const winnerAvg = {
		rating: avgRating(winner),
		gamesPlayed: avgGamesPlayed(winner),
		performance: avgPerformance(winner),
	}
	const loserAvg = {
		rating: avgRating(loser),
		gamesPlayed: avgGamesPlayed(loser),
		performance: avgPerformance(loser),
	}

	const { deltaA, deltaB } = compute1v1(winnerAvg, loserAvg, 'a_wins')

	for (const p of winner) deltas.set(p.playerId, deltaA)
	for (const p of loser) deltas.set(p.playerId, deltaB)

	return deltas
}

// Seasonal soft reset: compress distance above 1200 by half.
export function applySoftReset(rating: number): number {
	if (rating > SOFT_RESET_ANCHOR) {
		return Math.round(SOFT_RESET_ANCHOR + (rating - SOFT_RESET_ANCHOR) / 2)
	}
	return rating
}
