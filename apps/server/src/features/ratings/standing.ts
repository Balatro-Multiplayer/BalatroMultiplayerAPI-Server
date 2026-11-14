// How each rated player's game counts in wins and losses: the players on the best
// place win and the rest lose, unless every rated player shares the best place. That
// is a draw, no one's win and no one's loss. `[1,1,2]` is no draw (both first places
// win) and a single placement is no draw (a lone rated player keeps the win).
// Mirrors `standingsOf` in nakama/src/rating/apply.ts, which rates the live match;
// this copy serves the gateway that rebuilds a voided match. Change both together.
export type Standing = 'win' | 'loss' | 'draw'

export function standingsOf(
	placements: ReadonlyArray<{ playerId: string; place: number }>,
): Map<string, Standing> {
	const out = new Map<string, Standing>()
	if (placements.length === 0) return out
	const best = Math.min(...placements.map((p) => p.place))
	const draw =
		placements.length >= 2 && placements.every((p) => p.place === best)
	for (const p of placements)
		out.set(p.playerId, draw ? 'draw' : p.place === best ? 'win' : 'loss')
	return out
}

export interface Counters {
	wins: number
	losses: number
}

// The wins and losses after one more game that counted as `standing`.
export function nextCounters(
	counters: Counters,
	standing: Standing | undefined,
): Counters {
	return {
		wins: counters.wins + (standing === 'win' ? 1 : 0),
		losses: counters.losses + (standing === 'loss' ? 1 : 0),
	}
}
