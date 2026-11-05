import { seasonBestOut } from '../ratings/season-best.js'
import { and, asc, eq, sql } from 'drizzle-orm'
import { Router } from 'express'
import type {
	FetchMetrics,
	FetchQueueCounts,
	IStatsRepository,
} from '../../contracts/IStatsSources.js'
import { db } from '../../infrastructure/db/index.js'
import {
	matchmakingRatings,
	players,
	seasons,
} from '../../infrastructure/db/schema.js'
import { usernameBannedAmong } from '../../infrastructure/gateways/ban.gateway.js'
import { getCurrentSeason } from '../../infrastructure/gateways/rating.gateway.js'
import { countLeaderboard, leaderboardPage } from '../../infrastructure/gateways/stats.gateway.js'
import { AppError } from '../../shared/utils/errors.js'
import { MAX_PAGE, queryInt } from '../../shared/utils/query-int.js'
import { createTtlCache } from '../../shared/utils/ttl-cache.js'
import { shownNameOf } from '../../shared/players/shown-name.js'
import { PLACEMENT_GAMES } from '../ratings/elo.js'
import { effectiveRating } from '../ratings/effective-rating.js'
import { createOnlinePlayers } from './online-players.js'
import { createQueueStats } from './queue-counts.js'

// Legacy match total from the old www system (Seasons 1–6).
// Unique players is not carried forward — account systems don't overlap.
const LEGACY_MATCHES = 453_792
const LEGACY_UNIQUE_PLAYERS = 0

const TOTALS_TTL_MS = 5 * 60 * 1000
// Cached apart from the totals: the page polls them every 15 seconds.
const ONLINE_PLAYERS_TTL_MS = 10 * 1000
const QUEUE_STATS_TTL_MS = 10 * 1000
// The Leaderboards page orders its tabs by these counts.
const BOARD_COUNTS_TTL_MS = 10 * 60 * 1000

export interface StatsRouterDeps {
	fetchMetrics: FetchMetrics
	fetchQueueCounts: FetchQueueCounts
	statsRepository: IStatsRepository
}

export function createStatsRouter({
	fetchMetrics,
	fetchQueueCounts,
	statsRepository,
}: StatsRouterDeps): Router {
	const router = Router()

	const getTotals = createTtlCache(async () => {
		const counts = await statsRepository.countTotals()
		return {
			totalMatches: LEGACY_MATCHES + counts.matches,
			uniquePlayers: LEGACY_UNIQUE_PLAYERS + counts.players,
		}
	}, TOTALS_TTL_MS)
	const getBoardCounts = createTtlCache(async () => {
		const { season, boards } = await statsRepository.countBoardEntries()
		const counts: Record<string, Record<string, number>> = {}
		for (const board of boards) {
			counts[board.modId] ??= {}
			counts[board.modId][board.gameMode] = board.entries
		}
		return { season, counts }
	}, BOARD_COUNTS_TTL_MS)
	const getOnlinePlayers = createOnlinePlayers(
		fetchMetrics,
		ONLINE_PLAYERS_TTL_MS,
	)
	const getQueueStats = createQueueStats(fetchQueueCounts, QUEUE_STATS_TTL_MS)

	router.get('/', async (_req, res, next) => {
		try {
			const now = Date.now()
			const [onlinePlayers, totalCounts] = await Promise.all([
				getOnlinePlayers(now),
				getTotals(now),
			])
			res.json({ onlinePlayers, ...totalCounts })
		} catch (err) {
			next(err)
		}
	})

	router.get('/leaderboard', async (req, res, next) => {
		try {
			const { modId, gameMode, season } = req.query
			if (!modId || typeof modId !== 'string')
				throw new AppError('Missing modId', 400)
			if (!gameMode || typeof gameMode !== 'string')
				throw new AppError('Missing gameMode', 400)

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

			// Paginate over the full ranked list (matchmaking_ratings is the
			// source of truth). Rank is a window
			// function over the whole board (rating desc, wins desc), so an optional
			// name search returns matching players with their true global rank,
			// spanning every page rather than just the current one.
			const page = queryInt(req.query.page, 1, 1, MAX_PAGE)
			const pageSize = queryInt(req.query.pageSize, 100, 1, 200)
			const offset = (page - 1) * pageSize
			const search =
				typeof req.query.search === 'string' ? req.query.search.trim() : ''
			const term = search ? `%${search}%` : null

			const query = { modId, gameMode, seasonId, term }
			const [total, rows] = await Promise.all([
				countLeaderboard(query),
				leaderboardPage(query, pageSize, offset),
			])
			const entries = rows.map((r) => ({
				rank: r.rank,
				playerId: r.playerId,
				displayName: r.displayName,
				rating: r.rating,
				wins: r.wins,
				losses: r.losses,
				gamesPlayed: r.gamesPlayed,
				seasonBest: seasonBestOut({ seasonBest: r.seasonBest, seasonBestText: r.seasonBestText }),
			}))

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

	router.get('/leaderboard-counts', async (_req, res, next) => {
		try {
			res.json(await getBoardCounts(Date.now()))
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
			if (!modId || typeof modId !== 'string')
				throw new AppError('Missing modId', 400)
			if (!gameMode || typeof gameMode !== 'string')
				throw new AppError('Missing gameMode', 400)

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
					nakamaUserId: players.nakamaUserId,
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
			const banned = (await usernameBannedAmong([player.id])).has(player.id)
			const shown = shownNameOf(player, banned)

			const board = and(
				eq(matchmakingRatings.modId, modId),
				eq(matchmakingRatings.gameMode, gameMode),
				eq(matchmakingRatings.season, seasonId),
			)

			const [r] = await db
				.select({
					wins: matchmakingRatings.wins,
					losses: matchmakingRatings.losses,
					gamesPlayed: matchmakingRatings.gamesPlayed,
					seasonBest: matchmakingRatings.seasonBest,
					seasonBestText: matchmakingRatings.seasonBestText,
				})
				.from(matchmakingRatings)
				.where(and(board, eq(matchmakingRatings.playerId, id)))
				.limit(1)

			// Rank from the full ratings table (not the top-100 cache), using the exact
			// same ROW_NUMBER ordering as the leaderboard so the two always agree.
			// Established players only (placement players don't appear -> rank null).
			const rankRes = await db.execute(sql`
			SELECT rank, rating FROM (
				SELECT r.player_id, ${effectiveRating} AS rating,
					ROW_NUMBER() OVER (ORDER BY ${effectiveRating} DESC, r.wins DESC, r.player_id ASC) AS rank
				FROM matchmaking_ratings r
				WHERE r.mod_id = ${modId} AND r.game_mode = ${gameMode} AND r.season = ${seasonId}
				  AND r.games_played >= ${PLACEMENT_GAMES}
			) t
			WHERE player_id = ${id}
		`)
			const rankRow = rankRes.rows[0] as
				| { rank: string | number; rating: string | number }
				| undefined
			const rank = rankRow ? Number(rankRow.rank) : null
			const rating = rankRow && r ? Number(rankRow.rating) : null

			res.json({
				playerId: player.id,
				displayName: shown,
				steamName: banned ? shown : player.steamName,
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
				seasonBest: r ? seasonBestOut(r) : null,
			})
		} catch (err) {
			next(err)
		}
	})

	router.get('/queues', async (_req, res, next) => {
		try {
			res.json(await getQueueStats(Date.now()))
		} catch (err) {
			next(err)
		}
	})

	// §6.2: games played per hour over the last 7 days. matchmakingMatches.createdAt
	// is stamped at queue-match-formation time, already exists, no schema change.
	router.get('/activity', async (_req, res, next) => {
		try {
			const rows = await db.execute(sql`
			SELECT date_trunc('hour', created_at) AS bucket, count(*)::int AS count
			FROM matchmaking_matches
			WHERE created_at >= now() - interval '7 days'
			GROUP BY bucket
			ORDER BY bucket ASC
		`)
			res.json({
				buckets: rows.rows.map((r) => {
					const row = r as { bucket: string; count: number }
					return { hour: row.bucket, count: Number(row.count) }
				}),
			})
		} catch (err) {
			next(err)
		}
	})

	return router
}
