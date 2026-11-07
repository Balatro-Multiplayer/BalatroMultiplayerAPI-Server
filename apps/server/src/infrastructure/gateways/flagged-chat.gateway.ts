import { and, asc, desc, eq, gte, inArray, lte, sql } from 'drizzle-orm'
import {
	type ChatLabel,
	chatLabelRows,
	flaggedSourceId,
	linesBefore,
	membersOf,
	nextRound,
	summaryOf,
} from '../../features/service-queue/flagged-chat.js'
import { contextOf } from '../../features/service-queue/types.js'
import type { DbExecutor } from '../db/executor.js'
import { db } from '../db/index.js'
import {
	chatLogs,
	chatReviewLabels,
	flaggedMessages,
	serviceQueueItems,
} from '../db/schema.js'
import type { ServiceQueueItemRecord } from './service-queue.gateway.js'

// A conversation is capped so one busy lobby cannot make an item huge.
const CONVERSATION_LIMIT = 500
const CONTEXT_LINES = 10
const HOUR_MS = 60 * 60 * 1000

export type ChatLine = typeof chatLogs.$inferSelect

// A flagged message and the chat line it came from (null when the line has
// been purged).
export interface FlaggedMember {
	flaggedMessageId: number
	playerId: string
	message: string
	matches: unknown
	flaggedAt: Date
	line: ChatLine | null
}

export async function loadFlaggedMembers(
	item: { sourceId: string; context: unknown },
	exec: DbExecutor = db,
): Promise<FlaggedMember[]> {
	const ids = membersOf(contextOf(item.context), item.sourceId)
	if (ids.length === 0) return []
	const rows = await exec
		.select({ flag: flaggedMessages, line: chatLogs })
		.from(flaggedMessages)
		.leftJoin(chatLogs, eq(chatLogs.mirrorKey, flaggedMessages.mirrorKey))
		.where(inArray(flaggedMessages.id, ids))
		.orderBy(asc(flaggedMessages.flaggedAt), asc(flaggedMessages.id))
	return rows.map((r) => ({
		flaggedMessageId: r.flag.id,
		playerId: r.flag.playerId,
		message: r.flag.message,
		matches: r.flag.matches,
		flaggedAt: r.flag.flaggedAt,
		line: r.line,
	}))
}

// Every line of the lobby the members were sent in, oldest first: the lobby
// instance when known, else the same code within an hour of the flagged lines.
export async function lobbyConversation(
	members: readonly FlaggedMember[],
	exec: DbExecutor = db,
): Promise<ChatLine[]> {
	const lines = members.flatMap((m) => (m.line ? [m.line] : []))
	const first = lines[0]
	if (!first) return []
	const lobbyId = first.lobbyId
	const times = lines.map((l) => l.sentAt.getTime())
	const scope = lobbyId
		? eq(chatLogs.lobbyId, lobbyId)
		: and(
				eq(chatLogs.lobbyCode, first.lobbyCode),
				gte(chatLogs.sentAt, new Date(Math.min(...times) - HOUR_MS)),
				lte(chatLogs.sentAt, new Date(Math.max(...times) + HOUR_MS)),
			)
	return exec
		.select()
		.from(chatLogs)
		.where(scope)
		.orderBy(asc(chatLogs.sentAt), asc(chatLogs.id))
		.limit(CONVERSATION_LIMIT)
}

// Saves the label of a decided flagged chat item: one row for each message it
// holds. A decided, reopened and decided item replaces its earlier labels.
export async function saveChatLabels(
	exec: DbExecutor,
	item: { id: number; sourceId: string; context: unknown },
	label: ChatLabel,
	decidedAt: Date,
): Promise<void> {
	const members = await loadFlaggedMembers(item, exec)
	if (members.length === 0) return
	const conversation = await lobbyConversation(members, exec)
	const rows = chatLabelRows({
		itemId: item.id,
		label,
		decidedAt,
		members: members.map((m) => ({
			flaggedMessageId: m.flaggedMessageId,
			message: m.message,
			context: m.line
				? linesBefore(conversation, m.line.id, CONTEXT_LINES)
				: [],
			verdict: m.line?.moderationVerdict ?? null,
		})),
	})
	await exec
		.insert(chatReviewLabels)
		.values(rows)
		.onConflictDoUpdate({
			target: [chatReviewLabels.itemId, chatReviewLabels.flaggedMessageId],
			set: {
				message: sqlExcluded('message'),
				context: sqlExcluded('context'),
				score: sqlExcluded('score'),
				band: sqlExcluded('band'),
				label: sqlExcluded('label'),
				decidedAt: sqlExcluded('decided_at'),
			},
		})
}

const sqlExcluded = (column: string) => sql.raw(`excluded."${column}"`)

// Every saved label, newest decision first, for the admin export.
export async function listChatLabels() {
	return db
		.select({
			message: chatReviewLabels.message,
			context: chatReviewLabels.context,
			score: chatReviewLabels.score,
			band: chatReviewLabels.band,
			label: chatReviewLabels.label,
			decidedAt: chatReviewLabels.decidedAt,
		})
		.from(chatReviewLabels)
		.orderBy(desc(chatReviewLabels.decidedAt), desc(chatReviewLabels.id))
}

// A new flagged message joins the open flagged chat item of its player and
// lobby, or makes one (the next round, when the earlier items are decided).
// Returns the item when one was made, null when the message joined an open
// item or an item already covers it.
export async function addToFlaggedChatItem(input: {
	flaggedMessageId: number
	playerId: string
	lobbyId: string
	lobbyKind?: string
}): Promise<ServiceQueueItemRecord | null> {
	const base = `${input.lobbyId}:${input.playerId}`
	return db.transaction(async (tx) => {
		const existing = await tx
			.select()
			.from(serviceQueueItems)
			.where(
				and(
					eq(serviceQueueItems.itemType, 'flagged_chat'),
					eq(serviceQueueItems.subjectPlayerId, input.playerId),
				),
			)
			.for('update')
		const mine = existing.filter(
			(i) => i.sourceId === base || i.sourceId.startsWith(`${base}:`),
		)
		if (
			mine.some((i) =>
				membersOf(contextOf(i.context), i.sourceId).includes(
					input.flaggedMessageId,
				),
			)
		)
			return null
		const open = mine.find((i) => i.status === 'open')
		if (open) {
			const ids = [
				...membersOf(contextOf(open.context), open.sourceId),
				input.flaggedMessageId,
			]
			await tx
				.update(serviceQueueItems)
				.set({
					context: { ...(open.context as object), flaggedMessageIds: ids },
					summary: summaryOf(ids.length),
					updatedAt: new Date(),
				})
				.where(eq(serviceQueueItems.id, open.id))
			return null
		}
		const sourceId = flaggedSourceId(
			input.lobbyId,
			input.playerId,
			nextRound(
				base,
				mine.map((i) => i.sourceId),
			),
		)
		const [row] = await tx
			.insert(serviceQueueItems)
			.values({
				itemType: 'flagged_chat',
				sourceId,
				subjectPlayerId: input.playerId,
				summary: summaryOf(1),
				context: {
					...(input.lobbyKind ? { lobbyKind: input.lobbyKind } : {}),
					flaggedMessageIds: [input.flaggedMessageId],
				},
			})
			.returning()
		return row ?? null
	})
}
