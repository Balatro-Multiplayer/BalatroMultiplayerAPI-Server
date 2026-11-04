import { desc, eq, inArray } from 'drizzle-orm'
import type { DbExecutor } from '../db/executor.js'
import { db } from '../db/index.js'
import {
	chatLogs,
	playerNotes,
	players,
	serviceQueueItems,
} from '../db/schema.js'
import { actorNames } from './service-queue.gateway.js'

// Reads and writes of the staff player page that no other gateway owns.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const PAGE_SECTION_LIMIT = 100

export type PlayerNoteRecord = typeof playerNotes.$inferSelect

export async function listPlayerChat(
	playerId: string,
	limit = PAGE_SECTION_LIMIT,
) {
	return db
		.select({
			id: chatLogs.id,
			lobbyCode: chatLogs.lobbyCode,
			lobbyId: chatLogs.lobbyId,
			message: chatLogs.message,
			flagged: chatLogs.flagged,
			sentAt: chatLogs.sentAt,
		})
		.from(chatLogs)
		.where(eq(chatLogs.playerId, playerId))
		.orderBy(desc(chatLogs.sentAt), desc(chatLogs.id))
		.limit(limit)
}

export async function listPlayerQueueItems(
	playerId: string,
	limit = PAGE_SECTION_LIMIT,
) {
	return db
		.select({
			id: serviceQueueItems.id,
			itemType: serviceQueueItems.itemType,
			status: serviceQueueItems.status,
			summary: serviceQueueItems.summary,
			createdAt: serviceQueueItems.createdAt,
			resolutionAction: serviceQueueItems.resolutionAction,
		})
		.from(serviceQueueItems)
		.where(eq(serviceQueueItems.subjectPlayerId, playerId))
		.orderBy(desc(serviceQueueItems.createdAt))
		.limit(limit)
}

export async function listPlayerNotes(
	playerId: string,
): Promise<PlayerNoteRecord[]> {
	return db
		.select()
		.from(playerNotes)
		.where(eq(playerNotes.playerId, playerId))
		.orderBy(desc(playerNotes.createdAt))
}

export async function insertPlayerNote(
	exec: DbExecutor,
	data: { playerId: string; authorId: string; note: string },
): Promise<PlayerNoteRecord> {
	const [row] = await exec.insert(playerNotes).values(data).returning()
	return row!
}

// Names for 'role:playerId' actors and bare player ids, keyed as given.
export async function namesOf(
	actors: readonly (string | null)[],
): Promise<Record<string, string>> {
	const named = await actorNames(actors)
	const bare = [
		...new Set(
			actors.filter((a): a is string => !!a && UUID.test(a) && !(a in named)),
		),
	]
	if (bare.length === 0) return named
	const rows = await db
		.select({ id: players.id, name: players.steamName })
		.from(players)
		.where(inArray(players.id, bare))
	return { ...named, ...Object.fromEntries(rows.map((r) => [r.id, r.name])) }
}
