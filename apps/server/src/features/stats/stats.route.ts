import { Router } from 'express'
import { db } from '../../infrastructure/db/index.js'
import {
	matchmakingMatches,
	matchmakingRatings,
	players,
	seasons,
} from '../../infrastructure/db/schema.js'
import { and, asc, eq, sql } from 'drizzle-orm'
import { getCurrentSeason } from '../../infrastructure/gateways/matchmaking.gateway.js'
import { PLACEMENT_GAMES } from '../matchmaking/elo.service.js'
import { AppError } from '../../shared/utils/errors.js'

const router = Router()

// Legacy match total from the old www system (Seasons 1–6).
// Unique players is not carried forward — account systems don't overlap.
const LEGACY_MATCHES = 453_792
const LEGACY_UNIQUE_PLAYERS = 0

let cache: { activePlayers: number; totalMatches: number; uniquePlayers: number } | null = null
let cacheAt = 0
const CACHE_TTL_MS = 5 * 60 * 1000

router.get('/', async (_req, res, next) => {
	try {
		const now = Date.now()
		if (cache && now - cacheAt < CACHE_TTL_MS) {
			res.json(cache)
			return
		}

		const [matchRow, playerRow] = await Promise.all([
			db.select({ total: sql<number>`count(*)::int` }).from(matchmakingMatches),
			db.select({ total: sql<number>`count(*)::int` }).from(players),
		])

		cache = {
			activePlayers: 0,
			totalMatches: LEGACY_MATCHES + (matchRow[0]?.total ?? 0),
			uniquePlayers: LEGACY_UNIQUE_PLAYERS + (playerRow[0]?.total ?? 0),
		}
		cacheAt = now

		res.json(cache)
	} catch (err) {
		next(err)
	}
})

router.get('/leaderboard', async (req, res, next) => {
	try {
		const { modId, gameMode, season } = req.query
		if (!modId || typeof modId !== 'string') throw new AppError('Missing modId', 400)
		if (!gameMode || typeof gameMode !== 'string') throw new AppError('Missing gameMode', 400)

		let seasonId: number
		if (season !== undefined) {
			const parsed = Number(season)
			if (Number.isNaN(parsed)) throw new AppError('Invalid season', 400)
			seasonId = parsed
		} else {
			const active = await getCurrentSeason()
			if (!active) throw new AppError('No active season', 404)
			seasonId = active.id
		}

		// Paginate over the full ranked list (matchmaking_ratings is the source of
		// truth; leaderboard_cache only holds the top 100). Rank is a window
		// function over the whole board (rating desc, wins desc), so an optional
		// name search returns matching players with their true global rank,
		// spanning every page rather than just the current one.
		const page = Math.max(1, Number(req.query.page ?? 1))
		const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 100)))
		const offset = (page - 1) * pageSize
		const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''
		const term = search ? `%${search}%` : null

		const totalRes = await db.execute(sql`
			SELECT count(*)::int AS total
			FROM matchmaking_ratings r
			JOIN players p ON p.id = r.player_id
			WHERE r.mod_id = ${modId} AND r.game_mode = ${gameMode} AND r.season = ${seasonId}
			  AND r.games_played >= ${PLACEMENT_GAMES}
			  ${term ? sql`AND (p.steam_name ILIKE ${term} OR p.discord_username ILIKE ${term})` : sql``}
		`)
		const total = Number((totalRes.rows[0] as { total: number } | undefined)?.total ?? 0)

		const rowsRes = await db.execute(sql`
			SELECT rank, player_id, display_name, rating, wins, losses, games_played, season_best
			FROM (
				SELECT
					r.player_id,
					CASE WHEN p.use_discord_name AND p.discord_username IS NOT NULL
					     THEN p.discord_username ELSE p.steam_name END AS display_name,
					p.steam_name, p.discord_username,
					r.rating, r.wins, r.losses, r.games_played, r.season_best,
					ROW_NUMBER() OVER (ORDER BY r.rating DESC, r.wins DESC, r.player_id ASC) AS rank
				FROM matchmaking_ratings r
				JOIN players p ON p.id = r.player_id
				WHERE r.mod_id = ${modId} AND r.game_mode = ${gameMode} AND r.season = ${seasonId}
				  AND r.games_played >= ${PLACEMENT_GAMES}
			) ranked
			${term ? sql`WHERE (ranked.steam_name ILIKE ${term} OR ranked.discord_username ILIKE ${term})` : sql``}
			ORDER BY rank
			LIMIT ${pageSize} OFFSET ${offset}
		`)

		const entries = rowsRes.rows.map((row) => {
			const r = row as Record<string, unknown>
			return {
				rank: Number(r.rank),
				playerId: r.player_id as string,
				displayName: r.display_name as string,
				rating: Number(r.rating),
				wins: Number(r.wins),
				losses: Number(r.losses),
				gamesPlayed: Number(r.games_played),
				seasonBest: r.season_best == null ? null : Number(r.season_best),
			}
		})

		res.json({
			season: seasonId,
			modId,
			gameMode,
			page,
			pageSize,
			total,
			totalPages: Math.max(1, Math.ceil(total / pageSize)),
			entries,
		})
	} catch (err) {
		next(err)
	}
})

router.get('/seasons', async (_req, res, next) => {
	try {
		const rows = await db
			.select({
				id: seasons.id,
				name: seasons.name,
				startedAt: seasons.startedAt,
				endsAt: seasons.endsAt,
				endedAt: seasons.endedAt,
			})
			.from(seasons)
			.orderBy(asc(seasons.id))

		const active = await getCurrentSeason()
		res.json({ seasons: rows, current: active?.id ?? null })
	} catch (err) {
		next(err)
	}
})

router.get('/players/:id', async (req, res, next) => {
	try {
		const { id } = req.params
		const { modId, gameMode, season } = req.query
		if (!modId || typeof modId !== 'string') throw new AppError('Missing modId', 400)
		if (!gameMode || typeof gameMode !== 'string') throw new AppError('Missing gameMode', 400)

		let seasonId: number
		if (season !== undefined) {
			const parsed = Number(season)
			if (Number.isNaN(parsed)) throw new AppError('Invalid season', 400)
			seasonId = parsed
		} else {
			const active = await getCurrentSeason()
			if (!active) throw new AppError('No active season', 404)
			seasonId = active.id
		}

		const [player] = await db
			.select({
				id: players.id,
				steamName: players.steamName,
				discordUsername: players.discordUsername,
				useDiscordName: players.useDiscordName,
				preferredJoker: players.preferredJoker,
				createdAt: players.createdAt,
			})
			.from(players)
			.where(eq(players.id, id))
			.limit(1)

		if (!player) throw new AppError('Player not found', 404)

		const board = and(
			eq(matchmakingRatings.modId, modId),
			eq(matchmakingRatings.gameMode, gameMode),
			eq(matchmakingRatings.season, seasonId),
		)

		const [r] = await db
			.select({
				rating: matchmakingRatings.rating,
				wins: matchmakingRatings.wins,
				losses: matchmakingRatings.losses,
				gamesPlayed: matchmakingRatings.gamesPlayed,
				seasonBest: matchmakingRatings.seasonBest,
			})
			.from(matchmakingRatings)
			.where(and(board, eq(matchmakingRatings.playerId, id)))
			.limit(1)

		// Rank from the full ratings table (not the top-100 cache), using the exact
		// same ROW_NUMBER ordering as the leaderboard so the two always agree.
		// Established players only (placement players don't appear -> rank null).
		const rankRes = await db.execute(sql`
			SELECT rank FROM (
				SELECT player_id,
					ROW_NUMBER() OVER (ORDER BY rating DESC, wins DESC, player_id ASC) AS rank
				FROM matchmaking_ratings
				WHERE mod_id = ${modId} AND game_mode = ${gameMode} AND season = ${seasonId}
				  AND games_played >= ${PLACEMENT_GAMES}
			) t
			WHERE player_id = ${id}
		`)
		const rankRow = rankRes.rows[0] as { rank: string | number } | undefined
		const rank = rankRow ? Number(rankRow.rank) : null
		const rating = rank !== null && r ? r.rating : null

		res.json({
			playerId: player.id,
			displayName:
				player.useDiscordName && player.discordUsername
					? player.discordUsername
					: player.steamName,
			steamName: player.steamName,
			preferredJoker: player.preferredJoker,
			createdAt: player.createdAt,
			season: seasonId,
			modId,
			gameMode,
			rank,
			rating,
			wins: r?.wins ?? null,
			losses: r?.losses ?? null,
			gamesPlayed: r?.gamesPlayed ?? null,
			seasonBest: r?.seasonBest ?? null,
		})
	} catch (err) {
		next(err)
	}
})

export default router
