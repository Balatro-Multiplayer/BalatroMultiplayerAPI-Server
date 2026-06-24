import { and, desc, eq, lt, isNull, sql } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
	leaderboardCache,
	matchmakingMatches,
	matchmakingRatings,
	seasons,
} from '../db/schema.js'
import {
	DECAY_INACTIVE_THRESHOLD_DAYS,
	DECAY_RATE_PER_DAY,
	INITIAL_HIDDEN_RATING,
	LEADERBOARD_TOP_N,
	PLACEMENT_GAMES,
	RATING_FLOOR,
	applySoftReset,
	computeRatingDeltas,
	detectRatingMode,
} from '../../features/matchmaking/elo.service.js'
import {
	getMetricConfig,
	withinMetricBounds,
} from '../../features/matchmaking/metrics.config.js'
import type { Match, MatchStatus, PlacementEntry, StoredLobbyState } from '../../shared/types/index.js'

export type { StoredLobbyState } from '../../shared/types/index.js'

export interface RatingRow {
	rating: number
	wins: number
	losses: number
	gamesPlayed: number
	lastMatchAt: Date | null
}

export async function getCurrentSeason(): Promise<
	{ id: number; name: string; startedAt: Date; endsAt: Date } | undefined
> {
	const rows = await db
		.select()
		.from(seasons)
		.where(isNull(seasons.endedAt))
		.limit(1)
	return rows[0]
}

// Resolve the season to read from. If an explicit id is given, use it as-is.
// Otherwise default to the active season, falling back to the most recent season
// by id when none is currently active (e.g. between seasons). Returns undefined
// only when no seasons exist at all.
export async function resolveSeasonId(explicit?: number): Promise<number | undefined> {
	if (explicit !== undefined) return explicit

	const active = await getCurrentSeason()
	if (active) return active.id

	const [latest] = await db
		.select({ id: seasons.id })
		.from(seasons)
		.orderBy(desc(seasons.id))
		.limit(1)
	return latest?.id
}

export async function getOrCreateRating(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	playerId: string,
	modId: string,
	gameMode: string,
	seasonId: number,
): Promise<RatingRow> {
	const existing = await tx
		.select()
		.from(matchmakingRatings)
		.where(
			and(
				eq(matchmakingRatings.playerId, playerId),
				eq(matchmakingRatings.modId, modId),
				eq(matchmakingRatings.gameMode, gameMode),
				eq(matchmakingRatings.season, seasonId),
			),
		)
		.limit(1)

	if (existing[0]) return existing[0]

	await tx.insert(matchmakingRatings).values({
		playerId,
		modId,
		gameMode,
		season: seasonId,
		rating: INITIAL_HIDDEN_RATING,
		wins: 0,
		losses: 0,
		gamesPlayed: 0,
		lastMatchAt: null,
		decayAppliedAt: null,
	})

	return {
		rating: INITIAL_HIDDEN_RATING,
		wins: 0,
		losses: 0,
		gamesPlayed: 0,
		lastMatchAt: null,
	}
}

export async function recomputeLeaderboard(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	modId: string,
	gameMode: string,
	seasonId: number,
): Promise<void> {
	await tx
		.delete(leaderboardCache)
		.where(
			and(
				eq(leaderboardCache.modId, modId),
				eq(leaderboardCache.gameMode, gameMode),
				eq(leaderboardCache.season, seasonId),
			),
		)

	await tx.execute(sql`
		INSERT INTO leaderboard_cache
			(mod_id, game_mode, season, rank, player_id, display_name, rating, wins, losses, games_played, season_best, updated_at)
		SELECT
			${modId}, ${gameMode}, ${seasonId},
			ROW_NUMBER() OVER (ORDER BY r.rating DESC, r.wins DESC) AS rank,
			r.player_id,
			CASE WHEN p.use_discord_name AND p.discord_username IS NOT NULL
				 THEN p.discord_username ELSE p.steam_name END,
			r.rating,
			r.wins,
			r.losses,
			r.games_played,
			r.season_best,
			NOW()
		FROM matchmaking_ratings r
		JOIN players p ON p.id = r.player_id
		WHERE r.mod_id = ${modId}
		  AND r.game_mode = ${gameMode}
		  AND r.season = ${seasonId}
		  AND r.games_played >= ${PLACEMENT_GAMES}
		ORDER BY r.rating DESC, r.wins DESC
		LIMIT ${LEADERBOARD_TOP_N}
	`)
}

export async function getPlayerCurrentRating(
	playerId: string,
	modId: string,
	gameMode: string,
): Promise<number> {
	const season = await getCurrentSeason()
	if (!season) return INITIAL_HIDDEN_RATING

	const rows = await db
		.select({ rating: matchmakingRatings.rating })
		.from(matchmakingRatings)
		.where(
			and(
				eq(matchmakingRatings.playerId, playerId),
				eq(matchmakingRatings.modId, modId),
				eq(matchmakingRatings.gameMode, gameMode),
				eq(matchmakingRatings.season, season.id),
			),
		)
		.limit(1)

	return rows[0]?.rating ?? INITIAL_HIDDEN_RATING
}

export async function insertMatch(
	matchId: string,
	lobbyCode: string,
	modId: string,
	gameMode: string,
	playerIds: string[],
	lobbyState: StoredLobbyState,
): Promise<void> {
	await db.insert(matchmakingMatches).values({
		matchId,
		lobbyCode,
		modId,
		gameMode,
		players: JSON.stringify(playerIds),
		lobbyState: JSON.stringify(lobbyState),
		status: 'active',
	})
}

export async function updateMatchLobbyState(
	lobbyCode: string,
	state: StoredLobbyState,
): Promise<void> {
	await db
		.update(matchmakingMatches)
		.set({
			lobbyState: JSON.stringify(state),
			updatedAt: new Date(),
		})
		.where(eq(matchmakingMatches.lobbyCode, lobbyCode))
}

export async function updateMatchStatus(
	matchId: string,
	status: MatchStatus,
): Promise<void> {
	await db
		.update(matchmakingMatches)
		.set({ status, updatedAt: new Date() })
		.where(eq(matchmakingMatches.matchId, matchId))
}

// Stamp the server-side run-start time. Idempotent: only the first call takes effect, so
// the measured duration can't be shrunk by re-calling /start.
export async function setMatchGameStarted(
	matchId: string,
	startedAt: Date,
): Promise<void> {
	await db
		.update(matchmakingMatches)
		.set({ gameStartedAt: startedAt, updatedAt: new Date() })
		.where(
			and(
				eq(matchmakingMatches.matchId, matchId),
				isNull(matchmakingMatches.gameStartedAt),
			),
		)
}

export async function loadActiveMatches(): Promise<
	Array<{
		matchId: string
		lobbyCode: string
		modId: string
		gameMode: string
		players: unknown
		lobbyState: unknown
		createdAt: Date
	}>
> {
	return db
		.select()
		.from(matchmakingMatches)
		.where(eq(matchmakingMatches.status, 'active'))
}

export async function applyRatingTransaction(
	matchId: string,
	match: Match,
	seasonId: number,
	placements: PlacementEntry[],
): Promise<
	Array<{
		playerId: string
		newRating: number | null
		delta: number | null
		gamesPlayed: number
		isPlacement: boolean
	}>
> {
	const mode = detectRatingMode(placements)

	return db.transaction(async (tx) => {
		const ratingMap = new Map<string, RatingRow & { playerId: string }>()

		for (const p of placements) {
			const r = await getOrCreateRating(tx, p.playerId, match.modId, match.gameMode, seasonId)
			ratingMap.set(p.playerId, { ...r, playerId: p.playerId })
		}

		const deltas = computeRatingDeltas(mode, placements, ratingMap)

		const now = new Date()
		const updatedRatings: Array<{
			playerId: string
			newRating: number | null
			delta: number | null
			gamesPlayed: number
			isPlacement: boolean
		}> = []

		for (const p of placements) {
			const r = ratingMap.get(p.playerId)!
			const delta = deltas.get(p.playerId) ?? 0
			const isWin = p.place === Math.min(...placements.map((pl) => pl.place))
			const newRating = Math.max(RATING_FLOOR, r.rating + delta)
			const newGamesPlayed = r.gamesPlayed + 1
			const newWins = r.wins + (isWin ? 1 : 0)
			const newLosses = r.losses + (isWin ? 0 : 1)

			await tx
				.update(matchmakingRatings)
				.set({
					rating: newRating,
					wins: newWins,
					losses: newLosses,
					gamesPlayed: newGamesPlayed,
					lastMatchAt: now,
					updatedAt: now,
				})
				.where(
					and(
						eq(matchmakingRatings.playerId, p.playerId),
						eq(matchmakingRatings.modId, match.modId),
						eq(matchmakingRatings.gameMode, match.gameMode),
						eq(matchmakingRatings.season, seasonId),
					),
				)

			const isPlacement = newGamesPlayed < PLACEMENT_GAMES
			updatedRatings.push({
				playerId: p.playerId,
				newRating: isPlacement ? null : newRating,
				delta: isPlacement ? null : delta,
				gamesPlayed: newGamesPlayed,
				isPlacement,
			})
		}

		await tx
			.update(matchmakingMatches)
			.set({ status: 'resolved', updatedAt: now })
			.where(eq(matchmakingMatches.matchId, matchId))

		// Secondary personal-best metric (PvP score / speedrun time), upsert-if-better.
		await applySecondaryMetric(tx, matchId, match, seasonId, placements, now)

		await recomputeLeaderboard(tx, match.modId, match.gameMode, seasonId)

		return updatedRatings
	})
}

// Resolve, validate, and upsert each player's secondary personal-best for this match.
// Runs inside applyRatingTransaction's transaction (rating rows already exist for every
// placement). For server-measured boards only the finisher (best place) records a value,
// derived from the server clock; for client-reported boards every placement may record its
// own value. Implausible values are rejected and logged, never clamped.
async function applySecondaryMetric(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	matchId: string,
	match: Match,
	seasonId: number,
	placements: PlacementEntry[],
	now: Date,
): Promise<void> {
	const cfg = getMetricConfig(match.modId)
	if (!cfg) return

	let durationMs: number | null = null
	if (cfg.serverMeasured) {
		const startRow = await tx
			.select({ startedAt: matchmakingMatches.gameStartedAt })
			.from(matchmakingMatches)
			.where(eq(matchmakingMatches.matchId, matchId))
			.limit(1)
		const startedAt = startRow[0]?.startedAt
		// No run-start signal → can't measure; skip rather than guess.
		if (startedAt) durationMs = now.getTime() - new Date(startedAt).getTime()
	}

	const minPlace = Math.min(...placements.map((p) => p.place))

	for (const p of placements) {
		let value: number | null = null
		if (cfg.serverMeasured) {
			if (p.place === minPlace && durationMs !== null) value = durationMs
		} else if (typeof p.metric === 'number') {
			value = p.metric
		}
		if (value === null) continue

		if (!withinMetricBounds(cfg.kind, value)) {
			console.warn(
				`[matchmaking] rejected implausible ${cfg.kind} metric ${value} for player ${p.playerId} (match ${matchId})`,
			)
			continue
		}

		const rounded = Math.round(value)
		const better =
			cfg.direction === 'asc'
				? sql`(${matchmakingRatings.seasonBest} IS NULL OR ${rounded} < ${matchmakingRatings.seasonBest})`
				: sql`(${matchmakingRatings.seasonBest} IS NULL OR ${rounded} > ${matchmakingRatings.seasonBest})`

		await tx
			.update(matchmakingRatings)
			.set({ seasonBest: rounded, bestMatchId: matchId, bestAt: now })
			.where(
				and(
					eq(matchmakingRatings.playerId, p.playerId),
					eq(matchmakingRatings.modId, match.modId),
					eq(matchmakingRatings.gameMode, match.gameMode),
					eq(matchmakingRatings.season, seasonId),
					better,
				),
			)
	}
}

export async function getLeaderboard(
	modId: string,
	gameMode: string,
	seasonId: number,
	playerId: string,
): Promise<{
	season: number
	modId: string
	gameMode: string
	entries: Array<{
		rank: number
		playerId: string
		displayName: string
		rating: number
		wins: number
		losses: number
		seasonBest: number | null
	}>
	playerEntry: {
		rank: number
		rating: number
		wins: number
		losses: number
		seasonBest: number | null
	} | null
}> {
	const entries = await db
		.select({
			rank: leaderboardCache.rank,
			playerId: leaderboardCache.playerId,
			displayName: leaderboardCache.displayName,
			rating: leaderboardCache.rating,
			wins: leaderboardCache.wins,
			losses: leaderboardCache.losses,
			seasonBest: leaderboardCache.seasonBest,
		})
		.from(leaderboardCache)
		.where(
			and(
				eq(leaderboardCache.modId, modId),
				eq(leaderboardCache.gameMode, gameMode),
				eq(leaderboardCache.season, seasonId),
			),
		)
		.orderBy(leaderboardCache.rank)

	let playerEntry:
		| { rank: number; rating: number; wins: number; losses: number; seasonBest: number | null }
		| null = null

	const cachedEntry = entries.find((e) => e.playerId === playerId)
	if (cachedEntry) {
		playerEntry = {
			rank: cachedEntry.rank,
			rating: cachedEntry.rating,
			wins: cachedEntry.wins,
			losses: cachedEntry.losses,
			seasonBest: cachedEntry.seasonBest,
		}
	} else {
		const ownRating = await db
			.select({
				rating: matchmakingRatings.rating,
				wins: matchmakingRatings.wins,
				losses: matchmakingRatings.losses,
				gamesPlayed: matchmakingRatings.gamesPlayed,
				seasonBest: matchmakingRatings.seasonBest,
			})
			.from(matchmakingRatings)
			.where(
				and(
					eq(matchmakingRatings.playerId, playerId),
					eq(matchmakingRatings.modId, modId),
					eq(matchmakingRatings.gameMode, gameMode),
					eq(matchmakingRatings.season, seasonId),
				),
			)
			.limit(1)

		if (ownRating[0] && ownRating[0].gamesPlayed >= PLACEMENT_GAMES) {
			const rankResult = await db.execute<{ count: string }>(sql`
				SELECT COUNT(*) + 1 AS count
				FROM matchmaking_ratings
				WHERE mod_id = ${modId}
				  AND game_mode = ${gameMode}
				  AND season = ${seasonId}
				  AND games_played >= ${PLACEMENT_GAMES}
				  AND rating > ${ownRating[0].rating}
			`)
			const rank = Number(rankResult.rows[0]?.count ?? 1)
			playerEntry = {
				rank,
				rating: ownRating[0].rating,
				wins: ownRating[0].wins,
				losses: ownRating[0].losses,
				seasonBest: ownRating[0].seasonBest,
			}
		}
	}

	return { season: seasonId, modId, gameMode, entries, playerEntry }
}

export async function getOwnRating(
	playerId: string,
	modId: string,
	gameMode: string,
	seasonId: number,
): Promise<{
	rating: number | null
	wins: number
	losses: number
	gamesPlayed: number
	isPlacement: boolean
	placementGamesLeft: number
	seasonBest: number | null
} | null> {
	const rows = await db
		.select()
		.from(matchmakingRatings)
		.where(
			and(
				eq(matchmakingRatings.playerId, playerId),
				eq(matchmakingRatings.modId, modId),
				eq(matchmakingRatings.gameMode, gameMode),
				eq(matchmakingRatings.season, seasonId),
			),
		)
		.limit(1)

	if (!rows[0]) return null

	const r = rows[0]
	const isPlacement = r.gamesPlayed < PLACEMENT_GAMES
	return {
		rating: isPlacement ? null : r.rating,
		wins: r.wins,
		losses: r.losses,
		gamesPlayed: r.gamesPlayed,
		isPlacement,
		placementGamesLeft: Math.max(0, PLACEMENT_GAMES - r.gamesPlayed),
		seasonBest: r.seasonBest,
	}
}

export async function runDecay(): Promise<void> {
	const season = await getCurrentSeason()
	if (!season) return

	const combos = await db
		.selectDistinct({
			modId: leaderboardCache.modId,
			gameMode: leaderboardCache.gameMode,
		})
		.from(leaderboardCache)
		.where(eq(leaderboardCache.season, season.id))

	const now = new Date()
	const thresholdMs = DECAY_INACTIVE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000
	const affectedCombos = new Set<string>()

	for (const combo of combos) {
		const top100 = await db
			.select({ playerId: leaderboardCache.playerId })
			.from(leaderboardCache)
			.where(
				and(
					eq(leaderboardCache.modId, combo.modId),
					eq(leaderboardCache.gameMode, combo.gameMode),
					eq(leaderboardCache.season, season.id),
				),
			)

		const playerIds = top100.map((r) => r.playerId)

		for (const playerId of playerIds) {
			const ratingRow = await db
				.select()
				.from(matchmakingRatings)
				.where(
					and(
						eq(matchmakingRatings.playerId, playerId),
						eq(matchmakingRatings.modId, combo.modId),
						eq(matchmakingRatings.gameMode, combo.gameMode),
						eq(matchmakingRatings.season, season.id),
					),
				)
				.limit(1)

			if (!ratingRow[0]) continue

			const r = ratingRow[0]

			if (r.decayAppliedAt) {
				const applied = r.decayAppliedAt
				if (
					applied.getUTCFullYear() === now.getUTCFullYear() &&
					applied.getUTCMonth() === now.getUTCMonth() &&
					applied.getUTCDate() === now.getUTCDate()
				) {
					continue
				}
			}

			const lastActivity = r.lastMatchAt ?? r.updatedAt
			const inactiveDays =
				(now.getTime() - lastActivity.getTime()) / (24 * 60 * 60 * 1000)

			if (inactiveDays > DECAY_INACTIVE_THRESHOLD_DAYS) {
				const decayAmount = Math.floor(inactiveDays - DECAY_INACTIVE_THRESHOLD_DAYS) * DECAY_RATE_PER_DAY
				const newRating = Math.max(RATING_FLOOR, r.rating - decayAmount)

				if (newRating !== r.rating) {
					await db
						.update(matchmakingRatings)
						.set({ rating: newRating, decayAppliedAt: now, updatedAt: now })
						.where(
							and(
								eq(matchmakingRatings.playerId, playerId),
								eq(matchmakingRatings.modId, combo.modId),
								eq(matchmakingRatings.gameMode, combo.gameMode),
								eq(matchmakingRatings.season, season.id),
							),
						)

					affectedCombos.add(`${combo.modId}:${combo.gameMode}`)
				}
			}
		}
	}

	if (affectedCombos.size > 0) {
		await db.transaction(async (tx) => {
			for (const combo of affectedCombos) {
				const [modId, ...gameModeParts] = combo.split(':')
				const gameMode = gameModeParts.join(':')
				await recomputeLeaderboard(tx, modId, gameMode, season.id)
			}
		})
	}
}

export async function checkSeasonRollover(): Promise<void> {
	const now = new Date()

	const expiredSeasons = await db
		.select()
		.from(seasons)
		.where(and(lt(seasons.endsAt, now), isNull(seasons.endedAt)))

	for (const expiredSeason of expiredSeasons) {
		console.log(`[matchmaking] Rolling over season ${expiredSeason.id} (${expiredSeason.name})`)

		await db.transaction(async (tx) => {
			const allRatings = await tx
				.select()
				.from(matchmakingRatings)
				.where(
					and(
						eq(matchmakingRatings.season, expiredSeason.id),
					),
				)

			const nextSeasonName = `Season ${expiredSeason.id + 1}`
			const nextStartedAt = now
			const nextEndsAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000)

			const newSeasonRows = await tx
				.insert(seasons)
				.values({
					name: nextSeasonName,
					startedAt: nextStartedAt,
					endsAt: nextEndsAt,
				})
				.returning()

			const newSeason = newSeasonRows[0]
			if (!newSeason) return

			// Carry forward ratings with soft reset
			for (const r of allRatings) {
				if (r.gamesPlayed < PLACEMENT_GAMES) continue
				const newRating = applySoftReset(r.rating)
				await tx.insert(matchmakingRatings).values({
					playerId: r.playerId,
					modId: r.modId,
					gameMode: r.gameMode,
					season: newSeason.id,
					rating: newRating,
					wins: 0,
					losses: 0,
					gamesPlayed: 0,
					lastMatchAt: null,
					decayAppliedAt: null,
				})
			}

			// End the old season
			await tx
				.update(seasons)
				.set({ endedAt: now })
				.where(eq(seasons.id, expiredSeason.id))
		})
	}
}
