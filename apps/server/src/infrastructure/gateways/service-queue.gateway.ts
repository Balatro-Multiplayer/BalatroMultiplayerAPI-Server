import { and, count, desc, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { serviceQueueItems } from '../db/schema.js'
import { mqttService } from '../mqtt/mqtt.service.js'

export type ServiceQueueItemType =
	| 'report'
	| 'flagged_chat'
	| 'match_conflict'
	| 'forfeit_reconciliation'
	| 'anti_cheat'

export const SERVICE_QUEUE_ITEM_TYPES: readonly ServiceQueueItemType[] = [
	'report',
	'flagged_chat',
	'match_conflict',
	'forfeit_reconciliation',
	'anti_cheat',
]

export function isServiceQueueItemType(value: unknown): value is ServiceQueueItemType {
	return typeof value === 'string' && SERVICE_QUEUE_ITEM_TYPES.includes(value as ServiceQueueItemType)
}

export type ServiceQueueItemRecord = typeof serviceQueueItems.$inferSelect

export interface EnqueueServiceQueueItemInput {
	itemType: ServiceQueueItemType
	sourceId: string
	subjectPlayerId?: string | null
	summary: string
}

/**
 * The single insert point for every one of the 5 item types (see each
 * source gateway's insert function -- report.gateway.ts's submitReport,
 * chat.gateway.ts's insertFlaggedMessage, match-conflict.gateway.ts's
 * insertMatchConflict, forfeit-reconciliation.gateway.ts's
 * insertForfeitReconciliationFlag, replay-log.service.ts's finalizeRun) and
 * the single call site that fires the future-Discord-bot MQTT seam
 * (mqttService.publishAdminQueueEvent). onConflictDoNothing on
 * (itemType, sourceId) is a defensive dedupe -- the same source row should
 * never enqueue twice -- so a retry never double-publishes either.
 */
export async function enqueueServiceQueueItem(
	input: EnqueueServiceQueueItemInput,
): Promise<ServiceQueueItemRecord | null> {
	const [row] = await db
		.insert(serviceQueueItems)
		.values({
			itemType: input.itemType,
			sourceId: input.sourceId,
			subjectPlayerId: input.subjectPlayerId ?? null,
			summary: input.summary,
		})
		.onConflictDoNothing({
			target: [serviceQueueItems.itemType, serviceQueueItems.sourceId],
		})
		.returning()

	if (!row) return null

	await mqttService
		.publishAdminQueueEvent('queue_item_created', {
			id: row.id,
			itemType: row.itemType,
			sourceId: row.sourceId,
			subjectPlayerId: row.subjectPlayerId,
			summary: row.summary,
			createdAt: row.createdAt,
		})
		.catch((e) => console.error('[service-queue] publishAdminQueueEvent failed:', e))

	return row
}

export async function listServiceQueueItems(opts: {
	page: number
	limit: number
	itemType?: ServiceQueueItemType
	status?: 'open' | 'resolved'
}): Promise<{ items: ServiceQueueItemRecord[]; total: number }> {
	const offset = (opts.page - 1) * opts.limit
	const conditions = [
		opts.itemType ? eq(serviceQueueItems.itemType, opts.itemType) : undefined,
		opts.status ? eq(serviceQueueItems.status, opts.status) : undefined,
	].filter((c) => c !== undefined)
	const where = conditions.length > 0 ? and(...conditions) : undefined

	const [{ total }] = await db
		.select({ total: count() })
		.from(serviceQueueItems)
		.where(where)

	const items = await db
		.select()
		.from(serviceQueueItems)
		.where(where)
		.orderBy(desc(serviceQueueItems.createdAt))
		.limit(opts.limit)
		.offset(offset)

	return { items, total }
}

export async function getServiceQueueItemById(id: number): Promise<ServiceQueueItemRecord | null> {
	const [row] = await db.select().from(serviceQueueItems).where(eq(serviceQueueItems.id, id)).limit(1)
	return row ?? null
}

/** Called by every action handler on success (service-queue-actions.ts) --
 *  never called standalone from a route. */
export async function markServiceQueueItemResolved(
	id: number,
	resolvedBy: string,
	resolutionAction: string,
): Promise<ServiceQueueItemRecord | null> {
	const [row] = await db
		.update(serviceQueueItems)
		.set({ status: 'resolved', resolvedAt: new Date(), resolvedBy, resolutionAction })
		.where(eq(serviceQueueItems.id, id))
		.returning()
	return row ?? null
}

