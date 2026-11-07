import { count, desc, eq, or } from 'drizzle-orm'
import type { DbExecutor } from '../db/executor.js'
import { db } from '../db/index.js'
import { matchResultConflicts } from '../db/schema.js'
import type { PlacementEntry } from '../../shared/types/index.js'
import { enqueueServiceQueueItem } from './service-queue.gateway.js'

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
	const [row] = await db.insert(matchResultConflicts).values(data).returning({ id: matchResultConflicts.id })

	await enqueueServiceQueueItem({
		itemType: 'match_conflict',
		sourceId: String(row!.id),
		subjectPlayerId: null,
		summary: `Match result conflict — lobby ${data.lobbyCode}`,
	})
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

export async function getMatchConflict(id: number): Promise<MatchResultConflictRecord | null> {
	const [row] = await db.select().from(matchResultConflicts).where(eq(matchResultConflicts.id, id)).limit(1)
	return row ?? null
}

export async function listConflictsForMatch(matchId: string): Promise<MatchResultConflictRecord[]> {
	return db.select().from(matchResultConflicts).where(eq(matchResultConflicts.matchId, matchId))
}

// The service queue's write (inside its transaction).
export async function setMatchConflictStatus(
	exec: DbExecutor,
	id: number,
	status: 'open' | 'resolved',
	resolutionNotes: string | null,
): Promise<MatchResultConflictRecord | null> {
	const [row] = await exec
		.update(matchResultConflicts)
		.set({ status, resolutionNotes })
		.where(eq(matchResultConflicts.id, id))
		.returning()
	return row ?? null
}

// How often a player was on either side of a conflict, for the evidence.
export async function countConflictsInvolving(playerId: string): Promise<number> {
	const [row] = await db
		.select({ n: count() })
		.from(matchResultConflicts)
		.where(
			or(eq(matchResultConflicts.firstReporterId, playerId), eq(matchResultConflicts.conflictingReporterId, playerId)),
		)
	return Number(row?.n ?? 0)
}
