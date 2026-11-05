import { count, desc, eq, inArray, sql } from 'drizzle-orm'
import type { DbExecutor } from '../db/executor.js'
import { db } from '../db/index.js'
import {
	chatLogs,
	lobbyRuns,
	playerNotes,
	players,
	serviceQueueItems,
} from '../db/schema.js'
import { findPunishmentRef, listAppealsOf } from './appeal.gateway.js'
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

export interface PlayerChatPageLine {
	id: number
	lobbyCode: string
	lobbyId: string | null
	// The match the lobby ran while this line was sent, when it ran one.
	runId: string | null
	message: string
	flagged: boolean
	sentAt: Date
}

// One page of a player's whole chat, newest first. A lobby's lines stay
// together: lobby ids repeat only inside one lobby, and a line with no lobby
// id falls back to its lobby code. With flaggedFirst, lobbies that hold a
// flagged line of the player come first, newest first inside each half.
export async function listPlayerChatPage(
	playerId: string,
	opts: { page: number; limit: number; flaggedFirst: boolean },
): Promise<{ lines: PlayerChatPageLine[]; total: number }> {
	const key = sql`coalesce(${chatLogs.lobbyId}::text, ${chatLogs.lobbyCode})`
	const lobbyFlagged = sql`bool_or(${chatLogs.flagged}) over (partition by ${key})`
	const lobbyNewest = sql`max(${chatLogs.sentAt}) over (partition by ${key})`
	const order = [
		...(opts.flaggedFirst ? [sql`${lobbyFlagged} desc`] : []),
		sql`${lobbyNewest} desc`,
		sql`${key}`,
		desc(chatLogs.sentAt),
		desc(chatLogs.id),
	]
	const [rows, [{ total }]] = await Promise.all([
		db
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
			.orderBy(...order)
			.limit(opts.limit)
			.offset((opts.page - 1) * opts.limit),
		db.select({ total: count() }).from(chatLogs).where(eq(chatLogs.playerId, playerId)),
	])
	const codes = [...new Set(rows.map((r) => r.lobbyCode))]
	const runs =
		codes.length === 0
			? []
			: await db
					.select({
						id: lobbyRuns.id,
						lobbyCode: lobbyRuns.lobbyCode,
						startedAt: lobbyRuns.startedAt,
						finalizedAt: lobbyRuns.finalizedAt,
					})
					.from(lobbyRuns)
					.where(inArray(lobbyRuns.lobbyCode, codes))
					.orderBy(desc(lobbyRuns.startedAt))
	return {
		total,
		lines: rows.map((r) => ({
			...r,
			// Codes are reused, so a run counts only when the line fell inside it.
			runId:
				runs.find(
					(run) =>
						run.lobbyCode === r.lobbyCode &&
						run.startedAt <= r.sentAt &&
						(run.finalizedAt === null || r.sentAt <= run.finalizedAt),
				)?.id ?? null,
		})),
	}
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

// The punishment an appeal was about, as the page shows it.
export interface AppealPunishment {
	id: string | null
	kind: 'ban' | 'warning' | 'network_ban' | 'gone'
	// The ban's type (chat, queue, account); null for the others.
	banType: string | null
	// The reason on the punishment (a warning's message).
	reason: string | null
}

// Every appeal the player made, newest first, with its punishment. No
// network hashes: the page shows an appeal of a network ban as such.
export async function listPlayerAppeals(playerId: string) {
	const rows = await listAppealsOf(playerId)
	return Promise.all(
		rows.map(async (a) => {
			let punishment: AppealPunishment
			if (a.targetKind === 'network_ban' || a.punishmentId === null)
				punishment = { id: null, kind: 'network_ban', banType: null, reason: null }
			else {
				const ref = await findPunishmentRef(a.punishmentId)
				punishment = ref
					? { id: ref.id, kind: ref.kind, banType: ref.banType, reason: ref.reason }
					: { id: a.punishmentId, kind: 'gone', banType: null, reason: null }
			}
			return {
				id: a.id,
				punishment,
				message: a.message,
				status: a.status,
				outcome: a.outcome,
				decisionReason: a.decisionReason,
				decidedBy: a.decidedBy,
				decidedAt: a.decidedAt,
				createdAt: a.createdAt,
			}
		}),
	)
}
