/**
 * Void a single already-resolved ranked match's rating effect, without
 * assuming a "correct" winner exists to restore -- for cases like a wrongful
 * auto-forfeit (a reconnect race, see grace-period.service.ts), where the
 * match record itself may still be worth keeping as a historical artifact
 * but its impact on ratings/leaderboard needs to be undone.
 *
 * Rating reversal is not cheaply invertible in general: matchmaking_ratings
 * stores only a single mutable current row per (player, mod, gameMode,
 * season) -- no per-match delta or pre-match snapshot survives
 * applyRatingTransaction's in-place update, and later matches for the same
 * players compound on top of it (both through rating and gamesPlayed, which
 * gates the placement-window K-factor). So this reconstructs the correct
 * state the same way the whole board would be built from scratch: wipe every
 * rating/leaderboard row in this match's (modId, gameMode, season) scope,
 * mark the target match 'voided' (excluding it from replay), then replay
 * every remaining resolved match in that scope through the real
 * applyRatingTransaction, in original resultReportedAt order -- same
 * mechanism production uses live, just run standalone.
 *
 * Run with:
 *   tsx --env-file=.env src/infrastructure/db/void-match.ts <matchId>
 */

import { and, asc, eq, gt, gte, isNull, lte, or } from 'drizzle-orm'
import { db, pool } from './index.js'
import { leaderboardCache, matchmakingMatches, matchmakingRatings, seasons } from './schema.js'
import { applyRatingTransaction } from '../gateways/matchmaking.gateway.js'
import type { Match, PlacementEntry } from '../../shared/types/index.js'

export async function voidMatch(matchId: string): Promise<void> {
	const [match] = await db
		.select()
		.from(matchmakingMatches)
		.where(eq(matchmakingMatches.matchId, matchId))

	if (!match) throw new Error(`match ${matchId} not found`)

	if (match.status === 'voided') {
		console.log(`[void-match] ${matchId} is already voided -- nothing to do`)
		return
	}
	if (match.status !== 'resolved') {
		console.log(`[void-match] ${matchId} has status='${match.status}', not 'resolved' -- refusing to void`)
		return
	}
	if (!match.resultReportedAt) {
		throw new Error(`match ${matchId} has no resultReportedAt -- cannot resolve its season`)
	}

	// The season *active when this match resolved*, not necessarily today's
	// current season -- a void of an old match must not touch the live board.
	const [season] = await db
		.select()
		.from(seasons)
		.where(
			and(
				lte(seasons.startedAt, match.resultReportedAt),
				or(isNull(seasons.endedAt), gt(seasons.endedAt, match.resultReportedAt)),
			),
		)
		.orderBy(asc(seasons.startedAt))
		.limit(1)

	if (!season) throw new Error(`could not resolve the season active at ${match.resultReportedAt.toISOString()}`)

	const { modId, gameMode } = match
	console.log(
		`[void-match] voiding ${matchId} (${modId}:${gameMode}, season ${season.id} "${season.name}")`,
	)

	await db.update(matchmakingMatches).set({ status: 'voided' }).where(eq(matchmakingMatches.matchId, matchId))

	const delRatings = await db
		.delete(matchmakingRatings)
		.where(
			and(
				eq(matchmakingRatings.modId, modId),
				eq(matchmakingRatings.gameMode, gameMode),
				eq(matchmakingRatings.season, season.id),
			),
		)
	const delBoard = await db
		.delete(leaderboardCache)
		.where(
			and(
				eq(leaderboardCache.modId, modId),
				eq(leaderboardCache.gameMode, gameMode),
				eq(leaderboardCache.season, season.id),
			),
		)
	console.log(
		`[void-match] cleared scope (${modId}:${gameMode}, season ${season.id}): ratings=${delRatings.rowCount} leaderboard=${delBoard.rowCount}`,
	)

	const scopedMatches = await db
		.select()
		.from(matchmakingMatches)
		.where(
			and(
				eq(matchmakingMatches.status, 'resolved'),
				eq(matchmakingMatches.modId, modId),
				eq(matchmakingMatches.gameMode, gameMode),
				gte(matchmakingMatches.createdAt, season.startedAt),
			),
		)
		.orderBy(asc(matchmakingMatches.resultReportedAt))

	console.log(`[void-match] replaying ${scopedMatches.length} remaining resolved matches in scope`)

	let n = 0
	for (const row of scopedMatches) {
		if (!row.resultPlacements) continue
		const placements = row.resultPlacements as PlacementEntry[]
		const replayMatch: Match = {
			matchId: row.matchId,
			lobbyCode: row.lobbyCode,
			modId: row.modId,
			gameMode: row.gameMode,
			playerIds: placements.map((p) => p.playerId),
			createdAt: row.createdAt,
		}
		const results = await applyRatingTransaction(row.matchId, replayMatch, season.id, placements)
		console.log(
			`[void-match]   ${row.matchId}: ${results.map((r) => `${r.playerId}=${r.newRating ?? '(placement)'}`).join(', ')}`,
		)
		n++
	}

	console.log(`[void-match] done -- replayed ${n} matches, ${matchId} excluded`)
}

async function main() {
	const matchId = process.argv[2]
	if (!matchId) throw new Error('usage: void-match.ts <matchId>')
	await voidMatch(matchId)
	await pool.end()
	process.exit(0)
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		console.error(err)
		process.exit(1)
	})
}
