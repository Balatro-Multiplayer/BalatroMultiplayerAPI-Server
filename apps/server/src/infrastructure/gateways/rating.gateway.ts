import { and, asc, desc, eq, gt, isNull, lt, lte, or, sql } from 'drizzle-orm'
import {
	PLACEMENT_GAMES,
	RATING_FLOOR,
	computeRatingDeltas,
	decayedRating,
	detectRatingMode,
	seasonStartRating,
} from '../../features/ratings/elo.js'
import {
	getMetricConfig,
	withinMetricBounds,
} from '../../features/ratings/metrics.config.js'
import { seasonBestColumns } from '../../features/ratings/season-best.js'
import type { PlacementEntry } from '../../shared/types/index.js'
import { db } from '../db/index.js'
import {
	matchmakingMatches,
	matchmakingRatings,
	players,
	seasons,
} from '../db/schema.js'

// Live games are rated by Nakama and mirrored into matchmaking_ratings. This
// gateway owns the seasons (Nakama reads the current one from the config
// push) and the Express Elo replay that rebuilds a scope after a void.

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export interface RatingRow {
	rating: number
	wins: number
	losses: number
	gamesPlayed: number
	lastMatchAt: Date | null
}

export interface RatedMatch {
	matchId: string
	modId: string
	gameMode: string
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

// The season Nakama rates into: the active one, else the latest.
export async function getSeasonForReplay(): Promise<
	{ id: number; name: string; startedAt: Date } | undefined
> {
	const active = await getCurrentSeason()
	if (active) return active
	const [latest] = await db
		.select()
		.from(seasons)
		.orderBy(desc(seasons.id))
		.limit(1)
	return latest
}

// The season *active at that moment*, not necessarily today's current season:
// an edit of an old match must not touch the live board.
export async function getSeasonAt(
	at: Date,
): Promise<{
	id: number
	name: string
	startedAt: Date
	endedAt: Date | null
} | null> {
	const [season] = await db
		.select()
		.from(seasons)
		.where(
			and(
				lte(seasons.startedAt, at),
				or(isNull(seasons.endedAt), gt(seasons.endedAt, at)),
			),
		)
		.orderBy(asc(seasons.startedAt))
		.limit(1)
	return season ?? null
}

// Resolve the season to read from. If an explicit id is given, use it as-is.
// Otherwise default to the active season, falling back to the most recent season
// by id when none is currently active (e.g. between seasons). Returns undefined
// only when no seasons exist at all.
export async function resolveSeasonId(
	explicit?: number,
): Promise<number | undefined> {
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

async function findRating(
	tx: Tx,
	playerId: string,
	modId: string,
	gameMode: string,
	seasonId: number,
): Promise<RatingRow | undefined> {
	const [row] = await tx
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
	return row
}

// The player's rating as Nakama would read it for a game at `at`: their row
// decayed, or for their first game of the season the previous season's
// rating carried over (decayed and soft-reset) -- a new row starts from that.
async function getOrCreateRating(
	tx: Tx,
	playerId: string,
	modId: string,
	gameMode: string,
	seasonId: number,
	at: Date,
): Promise<RatingRow> {
	const existing = await findRating(tx, playerId, modId, gameMode, seasonId)
	if (existing) return { ...existing, rating: decayedRating(existing, at) }

	const previous =
		seasonId > 1
			? await findRating(tx, playerId, modId, gameMode, seasonId - 1)
			: undefined
	const rating = seasonStartRating(previous, at)
	await tx.insert(matchmakingRatings).values({
		playerId,
		modId,
		gameMode,
		season: seasonId,
		rating,
		wins: 0,
		losses: 0,
		gamesPlayed: 0,
		lastMatchAt: null,
		decayAppliedAt: null,
	})

	return {
		rating,
		wins: 0,
		losses: 0,
		gamesPlayed: 0,
		lastMatchAt: null,
	}
}

// Rates one resolved match, as of `at` (when its result was reported).
export async function applyRatingTransaction(
	match: RatedMatch,
	seasonId: number,
	placements: PlacementEntry[],
	at: Date,
): Promise<
	Array<{ playerId: string; newRating: number | null; gamesPlayed: number }>
> {
	const mode = detectRatingMode(placements)

	return db.transaction(async (tx) => {
		const ratingMap = new Map<string, RatingRow & { playerId: string }>()
		for (const p of placements) {
			const r = await getOrCreateRating(
				tx,
				p.playerId,
				match.modId,
				match.gameMode,
				seasonId,
				at,
			)
			ratingMap.set(p.playerId, { ...r, playerId: p.playerId })
		}

		const deltas = computeRatingDeltas(mode, placements, ratingMap)
		const bestPlace = Math.min(...placements.map((pl) => pl.place))
		const updated: Array<{
			playerId: string
			newRating: number | null
			gamesPlayed: number
		}> = []

		for (const p of placements) {
			const r = ratingMap.get(p.playerId)!
			const isWin = p.place === bestPlace
			const newRating = Math.max(
				RATING_FLOOR,
				r.rating + (deltas.get(p.playerId) ?? 0),
			)
			const gamesPlayed = r.gamesPlayed + 1

			await tx
				.update(matchmakingRatings)
				.set({
					rating: newRating,
					wins: r.wins + (isWin ? 1 : 0),
					losses: r.losses + (isWin ? 0 : 1),
					gamesPlayed,
					lastMatchAt: at,
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(matchmakingRatings.playerId, p.playerId),
						eq(matchmakingRatings.modId, match.modId),
						eq(matchmakingRatings.gameMode, match.gameMode),
						eq(matchmakingRatings.season, seasonId),
					),
				)

			updated.push({
				playerId: p.playerId,
				newRating: gamesPlayed < PLACEMENT_GAMES ? null : newRating,
				gamesPlayed,
			})
		}

		await applySecondaryMetric(tx, match, seasonId, placements, at)
		return updated
	})
}

// Resolve, validate, and upsert each player's secondary personal-best for this match.
// Runs inside applyRatingTransaction's transaction (rating rows already exist for every
// placement). For server-measured boards only the finisher (best place) records a value,
// derived from the server clock; for client-reported boards every placement may record its
// own value. Implausible values are rejected and logged, never clamped.
async function applySecondaryMetric(
	tx: Tx,
	match: RatedMatch,
	seasonId: number,
	placements: PlacementEntry[],
	at: Date,
): Promise<void> {
	const cfg = getMetricConfig(match.modId)
	if (!cfg) return

	let durationMs: number | null = null
	if (cfg.serverMeasured) {
		const startRow = await tx
			.select({ startedAt: matchmakingMatches.gameStartedAt })
			.from(matchmakingMatches)
			.where(eq(matchmakingMatches.matchId, match.matchId))
			.limit(1)
		const startedAt = startRow[0]?.startedAt
		// No run-start signal → can't measure; skip rather than guess.
		if (startedAt) durationMs = at.getTime() - new Date(startedAt).getTime()
	}

	const minPlace = Math.min(...placements.map((p) => p.place))

	for (const p of placements) {
		const where = and(
			eq(matchmakingRatings.playerId, p.playerId),
			eq(matchmakingRatings.modId, match.modId),
			eq(matchmakingRatings.gameMode, match.gameMode),
			eq(matchmakingRatings.season, seasonId),
		)

		// A score board reads the score text; a plain number metric is ignored.
		if (cfg.kind === 'score') {
			const cols = seasonBestColumns(match.modId, p.metricText)
			if (cols.seasonBestText === null || cols.seasonBestLen === null || cols.seasonBestRev === null) continue
			const rev = sql`ARRAY[${sql.join(
				cols.seasonBestRev.map((n) => sql`${n}`),
				sql`, `,
			)}]::double precision[]`
			// A NULL row compares as NULL, so test for no best first.
			const better = sql`(${matchmakingRatings.seasonBestText} IS NULL OR ROW(${cols.seasonBestLen}::smallint, ${rev}) > ROW(${matchmakingRatings.seasonBestLen}, ${matchmakingRatings.seasonBestRev}))`
			await tx
				.update(matchmakingRatings)
				.set({ ...cols, bestMatchId: match.matchId, bestAt: at })
				.where(and(where, better))
			continue
		}

		let value: number | null = null
		if (cfg.serverMeasured) {
			if (p.place === minPlace && durationMs !== null) value = durationMs
		} else if (typeof p.metric === 'number') {
			value = p.metric
		}
		if (value === null) continue

		if (!withinMetricBounds(cfg.kind, value)) {
			console.warn(
				`[ratings] rejected implausible ${cfg.kind} metric ${value} for player ${p.playerId} (match ${match.matchId})`,
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
			.set({ seasonBest: rounded, bestMatchId: match.matchId, bestAt: at })
			.where(and(where, better))
	}
}

// Every rating in one board, with the player's Nakama account and display name.
export async function listScopeRatings(
	modId: string,
	gameMode: string,
	seasonId: number,
) {
	return db
		.select({
			playerId: matchmakingRatings.playerId,
			nakamaUserId: players.nakamaUserId,
			displayName: sql<string>`CASE WHEN ${players.useDiscordName} AND ${players.discordUsername} IS NOT NULL
				THEN ${players.discordUsername} ELSE ${players.steamName} END`,
			rating: matchmakingRatings.rating,
			wins: matchmakingRatings.wins,
			losses: matchmakingRatings.losses,
			gamesPlayed: matchmakingRatings.gamesPlayed,
			seasonBest: matchmakingRatings.seasonBest,
			seasonBestText: matchmakingRatings.seasonBestText,
			lastMatchAt: matchmakingRatings.lastMatchAt,
		})
		.from(matchmakingRatings)
		.innerJoin(players, eq(players.id, matchmakingRatings.playerId))
		.where(
			and(
				eq(matchmakingRatings.modId, modId),
				eq(matchmakingRatings.gameMode, gameMode),
				eq(matchmakingRatings.season, seasonId),
			),
		)
}

// Ends every season past its end date and opens the next one. Nakama carries
// ratings into the new season itself (a soft reset on each player's first
// rating there), so nothing is copied here. Returns the seasons that ended.
export async function checkSeasonRollover(
	now = new Date(),
): Promise<{ id: number; name: string }[]> {
	const expired = await db
		.select()
		.from(seasons)
		.where(and(lt(seasons.endsAt, now), isNull(seasons.endedAt)))
		.orderBy(asc(seasons.id))

	for (const season of expired) {
		console.log(`[ratings] rolling over season ${season.id} (${season.name})`)
		await db.transaction(async (tx) => {
			await tx
				.update(seasons)
				.set({ endedAt: now })
				.where(eq(seasons.id, season.id))
			await tx.insert(seasons).values({
				name: `Season ${season.id + 1}`,
				startedAt: now,
				endsAt: new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000),
			})
		})
	}
	return expired.map((season) => ({ id: season.id, name: season.name }))
}
