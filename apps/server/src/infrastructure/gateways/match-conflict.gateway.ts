import { count, desc, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { matchResultConflicts } from '../db/schema.js'
import type { PlacementEntry } from '../../shared/types/index.js'

export type MatchResultConflictRecord = typeof matchResultConflicts.$inferSelect

/** Flags a conflicting second report for manual moderator review (§21.5). The
 * first report's outcome already stands -- this never itself changes a rating. */
export async function insertMatchConflict(data: {
	matchId: string
	lobbyCode: string
	firstReporterId: string
	firstPlacements: PlacementEntry[]
	conflictingReporterId: string
	conflictingPlacements: PlacementEntry[]
}): Promise<void> {
	await db.insert(matchResultConflicts).values(data)
}

export async function listMatchConflicts(
	page: number,
	limit: number,
): Promise<{ conflicts: MatchResultConflictRecord[]; total: number }> {
	const offset = (page - 1) * limit
	const [{ total }] = await db.select({ total: count() }).from(matchResultConflicts)
	const rows = await db
		.select()
		.from(matchResultConflicts)
		.orderBy(desc(matchResultConflicts.createdAt))
		.limit(limit)
		.offset(offset)
	return { conflicts: rows, total }
}

export async function resolveMatchConflict(
	id: number,
	resolutionNotes: string | undefined,
): Promise<MatchResultConflictRecord | null> {
	const [row] = await db
		.update(matchResultConflicts)
		.set({ status: 'resolved', resolutionNotes: resolutionNotes ?? null })
		.where(eq(matchResultConflicts.id, id))
		.returning()
	return row ?? null
}
