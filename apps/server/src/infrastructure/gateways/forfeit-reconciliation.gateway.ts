import { and, count, desc, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { forfeitReconciliationFlags } from '../db/schema.js'
import { voidMatch } from '../db/void-match.js'
import { enqueueServiceQueueItem } from './service-queue.gateway.js'

export type ForfeitReconciliationFlag = typeof forfeitReconciliationFlags.$inferSelect

/** Flags a candidate wrongful auto-forfeit for manual moderator review (see
 * schema.ts's comment on forfeitReconciliationFlags) -- never itself changes
 * a rating. */
export async function insertForfeitReconciliationFlag(data: {
	matchId: string
	lobbyCode: string
	playerId: string
	forfeitedAt: Date
	reconnectedAt: Date
}): Promise<void> {
	const [row] = await db
		.insert(forfeitReconciliationFlags)
		.values(data)
		.returning({ id: forfeitReconciliationFlags.id })

	await enqueueServiceQueueItem({
		itemType: 'forfeit_reconciliation',
		sourceId: String(row!.id),
		subjectPlayerId: data.playerId,
		summary: `Possible wrongful forfeit — lobby ${data.lobbyCode}`,
	})
}

export async function hasOpenForfeitReconciliationFlag(matchId: string, playerId: string): Promise<boolean> {
	const [row] = await db
		.select({ id: forfeitReconciliationFlags.id })
		.from(forfeitReconciliationFlags)
		.where(
			and(
				eq(forfeitReconciliationFlags.matchId, matchId),
				eq(forfeitReconciliationFlags.playerId, playerId),
				eq(forfeitReconciliationFlags.status, 'open'),
			),
		)
		.limit(1)
	return !!row
}

export async function listForfeitReconciliationFlags(
	page: number,
	limit: number,
): Promise<{ flags: ForfeitReconciliationFlag[]; total: number }> {
	const offset = (page - 1) * limit
	const [{ total }] = await db.select({ total: count() }).from(forfeitReconciliationFlags)
	const rows = await db
		.select()
		.from(forfeitReconciliationFlags)
		.orderBy(desc(forfeitReconciliationFlags.createdAt))
		.limit(limit)
		.offset(offset)
	return { flags: rows, total }
}

/** Dismiss a flag without touching the match -- the moderator decided the
 * forfeit was correct after all (e.g. the reconnect was to a different,
 * later match, or genuinely too late to matter). */
export async function dismissForfeitReconciliationFlag(
	id: number,
	resolutionNotes: string | undefined,
): Promise<ForfeitReconciliationFlag | null> {
	const [row] = await db
		.update(forfeitReconciliationFlags)
		.set({ status: 'dismissed', resolutionNotes: resolutionNotes ?? null })
		.where(eq(forfeitReconciliationFlags.id, id))
		.returning()
	return row ?? null
}

/** Void the flagged match (see void-match.ts) and mark the flag resolved. */
export async function voidForfeitReconciliationFlag(
	id: number,
	resolutionNotes: string | undefined,
): Promise<ForfeitReconciliationFlag | null> {
	const [flag] = await db.select().from(forfeitReconciliationFlags).where(eq(forfeitReconciliationFlags.id, id))
	if (!flag) return null

	await voidMatch(flag.matchId)

	const [row] = await db
		.update(forfeitReconciliationFlags)
		.set({ status: 'voided', resolutionNotes: resolutionNotes ?? null })
		.where(eq(forfeitReconciliationFlags.id, id))
		.returning()
	return row ?? null
}
