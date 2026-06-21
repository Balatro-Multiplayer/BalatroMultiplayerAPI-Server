import { Router } from 'express'
import { db } from '../../infrastructure/db/index.js'
import {
	leaderboardCache,
	matchmakingMatches,
	matchmakingRatings,
	players,
	seasons,
} from '../../infrastructure/db/schema.js'
import { and, asc, count, desc, eq, gte, sql } from 'drizzle-orm'
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
		// truth; leaderboard_cache only holds the top 100). Indexed by
		// (mod_id, game_mode, season, rating) for ordered paging.
		const page = Math.max(1, Number(req.query.page ?? 1))
		const pageSize = Math.min(200, Math.max(1, Number(req.query.pageSize ?? 100)))
		const offset = (page - 1) * pageSize

		const where = and(
			eq(matchmakingRatings.modId, modId),
			eq(matchmakingRatings.gameMode, gameMode),
			eq(matchmakingRatings.season, seasonId),
			gte(matchmakingRatings.gamesPlayed, PLACEMENT_GAMES),
		)

		const [{ total }] = await db
			.select({ total: count() })
			.from(matchmakingRatings)
			.where(where)

		const rows = await db
			.select({
				playerId: matchmakingRatings.playerId,
				rating: matchmakingRatings.rating,
				wins: matchmakingRatings.wins,
				losses: matchmakingRatings.losses,
				gamesPlayed: matchmakingRatings.gamesPlayed,
				seasonBest: matchmakingRatings.seasonBest,
				steamName: players.steamName,
				discordUsername: players.discordUsername,
				useDiscordName: players.useDiscordName,
			})
			.from(matchmakingRatings)
			.innerJoin(players, eq(players.id, matchmakingRatings.playerId))
			.where(where)
			.orderBy(desc(matchmakingRatings.rating), desc(matchmakingRatings.wins))
			.limit(pageSize)
			.offset(offset)

		const entries = rows.map((r, i) => ({
			rank: offset + i + 1,
			playerId: r.playerId,
			displayName: r.useDiscordName && r.discordUsername ? r.discordUsername : r.steamName,
			rating: r.rating,
			wins: r.wins,
			losses: r.losses,
			gamesPlayed: r.gamesPlayed,
			seasonBest: r.seasonBest,
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
				preferredJoker: players.preferredJoker,
				createdAt: players.createdAt,
			})
			.from(players)
			.where(eq(players.id, id))
			.limit(1)

		if (!player) throw new AppError('Player not found', 404)

		const [entry] = await db
			.select({
				rank: leaderboardCache.rank,
				displayName: leaderboardCache.displayName,
				rating: leaderboardCache.rating,
				wins: leaderboardCache.wins,
				losses: leaderboardCache.losses,
				gamesPlayed: leaderboardCache.gamesPlayed,
				seasonBest: leaderboardCache.seasonBest,
			})
			.from(leaderboardCache)
			.where(
				and(
					eq(leaderboardCache.playerId, id),
					eq(leaderboardCache.modId, modId),
					eq(leaderboardCache.gameMode, gameMode),
					eq(leaderboardCache.season, seasonId),
				)
			)
			.limit(1)

		res.json({
			playerId: player.id,
			displayName: entry?.displayName ?? player.steamName,
			steamName: player.steamName,
			preferredJoker: player.preferredJoker,
			createdAt: player.createdAt,
			season: seasonId,
			modId,
			gameMode,
			rank: entry?.rank ?? null,
			rating: entry?.rating ?? null,
			wins: entry?.wins ?? null,
			losses: entry?.losses ?? null,
			gamesPlayed: entry?.gamesPlayed ?? null,
			seasonBest: entry?.seasonBest ?? null,
		})
	} catch (err) {
		next(err)
	}
})

export default router
