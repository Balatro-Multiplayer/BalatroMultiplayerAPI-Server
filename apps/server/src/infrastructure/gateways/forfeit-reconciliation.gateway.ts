import { and, count, desc, eq } from 'drizzle-orm'
import type { ItemContext } from '../../features/service-queue/types.js'
import type { DbExecutor } from '../db/executor.js'
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
}, context: ItemContext = {}): Promise<void> {
	const [row] = await db
		.insert(forfeitReconciliationFlags)
		.values(data)
		.returning({ id: forfeitReconciliationFlags.id })

	await enqueueServiceQueueItem({
		itemType: 'forfeit_reconciliation',
		sourceId: String(row!.id),
		subjectPlayerId: data.playerId,
		summary: `Possible wrongful forfeit — lobby ${data.lobbyCode}`,
		context,
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

export type ForfeitFlagStatus = 'open' | 'voided' | 'dismissed'

export async function getForfeitReconciliationFlag(id: number): Promise<ForfeitReconciliationFlag | null> {
	const [row] = await db.select().from(forfeitReconciliationFlags).where(eq(forfeitReconciliationFlags.id, id)).limit(1)
	return row ?? null
}

// The service queue's write (inside its transaction): the flag's status
// follows its queue item.
export async function setForfeitFlagStatus(
	exec: DbExecutor,
	id: number,
	status: ForfeitFlagStatus,
	resolutionNotes: string | null,
): Promise<ForfeitReconciliationFlag | null> {
	const [row] = await exec
		.update(forfeitReconciliationFlags)
		.set({ status, resolutionNotes })
		.where(eq(forfeitReconciliationFlags.id, id))
		.returning()
	return row ?? null
}

// Every flag about a player (newest first), for the forfeit evidence.
export async function listForfeitFlagsForPlayer(
	playerId: string,
	limit: number,
): Promise<ForfeitReconciliationFlag[]> {
	return db
		.select()
		.from(forfeitReconciliationFlags)
		.where(eq(forfeitReconciliationFlags.playerId, playerId))
		.orderBy(desc(forfeitReconciliationFlags.createdAt))
		.limit(limit)
}
