/**
 * Void a single already-resolved ranked match's rating effect, without
 * assuming a "correct" winner exists to restore -- for cases like a wrongful
 * auto-forfeit (a player Nakama forfeited for a disconnect who then came back), where the
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
 * applyRatingTransaction, in original resultReportedAt order -- the same
 * Elo rules, just run standalone.
 *
 * Nakama owns live ratings, so the rebuilt scope is then written over
 * Nakama's copy of the board (admin_ratings_set). The replay uses the
 * Express copy of the Elo rules (features/ratings/elo.ts), which can differ
 * slightly from Nakama's own rating of the same games.
 *
 * Run with:
 *   tsx --env-file=.env src/infrastructure/db/void-match.ts <matchId>
 */

import { and, asc, eq, gte } from 'drizzle-orm'
import { seasonBestOut } from '../../features/ratings/season-best.js'
import type { PlacementEntry } from '../../shared/types/index.js'
import {
	applyRatingTransaction,
	getSeasonAt,
	listScopeRatings,
} from '../gateways/rating.gateway.js'
import { callNakamaRpc } from '../nakama/admin-client.js'
import { db, pool } from './index.js'
import {
	leaderboardCache,
	matchmakingMatches,
	matchmakingRatings,
} from './schema.js'

// admin_ratings_set's per-call limit.
const RATINGS_SET_BATCH = 1000

type ScopeRating = Awaited<ReturnType<typeof listScopeRatings>>[number]

// Nakama keys boards by the bare mode ('ranked:' dropped).
export function nakamaModeOf(gameMode: string): string {
	return gameMode.replace(/^ranked:/, '')
}

// What admin_ratings_set should hold for the scope: every rebuilt rating,
// and a clear for each player who was rated before the void but no longer
// is. Players without a Nakama account have no Nakama board to fix.
export function nakamaRatingEntries(
	before: ScopeRating[],
	after: ScopeRating[],
) {
	const rated = new Set(after.map((r) => r.playerId))
	const entries: {
		userId: string
		name: string
		record: Record<string, unknown> | null
	}[] = []
	for (const r of after) {
		if (!r.nakamaUserId) continue
		entries.push({
			userId: r.nakamaUserId,
			name: r.displayName,
			record: {
				rating: r.rating,
				wins: r.wins,
				losses: r.losses,
				gamesPlayed: r.gamesPlayed,
				seasonBest: seasonBestOut(r),
				lastMatchAt: r.lastMatchAt ? r.lastMatchAt.getTime() : 0,
			},
		})
	}
	for (const r of before) {
		if (r.nakamaUserId && !rated.has(r.playerId))
			entries.push({ userId: r.nakamaUserId, name: '', record: null })
	}
	return entries
}

// The placements a replay rates: the players Nakama itself rated for that
// game (the mirror marks the rest rated:false -- a disputed result), or nothing when fewer than two are left, as Nakama's planRatings.
export function replayPlacements(
	resultPlacements: unknown,
): PlacementEntry[] | null {
	if (!Array.isArray(resultPlacements)) return null
	const rated = (resultPlacements as (PlacementEntry & { rated?: boolean })[])
		.filter((p) => p.rated !== false)
		.map(({ rated: _rated, ...p }) => p as PlacementEntry)
	return rated.length >= 2 ? rated : null
}

// Whether a match resolved within the season: from its start to its end
// (an ended season's later matches belong to the next one).
export function resolvedInSeason(
	at: Date | null,
	season: { startedAt: Date; endedAt: Date | null },
): boolean {
	if (!at) return false
	return (
		at >= season.startedAt && (season.endedAt === null || at < season.endedAt)
	)
}

type MatchRow = typeof matchmakingMatches.$inferSelect

export type VoidOutcome =
	| { kind: 'voided'; ranked: boolean; alreadyVoided: boolean }
	| { kind: 'not_found' }
	| { kind: 'not_resolved'; status: string }
	| { kind: 'failed'; reason: string }

// Voids a resolved match: marks it voided and, for a ranked one, rebuilds its
// rating scope without it. A match already voided rebuilds again (cheap, and
// it heals a void whose Nakama push failed), so a retried void is safe.
export async function voidMatch(matchId: string): Promise<VoidOutcome> {
	const [match] = await db
		.select()
		.from(matchmakingMatches)
		.where(eq(matchmakingMatches.matchId, matchId))

	if (!match) return { kind: 'not_found' }
	const alreadyVoided = match.status === 'voided'
	if (!alreadyVoided && match.status !== 'resolved') {
		console.log(
			`[void-match] ${matchId} has status='${match.status}', not 'resolved' -- refusing to void`,
		)
		return { kind: 'not_resolved', status: match.status }
	}

	await db
		.update(matchmakingMatches)
		.set({ status: 'voided', updatedAt: new Date() })
		.where(eq(matchmakingMatches.matchId, matchId))

	// Only ranked games move ratings. A casual match is just marked voided:
	// replaying its scope would invent a rating board for a casual mode.
	const ranked = match.gameMode.startsWith('ranked:')
	if (!ranked) {
		console.log(
			`[void-match] ${matchId} is a casual match (${match.gameMode}) -- voided, no ratings to rebuild`,
		)
		return { kind: 'voided', ranked, alreadyVoided }
	}
	const rebuilt = await rebuildScope(match)
	if (!rebuilt.ok) return { kind: 'failed', reason: rebuilt.reason }
	return { kind: 'voided', ranked, alreadyVoided }
}

export type SetResultOutcome =
	| { kind: 'set'; rerated: boolean }
	| { kind: 'not_found' }
	| { kind: 'failed'; reason: string }

// Replaces a match's recorded result (an overturned dispute) and, for a
// resolved ranked match, rebuilds its rating scope with the new result.
export async function setMatchResult(
	matchId: string,
	placements: { playerId: string; place: number; rated?: boolean }[],
): Promise<SetResultOutcome> {
	const [match] = await db
		.update(matchmakingMatches)
		.set({ resultPlacements: placements, updatedAt: new Date() })
		.where(eq(matchmakingMatches.matchId, matchId))
		.returning()
	if (!match) return { kind: 'not_found' }
	if (match.status !== 'resolved' || !match.gameMode.startsWith('ranked:'))
		return { kind: 'set', rerated: false }
	const rebuilt = await rebuildScope(match)
	if (!rebuilt.ok) return { kind: 'failed', reason: rebuilt.reason }
	return { kind: 'set', rerated: true }
}

// Rebuilds a ranked match's (modId, gameMode, season) scope from scratch:
// wipe its ratings and leaderboard, replay every resolved match in it in
// order, and push the result over Nakama's board.
export async function rebuildScope(
	match: MatchRow,
): Promise<{ ok: true } | { ok: false; reason: string }> {
	if (!match.resultReportedAt)
		return {
			ok: false,
			reason: `match ${match.matchId} has no resultReportedAt -- cannot resolve its season`,
		}
	const season = await getSeasonAt(match.resultReportedAt)
	if (!season)
		return {
			ok: false,
			reason: `no season was active at ${match.resultReportedAt.toISOString()}`,
		}

	const { modId, gameMode } = match
	console.log(
		`[void-match] rebuilding ${modId}:${gameMode}, season ${season.id} "${season.name}" (for ${match.matchId})`,
	)

	const before = await listScopeRatings(modId, gameMode, season.id)

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

	const scopedMatches = (
		await db
			.select()
			.from(matchmakingMatches)
			.where(
				and(
					eq(matchmakingMatches.status, 'resolved'),
					eq(matchmakingMatches.modId, modId),
					eq(matchmakingMatches.gameMode, gameMode),
					gte(matchmakingMatches.resultReportedAt, season.startedAt),
				),
			)
			.orderBy(asc(matchmakingMatches.resultReportedAt))
	).filter((row) => resolvedInSeason(row.resultReportedAt, season))

	let n = 0
	for (const row of scopedMatches) {
		const placements = replayPlacements(row.resultPlacements)
		if (!placements) continue
		const at = row.resultReportedAt ?? row.updatedAt
		await applyRatingTransaction(row, season.id, placements, at)
		n++
	}
	console.log(`[void-match] replayed ${n} of ${scopedMatches.length} resolved matches in scope`)

	const entries = nakamaRatingEntries(
		before,
		await listScopeRatings(modId, gameMode, season.id),
	)
	for (let i = 0; i < entries.length; i += RATINGS_SET_BATCH) {
		const result = await callNakamaRpc('admin_ratings_set', {
			modId,
			mode: nakamaModeOf(gameMode),
			season: season.id,
			entries: entries.slice(i, i + RATINGS_SET_BATCH),
		})
		if (!result.ok)
			return {
				ok: false,
				reason: `pushing the rebuilt ratings to Nakama failed: ${result.error}`,
			}
	}
	console.log(`[void-match] pushed ${entries.length} ratings to Nakama`)
	return { ok: true }
}

async function main() {
	const matchId = process.argv[2]
	if (!matchId) throw new Error('usage: void-match.ts <matchId>')
	const outcome = await voidMatch(matchId)
	console.log('[void-match]', outcome)
	await pool.end()
	if (outcome.kind !== 'voided') process.exit(1)
	process.exit(0)
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main().catch((err) => {
		console.error(err)
		process.exit(1)
	})
}
