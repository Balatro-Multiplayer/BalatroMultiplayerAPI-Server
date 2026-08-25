import type { PlacementEntry } from '../../shared/types/index.js'

export const MATCHING_INTERVAL_MS = 2_000
// §16.x: how long a queue that has reached minPlayers but not maxPlayers holds
// off committing, to give a fuller lobby a chance to form before falling back
// to the smaller group. Measured from the oldest queuedAt among the entries
// that would be collected into that group.
export const QUEUE_FILL_GRACE_MS = 15_000
export const INITIAL_HIDDEN_RATING = 600
export const PLACEMENT_GAMES = 5
export const K_ESTABLISHED = 40
export const RATING_FLOOR = 100
// §11.10: the hard cap applySoftReset clamps down to after the symmetric pull
// toward INITIAL_HIDDEN_RATING -- not itself the pull target.
export const SOFT_RESET_ANCHOR = 1200
export const RANKED_SPREAD_INITIAL = 150
export const RANKED_SPREAD_EXPAND_RATE = 50
export const RANKED_SPREAD_CAP = 600
// §11.x: widened from the textbook 400 so wide-spread ranked matches (up to
// RANKED_SPREAD_CAP) stay worth playing for the favourite -- a 600-point
// favourite's win now nets ~8 rating instead of ~1.
export const ELO_SCALE = 1000
export const DECAY_INACTIVE_THRESHOLD_DAYS = 7
export const DECAY_RATE_PER_DAY = 5
export const LEADERBOARD_TOP_N = 100

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value))
}

// Placement games use a decaying base K scaled by performance.
export function effectiveK(gamesPlayed: number, performance: number): number {
	if (gamesPlayed >= PLACEMENT_GAMES) return K_ESTABLISHED
	const baseK = 200 - gamesPlayed * 40
	return baseK * (1 + clamp(performance, 0, 1))
}

export function expectedScore(ratingA: number, ratingB: number): number {
	return 1 / (1 + 10 ** ((ratingB - ratingA) / ELO_SCALE))
}

// Returns integer-rounded deltas.
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

// FFA: every player is scored against every other player by relative place
// (lower place wins, equal place draws), each virtual matchup weighted
// K/(N-1). Ties -- including ties for first -- score as draws rather than
// collapsing to a single "the winner" who excludes any co-winners.
export function computeFFA(
	players: Array<{
		playerId: string
		rating: number
		gamesPlayed: number
		performance: number
		place: number
	}>,
): Map<string, number> {
	const n = players.length
	if (n < 2) return new Map(players.map((p) => [p.playerId, 0]))

	const kDivisor = n - 1
	const deltas = new Map<string, number>()

	for (const p of players) {
		const kp = effectiveK(p.gamesPlayed, p.performance) / kDivisor
		let sum = 0
		for (const q of players) {
			if (q.playerId === p.playerId) continue
			const score = p.place < q.place ? 1 : p.place > q.place ? 0 : 0.5
			const ep = expectedScore(p.rating, q.rating)
			sum += kp * (score - ep)
		}
		deltas.set(p.playerId, Math.round(sum))
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

// Seasonal soft reset (§11.9/§11.10): every rating is pulled halfway back
// toward the same starting value new players get (600), whether currently
// above or below it -- not just compressed down from above. Anything still
// above 1200 after that pull is then hard-clamped down to exactly 1200.
export function applySoftReset(rating: number): number {
	const pulled = Math.round(INITIAL_HIDDEN_RATING + (rating - INITIAL_HIDDEN_RATING) / 2)
	return Math.min(pulled, SOFT_RESET_ANCHOR)
}

export type RatingMode = 'solo' | 'ffa' | 'team'

export function detectRatingMode(placements: PlacementEntry[]): RatingMode {
	if (placements.some((p) => p.teamId)) return 'team'
	if (placements.length === 2) return 'solo'
	return 'ffa'
}

export function computeRatingDeltas(
	mode: RatingMode,
	placements: PlacementEntry[],
	ratings: ReadonlyMap<string, { rating: number; gamesPlayed: number }>,
): Map<string, number> {
	if (mode === 'solo') {
		const [a, b] = placements
		const ra = ratings.get(a.playerId)!
		const rb = ratings.get(b.playerId)!
		const outcome = a.place < b.place ? 'a_wins' : b.place < a.place ? 'b_wins' : 'draw'
		const { deltaA, deltaB } = compute1v1(
			{ rating: ra.rating, gamesPlayed: ra.gamesPlayed, performance: a.performance ?? 0 },
			{ rating: rb.rating, gamesPlayed: rb.gamesPlayed, performance: b.performance ?? 0 },
			outcome,
		)
		return new Map([
			[a.playerId, deltaA],
			[b.playerId, deltaB],
		])
	}

	if (mode === 'ffa') {
		return computeFFA(
			placements.map((p) => {
				const r = ratings.get(p.playerId)!
				return {
					playerId: p.playerId,
					rating: r.rating,
					gamesPlayed: r.gamesPlayed,
					performance: p.performance ?? 0,
					place: p.place,
				}
			}),
		)
	}

	const teamMap = new Map<string, PlacementEntry[]>()
	for (const p of placements) {
		const tid = p.teamId!
		if (!teamMap.has(tid)) teamMap.set(tid, [])
		teamMap.get(tid)!.push(p)
	}
	const teamEntries = Array.from(teamMap.entries())
	const winnerTeamPlace = Math.min(
		...teamEntries.map(([, members]) => Math.min(...members.map((m) => m.place))),
	)
	const winnerTeamIdx = teamEntries.findIndex(
		([, members]) => Math.min(...members.map((m) => m.place)) === winnerTeamPlace,
	)
	const teams = teamEntries.map(([, members]) =>
		members.map((m) => {
			const r = ratings.get(m.playerId)!
			return {
				playerId: m.playerId,
				rating: r.rating,
				gamesPlayed: r.gamesPlayed,
				performance: m.performance ?? 0,
			}
		}),
	)
	return computeTeam(teams, winnerTeamIdx)
}
