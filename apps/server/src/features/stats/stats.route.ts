import { Router } from 'express'
import { db } from '../../infrastructure/db/index.js'
import {
	matchmakingMatches,
	matchmakingRatings,
	players,
	seasons,
} from '../../infrastructure/db/schema.js'
import { and, asc, desc, eq, sql } from 'drizzle-orm'
import { getCurrentSeason } from '../../infrastructure/gateways/matchmaking.gateway.js'
import { PLACEMENT_GAMES } from '../matchmaking/elo.service.js'
import { totalPlayerCount } from '../matchmaking/queue.js'
import { matches, queues } from '../../state/matchmaking.js'
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

// Live "N queued / M in game" counts, per gameMode, for a mod -- e.g. to
// show on each button of a Find Game menu. Reads straight off the same
// in-memory Maps the matchmaking loop itself uses (state/matchmaking.ts) --
// no DB, no cache, since the whole point is being live and a scan over
// these Maps is already far cheaper than any query would be. Single-process
// in-memory state, same assumption the matchmaking loop already makes
// (no distributed lock) -- if this server ever runs multiple replicas, this
// only reflects whichever one served the request.
//
// One call returns every gameMode currently active for modId, not just one
// -- a menu with several buttons only needs one round-trip. A gameMode with
// zero queued and zero in-match players is omitted entirely rather than
// listed with explicit zeros; callers should treat an absent key as 0/0.
router.get('/queue-counts', (req, res, next) => {
	try {
		const { modId } = req.query
		if (!modId || typeof modId !== 'string') throw new AppError('Missing modId', 400)

		const counts: Record<string, { queued: number; inMatch: number }> = {}

		const prefix = `${modId}:`
		for (const [key, entries] of queues.entries()) {
			if (!key.startsWith(prefix)) continue
			const queued = totalPlayerCount(entries)
			if (queued === 0) continue
			const gameMode = key.slice(prefix.length)
			counts[gameMode] = counts[gameMode] || { queued: 0, inMatch: 0 }
			counts[gameMode].queued = queued
		}

		for (const match of matches.values()) {
			if (match.modId !== modId || match.playerIds.length === 0) continue
			counts[match.gameMode] = counts[match.gameMode] || { queued: 0, inMatch: 0 }
			counts[match.gameMode].inMatch += match.playerIds.length
		}

		res.json({ modId, gameModes: counts })
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

// §6.2: per-season summary. matchmakingMatches has no season column of its own
// (unlike matchmakingRatings), so matches are attributed to a season by falling
// within its [startedAt, endedAt ?? endsAt] range -- the same boundary
// checkSeasonRollover itself uses to decide when a season ends.
router.get('/season-overview', async (_req, res, next) => {
	try {
		const rows = await db.execute(sql`
			SELECT
				s.id, s.name, s.started_at, s.ends_at, s.ended_at,
				(SELECT count(*)::int FROM matchmaking_matches m
				 WHERE m.created_at >= s.started_at
				   AND m.created_at < coalesce(s.ended_at, s.ends_at)) AS total_matches,
				(SELECT count(*)::int FROM matchmaking_ratings r
				 WHERE r.season = s.id AND r.games_played >= ${PLACEMENT_GAMES}) AS ranked_players
			FROM seasons s
			ORDER BY s.id DESC
		`)
		res.json({
			seasons: rows.rows.map((r) => {
				const row = r as {
					id: number
					name: string
					started_at: string
					ends_at: string
					ended_at: string | null
					total_matches: number
					ranked_players: number
				}
				return {
					id: row.id,
					name: row.name,
					startedAt: row.started_at,
					endsAt: row.ends_at,
					endedAt: row.ended_at,
					totalMatches: Number(row.total_matches),
					rankedPlayers: Number(row.ranked_players),
				}
			}),
		})
	} catch (err) {
		next(err)
	}
})

// §6.2: browseable log of recent ranked matches. Global feed (every match, not
// scoped to one player) -- a different shape from getRunsForPlayer (§22.2,
// which is player-scoped by design for the "My Matches" replay list).
router.get('/history', async (req, res, next) => {
	try {
		const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 25)))
		const rows = await db
			.select({
				matchId: matchmakingMatches.matchId,
				modId: matchmakingMatches.modId,
				gameMode: matchmakingMatches.gameMode,
				status: matchmakingMatches.status,
				createdAt: matchmakingMatches.createdAt,
				gameStartedAt: matchmakingMatches.gameStartedAt,
			})
			.from(matchmakingMatches)
			.orderBy(desc(matchmakingMatches.createdAt))
			.limit(limit)

		res.json({ matches: rows })
	} catch (err) {
		next(err)
	}
})

// §6.2: Stake Popularity. Deliberately a COARSE proxy, not true per-choice
// tracking -- no schema anywhere records which stake an individual match was
// actually played on (confirmed: matchmakingMatches/lobbyRuns/matchRunLogs
// have no stake column; deck/stake drafting is client-side Lua only, see
// §16.4). This buckets by gameMode string instead, which happens to carry a
// real stake for SPDRN's two fixed-stake formats (spdrn_white_stake_triple =
// White Stake, spdrn_gold_stake_single = Gold Stake) -- every other format
// (variable-stake, or PvP with no stake concept at all) falls into "other".
router.get('/stake-popularity', async (_req, res, next) => {
	try {
		const rows = await db
			.select({
				gameMode: matchmakingMatches.gameMode,
				count: sql<number>`count(*)::int`,
			})
			.from(matchmakingMatches)
			.groupBy(matchmakingMatches.gameMode)

		const buckets: Record<string, number> = { 'White Stake': 0, 'Gold Stake': 0, Other: 0 }
		for (const row of rows) {
			if (row.gameMode.includes('white_stake_triple')) buckets['White Stake'] += row.count
			else if (row.gameMode.includes('gold_stake_single')) buckets['Gold Stake'] += row.count
			else buckets.Other += row.count
		}

		res.json({ buckets, coarse: true })
	} catch (err) {
		next(err)
	}
})

export default router
