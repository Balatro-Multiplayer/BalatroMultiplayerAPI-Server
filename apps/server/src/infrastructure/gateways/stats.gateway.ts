import { sql } from 'drizzle-orm'
import type { IStatsRepository } from '../../contracts/IStatsSources.js'
import { PLACEMENT_GAMES } from '../../features/ratings/elo.js'
import { db } from '../db/index.js'
import { effectiveRating } from '../../features/ratings/effective-rating.js'
import { shownNameOf } from '../../shared/players/shown-name.js'
import { matchmakingMatches, players } from '../db/schema.js'
import { usernameBannedSql } from './ban.gateway.js'
import { getCurrentSeason } from './rating.gateway.js'

export interface LeaderboardQuery {
	modId: string
	gameMode: string
	seasonId: number
	/** A name search; matches the player's own names, never a Ban name. */
	term: string | null
}

export interface LeaderboardRow {
	rank: number
	playerId: string
	/** What every player sees: the Ban name while a username ban is in force. */
	displayName: string
	rating: number
	wins: number
	losses: number
	gamesPlayed: number
	seasonBest: unknown
	seasonBestText: string | null
}

/** How many players the board lists for the query. */
export async function countLeaderboard(q: LeaderboardQuery): Promise<number> {
	const res = await db.execute(sql`
		SELECT count(*)::int AS total
		FROM matchmaking_ratings r
		JOIN players p ON p.id = r.player_id
		WHERE r.mod_id = ${q.modId} AND r.game_mode = ${q.gameMode} AND r.season = ${q.seasonId}
		  AND r.games_played >= ${PLACEMENT_GAMES}
		  ${q.term ? sql`AND NOT ${usernameBannedSql} AND (p.steam_name ILIKE ${q.term} OR p.discord_username ILIKE ${q.term})` : sql``}
	`)
	return Number((res.rows[0] as { total: number } | undefined)?.total ?? 0)
}

/**
 * One page of the board. Rank is a window over the whole board, so a search
 * keeps each match's true global rank. The shown name comes from
 * `shownNameOf`, the one place that decides it.
 */
export async function leaderboardPage(
	q: LeaderboardQuery,
	pageSize: number,
	offset: number,
): Promise<LeaderboardRow[]> {
	const res = await db.execute(sql`
		SELECT rank, player_id, steam_name, discord_username, use_discord_name, nakama_user_id, username_banned,
		       rating, wins, losses, games_played, season_best, season_best_text
		FROM (
			SELECT
				r.player_id,
				p.steam_name, p.discord_username, p.use_discord_name, p.nakama_user_id,
				${usernameBannedSql} AS username_banned,
				${effectiveRating} AS rating, r.wins, r.losses, r.games_played, r.season_best, r.season_best_text,
				ROW_NUMBER() OVER (ORDER BY ${effectiveRating} DESC, r.wins DESC, r.player_id ASC) AS rank
			FROM matchmaking_ratings r
			JOIN players p ON p.id = r.player_id
			WHERE r.mod_id = ${q.modId} AND r.game_mode = ${q.gameMode} AND r.season = ${q.seasonId}
			  AND r.games_played >= ${PLACEMENT_GAMES}
		) ranked
		${q.term ? sql`WHERE (NOT ranked.username_banned AND (ranked.steam_name ILIKE ${q.term} OR ranked.discord_username ILIKE ${q.term}))` : sql``}
		ORDER BY rank
		LIMIT ${pageSize} OFFSET ${offset}
	`)
	return res.rows.map((row) => {
		const r = row as Record<string, unknown>
		return {
			rank: Number(r.rank),
			playerId: r.player_id as string,
			displayName: shownNameOf(
				{
					id: r.player_id as string,
					nakamaUserId: (r.nakama_user_id as string | null) ?? null,
					steamName: r.steam_name as string,
					discordUsername: (r.discord_username as string | null) ?? null,
					useDiscordName: Boolean(r.use_discord_name),
				},
				Boolean(r.username_banned),
			),
			rating: Number(r.rating),
			wins: Number(r.wins),
			losses: Number(r.losses),
			gamesPlayed: Number(r.games_played),
			seasonBest: r.season_best,
			seasonBestText: (r.season_best_text as string | null) ?? null,
		}
	})
}

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
