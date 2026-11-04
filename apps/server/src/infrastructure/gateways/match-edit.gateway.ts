import { and, eq, sql } from 'drizzle-orm'
import {
	INITIAL_HIDDEN_RATING,
	RATING_FLOOR,
} from '../../features/ratings/elo.js'
import {
	type MatchEditRequest,
	type MatchRow,
	type PlayerRatingChange,
	matchAtTarget,
} from '../../features/ratings/match-edit.service.js'
import type { DbTransaction } from '../db/executor.js'
import { db } from '../db/index.js'
import { matchmakingMatches, matchmakingRatings } from '../db/schema.js'

// The row a player gets when an edit rates them and they have none yet: the
// initial record with the change applied, floored like the update below.
export function newRatingRow(
	change: PlayerRatingChange,
	modId: string,
	gameMode: string,
	season: number,
	at: Date,
) {
	return {
		playerId: change.playerId,
		modId,
		gameMode,
		season,
		rating: Math.max(RATING_FLOOR, INITIAL_HIDDEN_RATING + change.rating),
		wins: Math.max(0, change.wins),
		losses: Math.max(0, change.losses),
		gamesPlayed: Math.max(0, change.gamesPlayed),
		lastMatchAt: change.gamesPlayed > 0 ? at : null,
	}
}

export async function findMatchRow(matchId: string): Promise<MatchRow | null> {
	const [row] = await db
		.select({
			matchId: matchmakingMatches.matchId,
			modId: matchmakingMatches.modId,
			gameMode: matchmakingMatches.gameMode,
			status: matchmakingMatches.status,
			resultPlacements: matchmakingMatches.resultPlacements,
			resultReportedAt: matchmakingMatches.resultReportedAt,
		})
		.from(matchmakingMatches)
		.where(eq(matchmakingMatches.matchId, matchId))
	return row ?? null
}

// The new result for the match row: each player keeps their other fields
// (performance, metric); `rated` goes, as Nakama rated the whole edited result.
function editedPlacements(
	old: unknown,
	placements: { playerId: string; place: number }[],
) {
	const before = new Map(
		(Array.isArray(old) ? (old as { playerId: string }[]) : []).map((p) => [
			p.playerId,
			p,
		]),
	)
	return placements.map((p) => {
		const { rated: _rated, ...rest } = (before.get(p.playerId) ?? {}) as Record<
			string,
			unknown
		>
		return { ...rest, playerId: p.playerId, place: p.place }
	})
}

// The match row and the players' rating rows move together, by the amounts
// Nakama moved its own copy. The row is locked, and when it already holds the
// edit (a retry after Nakama took it) the rating rows stay as they are, unless
// Nakama rated the game for the first time.
// `inTransaction` runs in the same transaction, for the staff log entry.
export async function applyMatchEditRows(
	matchId: string,
	request: MatchEditRequest,
	changes: PlayerRatingChange[],
	season: number | null,
	ratedFirstTime: boolean,
	inTransaction?: (tx: DbTransaction) => Promise<void>,
): Promise<void> {
	await db.transaction(async (tx) => {
		const [row] = await tx
			.select()
			.from(matchmakingMatches)
			.where(eq(matchmakingMatches.matchId, matchId))
			.for('update')
		if (!row) return
		const atTarget = matchAtTarget(row, request)
		if (!atTarget) {
			await tx
				.update(matchmakingMatches)
				.set(
					request.kind === 'void'
						? { status: 'voided', updatedAt: new Date() }
						: {
								resultPlacements: editedPlacements(
									row.resultPlacements,
									request.placements,
								),
								updatedAt: new Date(),
							},
				)
				.where(eq(matchmakingMatches.matchId, matchId))
		}
		if (!atTarget || ratedFirstTime) {
			if (season !== null) {
				for (const change of changes) {
					const increment = {
						rating: sql`GREATEST(${RATING_FLOOR}, ${matchmakingRatings.rating} + ${change.rating})`,
						wins: sql`GREATEST(0, ${matchmakingRatings.wins} + ${change.wins})`,
						losses: sql`GREATEST(0, ${matchmakingRatings.losses} + ${change.losses})`,
						gamesPlayed: sql`GREATEST(0, ${matchmakingRatings.gamesPlayed} + ${change.gamesPlayed})`,
						updatedAt: new Date(),
					}
					// A void never creates a row; an edit that rates a player for
					// the first time may find none.
					if (request.kind === 'void') {
						await tx
							.update(matchmakingRatings)
							.set(increment)
							.where(
								and(
									eq(matchmakingRatings.playerId, change.playerId),
									eq(matchmakingRatings.modId, row.modId),
									eq(matchmakingRatings.gameMode, row.gameMode),
									eq(matchmakingRatings.season, season),
								),
							)
					} else {
						await tx
							.insert(matchmakingRatings)
							.values(
								newRatingRow(
									change,
									row.modId,
									row.gameMode,
									season,
									new Date(),
								),
							)
							.onConflictDoUpdate({
								target: [
									matchmakingRatings.playerId,
									matchmakingRatings.modId,
									matchmakingRatings.gameMode,
									matchmakingRatings.season,
								],
								set: increment,
							})
					}
				}
			}
		}
		await inTransaction?.(tx)
	})
}
