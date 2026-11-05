import { sql } from 'drizzle-orm'
import type { IStatsRepository } from '../../contracts/IStatsSources.js'
import { PLACEMENT_GAMES } from '../../features/ratings/elo.js'
import { db } from '../db/index.js'
import { matchmakingMatches, players } from '../db/schema.js'
import { getCurrentSeason } from './rating.gateway.js'

export const statsRepository: IStatsRepository = {
	async countTotals() {
		const [matchRow, playerRow] = await Promise.all([
			db.select({ total: sql<number>`count(*)::int` }).from(matchmakingMatches),
			db.select({ total: sql<number>`count(*)::int` }).from(players),
		])
		return {
			matches: matchRow[0]?.total ?? 0,
			players: playerRow[0]?.total ?? 0,
		}
	},
	// Same rows as the leaderboard list: a player row and the placement games.
	async countBoardEntries() {
		const season = await getCurrentSeason()
		if (!season) return { season: null, boards: [] }
		const res = await db.execute(sql`
			SELECT r.mod_id, r.game_mode, count(*)::int AS entries
			FROM matchmaking_ratings r
			JOIN players p ON p.id = r.player_id
			WHERE r.season = ${season.id} AND r.games_played >= ${PLACEMENT_GAMES}
			GROUP BY r.mod_id, r.game_mode
		`)
		return {
			season: season.id,
			boards: res.rows.map((row) => {
				const r = row as { mod_id: string; game_mode: string; entries: number }
				return {
					modId: r.mod_id,
					gameMode: r.game_mode,
					entries: Number(r.entries),
				}
			}),
		}
	},
}
