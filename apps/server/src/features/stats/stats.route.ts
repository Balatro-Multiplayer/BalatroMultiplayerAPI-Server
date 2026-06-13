import { Router } from 'express'
import { db } from '../../infrastructure/db/index.js'
import { leaderboardCache, matchmakingMatches, players } from '../../infrastructure/db/schema.js'
import { and, asc, eq, sql } from 'drizzle-orm'
import { getCurrentSeason } from '../../infrastructure/gateways/matchmaking.gateway.js'
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
			const current = await getCurrentSeason()
			if (!current) throw new AppError('No active season', 404)
			seasonId = current.id
		}

		const entries = await db
			.select({
				rank: leaderboardCache.rank,
				playerId: leaderboardCache.playerId,
				displayName: leaderboardCache.displayName,
				rating: leaderboardCache.rating,
				wins: leaderboardCache.wins,
				losses: leaderboardCache.losses,
				gamesPlayed: leaderboardCache.gamesPlayed,
			})
			.from(leaderboardCache)
			.where(
				and(
					eq(leaderboardCache.modId, modId),
					eq(leaderboardCache.gameMode, gameMode),
					eq(leaderboardCache.season, seasonId),
				),
			)
			.orderBy(asc(leaderboardCache.rank))

		res.json({ season: seasonId, modId, gameMode, entries })
	} catch (err) {
		next(err)
	}
})

export default router
