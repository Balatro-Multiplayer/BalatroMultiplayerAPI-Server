import { and, asc, count, countDistinct, desc, eq, gt, ilike, inArray, isNull, lte, notInArray, or, sql } from 'drizzle-orm'
import { AUTOMATIC_TYPES, PLAYER_MADE_TYPES, type QueueLane } from '../../features/service-queue/lanes.js'
import { priorityOf } from '../../features/service-queue/priority.js'
import {
	ITEM_TYPES,
	type ItemContext,
	type ItemEventKind,
	type ItemType,
	contextOf,
	isItemType,
} from '../../features/service-queue/types.js'
import type { DbExecutor } from '../db/executor.js'
import { db } from '../db/index.js'
import { playerBans, playerWarnings, players, reports, serviceQueueItemEvents, serviceQueueItems } from '../db/schema.js'

export type ServiceQueueItemType = ItemType
export const SERVICE_QUEUE_ITEM_TYPES = ITEM_TYPES
export const isServiceQueueItemType = isItemType

export type ServiceQueueItemRecord = typeof serviceQueueItems.$inferSelect
export type ServiceQueueItemEventRecord = typeof serviceQueueItemEvents.$inferSelect

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface EnqueueServiceQueueItemInput {
	itemType: ServiceQueueItemType
	sourceId: string
	subjectPlayerId?: string | null
	summary: string
	context?: ItemContext
}

/**
 * The single insert point for every item type (reports, conflicts, forfeits,
 * the Nakama mirror's chat and runs, integrity failures).
 * onConflictDoNothing on (itemType, sourceId) is a defensive dedupe -- the
 * same source row should never enqueue twice. Scores the new item and
 * rescores the subject's other open items, whose inputs just changed.
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
			context: input.context ?? {},
		})
		.onConflictDoNothing({
			target: [serviceQueueItems.itemType, serviceQueueItems.sourceId],
		})
		.returning()

	if (!row) return null
	await rescoreAfterChange(row).catch((err) => console.error('[service-queue] Rescoring failed:', err))
	return row
}

// ---------------------------------------------------------------------------
// Priority (the inputs are read here; features/service-queue/priority.ts scores)
// ---------------------------------------------------------------------------

async function scoreItem(exec: DbExecutor, item: ServiceQueueItemRecord): Promise<number> {
	const subject = item.subjectPlayerId
	let openItemsForSubject = 1
	let distinctReporters = 0
	let priorSanctions = 0
	if (subject) {
		const [open] = await exec
			.select({ n: count() })
			.from(serviceQueueItems)
			.where(and(eq(serviceQueueItems.subjectPlayerId, subject), eq(serviceQueueItems.status, 'open')))
		openItemsForSubject = Math.max(1, Number(open?.n ?? 1))
		if (item.itemType === 'report') {
			const [reporters] = await exec
				.select({ n: countDistinct(reports.reporterId) })
				.from(reports)
				.where(and(eq(reports.reportedId, subject), eq(reports.status, 'open')))
			distinctReporters = Number(reporters?.n ?? 0)
		}
		if (UUID.test(subject)) {
			const [bans] = await exec.select({ n: count() }).from(playerBans).where(eq(playerBans.playerId, subject))
			const [warns] = await exec
				.select({ n: count() })
				.from(playerWarnings)
				.where(eq(playerWarnings.playerId, subject))
			priorSanctions = Number(bans?.n ?? 0) + Number(warns?.n ?? 0)
		}
	}
	return priorityOf({
		itemType: isItemType(item.itemType) ? item.itemType : 'report',
		lobbyKind: contextOf(item.context).lobbyKind,
		openItemsForSubject,
		distinctReporters,
		priorSanctions,
	})
}

// Rescores every open item about the item's subject (or the item alone).
export async function rescoreAfterChange(item: ServiceQueueItemRecord, exec: DbExecutor = db): Promise<void> {
	const items = item.subjectPlayerId
		? await exec
				.select()
				.from(serviceQueueItems)
				.where(
					and(eq(serviceQueueItems.subjectPlayerId, item.subjectPlayerId), eq(serviceQueueItems.status, 'open')),
				)
		: [item]
	for (const open of items ?? []) {
		const priority = await scoreItem(exec, open)
		if (priority !== open.priority)
			await exec.update(serviceQueueItems).set({ priority }).where(eq(serviceQueueItems.id, open.id))
	}
}

// Rescores the open items about a player (a sanction changed their inputs).
export async function rescoreSubject(playerId: string, exec: DbExecutor = db): Promise<void> {
	const [any] = await exec
		.select()
		.from(serviceQueueItems)
		.where(and(eq(serviceQueueItems.subjectPlayerId, playerId), eq(serviceQueueItems.status, 'open')))
		.limit(1)
	if (any) await rescoreAfterChange(any, exec)
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

export type QueueSort = 'priority' | 'age'
export type QueueStatusFilter = 'open' | 'resolved' | 'all'

export interface ListFilters {
	page: number
	limit: number
	itemType?: ServiceQueueItemType
	// The main tab or the automatic tab; unset lists both.
	lane?: QueueLane
	status: QueueStatusFilter
	// A player id, or part of a player's name.
	subject?: string
	// Only items this player holds a live claim on.
	claimedBy?: string
	// Leaves out items someone other than this player holds a live claim on.
	hideClaimedFrom?: string
	// Only items created at least this long ago.
	olderThanMs?: number
	sort: QueueSort
	now: Date
}

export interface QueueListRow extends ServiceQueueItemRecord {
	subjectName: string | null
	subjectOpenItems: number
}

const escapeLike = (text: string) => text.replace(/[%_\\]/g, (c) => `\\${c}`)

// An item nobody else holds: no claim, a lapsed one, or the viewer's own.
function notClaimedByOthers(playerId: string, now: Date) {
	return or(
		isNull(serviceQueueItems.claimedUntil),
		lte(serviceQueueItems.claimedUntil, now),
		sql`split_part(${serviceQueueItems.claimedBy}, ':', 2) = ${playerId}`,
	)
}

// Open main-lane items other staff hold a live claim on; the rail only counts them.
export async function countClaimedByOthers(playerId: string, now: Date): Promise<number> {
	const [row] = await db
		.select({ n: count() })
		.from(serviceQueueItems)
		.where(
			and(
				eq(serviceQueueItems.status, 'open'),
				notInArray(serviceQueueItems.itemType, [...AUTOMATIC_TYPES]),
				gt(serviceQueueItems.claimedUntil, now),
				sql`split_part(${serviceQueueItems.claimedBy}, ':', 2) <> ${playerId}`,
			),
		)
	return Number(row?.n ?? 0)
}

export async function listServiceQueueItems(opts: ListFilters): Promise<{ items: QueueListRow[]; total: number }> {
	const offset = (opts.page - 1) * opts.limit
	const subjectMatch = opts.subject
		? UUID.test(opts.subject)
			? eq(serviceQueueItems.subjectPlayerId, opts.subject)
			: inArray(
					serviceQueueItems.subjectPlayerId,
					db
						.select({ id: sql<string>`${players.id}::text` })
						.from(players)
						.where(ilike(players.steamName, `%${escapeLike(opts.subject)}%`)),
				)
		: undefined
	const conditions = [
		opts.itemType ? eq(serviceQueueItems.itemType, opts.itemType) : undefined,
		opts.lane === 'main' ? notInArray(serviceQueueItems.itemType, [...AUTOMATIC_TYPES]) : undefined,
		opts.lane === 'automatic' ? inArray(serviceQueueItems.itemType, [...AUTOMATIC_TYPES]) : undefined,
		opts.status !== 'all' ? eq(serviceQueueItems.status, opts.status) : undefined,
		subjectMatch,
		opts.claimedBy
			? and(
					sql`split_part(${serviceQueueItems.claimedBy}, ':', 2) = ${opts.claimedBy}`,
					gt(serviceQueueItems.claimedUntil, opts.now),
				)
			: undefined,
		opts.hideClaimedFrom ? notClaimedByOthers(opts.hideClaimedFrom, opts.now) : undefined,
		opts.olderThanMs !== undefined
			? lte(serviceQueueItems.createdAt, new Date(opts.now.getTime() - opts.olderThanMs))
			: undefined,
	].filter((c) => c !== undefined)
	const where = conditions.length > 0 ? and(...conditions) : undefined

	const [{ total }] = await db.select({ total: count() }).from(serviceQueueItems).where(where)

	const order =
		opts.sort === 'priority'
			? [
					// Items players made come first, then the rest by priority.
					sql`CASE WHEN ${inArray(serviceQueueItems.itemType, [...PLAYER_MADE_TYPES])} THEN 0 ELSE 1 END`,
					sql`${serviceQueueItems.priority} DESC NULLS LAST`, asc(serviceQueueItems.createdAt)]
			: [desc(serviceQueueItems.createdAt)]
	const rows = await db
		.select({ item: serviceQueueItems, subjectName: players.steamName })
		.from(serviceQueueItems)
		.leftJoin(players, sql`${players.id}::text = ${serviceQueueItems.subjectPlayerId}`)
		.where(where)
		.orderBy(...order)
		.limit(opts.limit)
		.offset(offset)

	const subjects = [...new Set(rows.map((r) => r.item.subjectPlayerId).filter((s): s is string => !!s))]
	const openCounts = await openItemCounts(subjects)
	return {
		items: rows.map((r) => ({
			...r.item,
			subjectName: r.subjectName ?? null,
			subjectOpenItems: r.item.subjectPlayerId ? (openCounts.get(r.item.subjectPlayerId) ?? 0) : 0,
		})),
		total,
	}
}

export interface AutomaticGroup {
	playerId: string
	playerName: string | null
	openItems: number
	latestItem: { id: number; itemType: string; summary: string; createdAt: Date }
}

// One row per player with open automatic items, most items first.
export async function listAutomaticGroups(): Promise<AutomaticGroup[]> {
	const open = and(
		inArray(serviceQueueItems.itemType, [...AUTOMATIC_TYPES]),
		eq(serviceQueueItems.status, 'open'),
		sql`${serviceQueueItems.subjectPlayerId} IS NOT NULL`,
	)
	const counts = await db
		.select({ playerId: serviceQueueItems.subjectPlayerId, n: count() })
		.from(serviceQueueItems)
		.where(open)
		.groupBy(serviceQueueItems.subjectPlayerId)
		.orderBy(desc(count()), asc(serviceQueueItems.subjectPlayerId))
	if (counts.length === 0) return []
	const ids = counts.map((c) => c.playerId as string)
	const latest = await db
		.selectDistinctOn([serviceQueueItems.subjectPlayerId])
		.from(serviceQueueItems)
		.where(and(open, inArray(serviceQueueItems.subjectPlayerId, ids)))
		.orderBy(serviceQueueItems.subjectPlayerId, desc(serviceQueueItems.createdAt), desc(serviceQueueItems.id))
	const latestOf = new Map(latest.map((i) => [i.subjectPlayerId as string, i]))
	const names = new Map(
		(
			await db
				.select({ id: sql<string>`${players.id}::text`, name: players.steamName })
				.from(players)
				.where(inArray(sql`${players.id}::text`, ids))
		).map((p) => [p.id, p.name]),
	)
	return counts.flatMap((c) => {
		const item = latestOf.get(c.playerId as string)
		if (!item) return []
		return [
			{
				playerId: c.playerId as string,
				playerName: names.get(c.playerId as string) ?? null,
				openItems: Number(c.n),
				latestItem: { id: item.id, itemType: item.itemType, summary: item.summary, createdAt: item.createdAt },
			},
		]
	})
}

export async function openAutomaticItemIds(playerId: string): Promise<number[]> {
	const rows = await db
		.select({ id: serviceQueueItems.id })
		.from(serviceQueueItems)
		.where(
			and(
				eq(serviceQueueItems.subjectPlayerId, playerId),
				inArray(serviceQueueItems.itemType, [...AUTOMATIC_TYPES]),
				eq(serviceQueueItems.status, 'open'),
			),
		)
		.orderBy(asc(serviceQueueItems.id))
	return rows.map((r) => r.id)
}

async function openItemCounts(subjects: string[]): Promise<Map<string, number>> {
	if (subjects.length === 0) return new Map()
	const rows = await db
		.select({ subject: serviceQueueItems.subjectPlayerId, n: count() })
		.from(serviceQueueItems)
		.where(and(inArray(serviceQueueItems.subjectPlayerId, subjects), eq(serviceQueueItems.status, 'open')))
		.groupBy(serviceQueueItems.subjectPlayerId)
	return new Map(rows.map((r) => [r.subject as string, Number(r.n)]))
}

// The names behind 'role:playerId' actor strings (claims, audit events), by
// actor; an actor whose player is gone is left out.
export async function actorNames(actors: readonly (string | null)[]): Promise<Record<string, string>> {
	const byActor = new Map<string, string>()
	for (const actor of actors) {
		const id = actor ? actor.slice(actor.indexOf(':') + 1) : ''
		if (actor && UUID.test(id)) byActor.set(actor, id)
	}
	if (byActor.size === 0) return {}
	const rows = await db
		.select({ id: players.id, name: players.steamName })
		.from(players)
		.where(inArray(players.id, [...new Set(byActor.values())]))
	const names = new Map(rows.map((r) => [r.id, r.name]))
	return Object.fromEntries(
		[...byActor].flatMap(([actor, id]) => (names.has(id) ? [[actor, names.get(id) as string]] : [])),
	)
}

// Open items per type, for the tab counts.
export async function openCountsByType(): Promise<Record<ServiceQueueItemType, number>> {
	const rows = await db
		.select({ itemType: serviceQueueItems.itemType, n: count() })
		.from(serviceQueueItems)
		.where(eq(serviceQueueItems.status, 'open'))
		.groupBy(serviceQueueItems.itemType)
	const counts = Object.fromEntries(ITEM_TYPES.map((t) => [t, 0])) as Record<ServiceQueueItemType, number>
	for (const row of rows ?? []) if (isItemType(row.itemType)) counts[row.itemType] = Number(row.n)
	return counts
}

export async function getServiceQueueItemById(
	id: number,
	exec: DbExecutor = db,
): Promise<ServiceQueueItemRecord | null> {
	const [row] = await exec.select().from(serviceQueueItems).where(eq(serviceQueueItems.id, id)).limit(1)
	return row ?? null
}

export async function findServiceQueueItem(
	itemType: ServiceQueueItemType,
	sourceId: string,
): Promise<ServiceQueueItemRecord | null> {
	const [row] = await db
		.select()
		.from(serviceQueueItems)
		.where(and(eq(serviceQueueItems.itemType, itemType), eq(serviceQueueItems.sourceId, sourceId)))
		.limit(1)
	return row ?? null
}

// Every item about a player (newest first), for the subject card.
export async function listItemsForSubject(playerId: string, limit: number): Promise<ServiceQueueItemRecord[]> {
	return db
		.select()
		.from(serviceQueueItems)
		.where(eq(serviceQueueItems.subjectPlayerId, playerId))
		.orderBy(desc(serviceQueueItems.createdAt))
		.limit(limit)
}

// Whether any open item is about this source (the purges keep such rows).
export async function openSourceIds(itemType: ServiceQueueItemType, sourceIds: string[]): Promise<Set<string>> {
	if (sourceIds.length === 0) return new Set()
	const rows = await db
		.select({ sourceId: serviceQueueItems.sourceId })
		.from(serviceQueueItems)
		.where(
			and(
				eq(serviceQueueItems.itemType, itemType),
				eq(serviceQueueItems.status, 'open'),
				inArray(serviceQueueItems.sourceId, sourceIds),
			),
		)
	return new Set((rows ?? []).map((r) => r.sourceId))
}

// ---------------------------------------------------------------------------
// Claims (features/service-queue/claim.ts decides; these apply)
// ---------------------------------------------------------------------------

// Takes or refreshes the claim, unless someone else took it since the caller
// decided: the update only matches an unclaimed, expired or own claim.
export async function claimItem(
	id: number,
	actor: string,
	actorPlayerId: string,
	until: Date,
	now: Date,
): Promise<ServiceQueueItemRecord | null> {
	const [row] = await db
		.update(serviceQueueItems)
		.set({ claimedBy: actor, claimedUntil: until })
		.where(
			and(
				eq(serviceQueueItems.id, id),
				eq(serviceQueueItems.status, 'open'),
				or(
					isNull(serviceQueueItems.claimedUntil),
					lte(serviceQueueItems.claimedUntil, now),
					sql`split_part(${serviceQueueItems.claimedBy}, ':', 2) = ${actorPlayerId}`,
				),
			),
		)
		.returning()
	return row ?? null
}

export async function releaseItem(id: number, exec: DbExecutor = db): Promise<ServiceQueueItemRecord | null> {
	const [row] = await exec
		.update(serviceQueueItems)
		.set({ claimedBy: null, claimedUntil: null })
		.where(eq(serviceQueueItems.id, id))
		.returning()
	return row ?? null
}

// ---------------------------------------------------------------------------
// Status (inside the dispatcher's transaction)
// ---------------------------------------------------------------------------

/** Resolves an open item; null when it was no longer open (someone resolved
 *  it first), which the dispatcher turns into a rollback. */
export async function markServiceQueueItemResolved(
	exec: DbExecutor,
	id: number,
	resolvedBy: string,
	resolutionAction: string,
	resolutionNotes: string | null,
	now: Date = new Date(),
): Promise<ServiceQueueItemRecord | null> {
	const [row] = await exec
		.update(serviceQueueItems)
		.set({
			status: 'resolved',
			resolvedAt: now,
			resolvedBy,
			resolutionAction,
			resolutionNotes,
			claimedBy: null,
			claimedUntil: null,
			updatedAt: now,
		})
		.where(and(eq(serviceQueueItems.id, id), eq(serviceQueueItems.status, 'open')))
		.returning()
	return row ?? null
}

export async function markServiceQueueItemReopened(
	exec: DbExecutor,
	id: number,
	now: Date = new Date(),
): Promise<ServiceQueueItemRecord | null> {
	const [row] = await exec
		.update(serviceQueueItems)
		.set({
			status: 'open',
			resolvedAt: null,
			resolvedBy: null,
			resolutionAction: null,
			resolutionNotes: null,
			updatedAt: now,
		})
		.where(and(eq(serviceQueueItems.id, id), eq(serviceQueueItems.status, 'resolved')))
		.returning()
	return row ?? null
}

export async function touchServiceQueueItem(exec: DbExecutor, id: number, now: Date = new Date()): Promise<void> {
	await exec.update(serviceQueueItems).set({ updatedAt: now }).where(eq(serviceQueueItems.id, id))
}

// ---------------------------------------------------------------------------
// The audit trail
// ---------------------------------------------------------------------------

export interface ItemEventInput {
	itemId: number
	kind: ItemEventKind
	actor: string
	action?: string | null
	note?: string | null
	detail?: unknown
}

export async function recordItemEvent(exec: DbExecutor, event: ItemEventInput): Promise<void> {
	await exec.insert(serviceQueueItemEvents).values({
		itemId: event.itemId,
		kind: event.kind,
		actor: event.actor,
		action: event.action ?? null,
		note: event.note ?? null,
		detail: event.detail ?? null,
	})
}

export async function listItemEvents(itemId: number): Promise<ServiceQueueItemEventRecord[]> {
	return db
		.select()
		.from(serviceQueueItemEvents)
		.where(eq(serviceQueueItemEvents.itemId, itemId))
		.orderBy(asc(serviceQueueItemEvents.at), asc(serviceQueueItemEvents.id))
}

// Whether actor viewed the item since `since` (views are recorded once per window).
export async function viewedSince(itemId: number, actor: string, since: Date): Promise<boolean> {
	const [row] = await db
		.select({ id: serviceQueueItemEvents.id })
		.from(serviceQueueItemEvents)
		.where(
			and(
				eq(serviceQueueItemEvents.itemId, itemId),
				eq(serviceQueueItemEvents.actor, actor),
				eq(serviceQueueItemEvents.kind, 'viewed'),
				gt(serviceQueueItemEvents.at, since),
			),
		)
		.limit(1)
	return !!row
}
