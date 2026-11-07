import { staffNamesOf } from './ban.gateway.js'
import { and, asc, desc, eq, inArray, like, or, sql } from 'drizzle-orm'
import { itemTypesVisibleTo } from '../../features/service-queue/permissions.js'
import type { DbExecutor } from '../db/executor.js'
import { db } from '../db/index.js'
import {
	chatLogs,
	lobbyRuns,
	matchmakingMatches,
	players,
	serviceQueueItems,
	staffLog,
} from '../db/schema.js'
import type { ConnectionKind, RunConnections } from '../../features/nakama/mirror.service.js'
import { callNakamaRpc } from '../nakama/admin-client.js'
import { findNakamaUserIds } from './player.gateway.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// What the match page's staff view reads about one run (a run id is also the
// matchmaking match id).

export interface RunWindow {
	runId: string
	lobbyCode: string
	startedAt: Date
	// Null while the run is still going.
	finalizedAt: Date | null
}

export async function findRunWindow(runId: string): Promise<RunWindow | null> {
	if (!UUID.test(runId)) return null
	const [run] = await db
		.select({
			runId: lobbyRuns.id,
			lobbyCode: lobbyRuns.lobbyCode,
			startedAt: lobbyRuns.startedAt,
			finalizedAt: lobbyRuns.finalizedAt,
		})
		.from(lobbyRuns)
		.where(eq(lobbyRuns.id, runId))
		.limit(1)
	return run ?? null
}

export interface RunConnectionEvent {
	playerId: string
	displayName: string | null
	kind: ConnectionKind
	at: number
	/** A kick: the player who did it, or 'server'. */
	by: string | null
	byName: string | null
	reason: string | null
}

export interface RunConnectionsView {
	events: RunConnectionEvent[]
	/** The highest log event the server held for each player at the end. */
	logHeld: { playerId: string; displayName: string | null; held: number }[]
}

// The run's joins, leaves and rejoins as the mirror stored them; null for a
// run stored before they were kept.
export async function findRunConnections(runId: string): Promise<RunConnectionsView | null> {
	if (!UUID.test(runId)) return null
	const [row] = await db
		.select({ connections: lobbyRuns.connections })
		.from(lobbyRuns)
		.where(eq(lobbyRuns.id, runId))
		.limit(1)
	const stored = row?.connections as RunConnections | null | undefined
	if (!stored) return null
	const ids = [
		...stored.events.flatMap((e) => (e.by ? [e.playerId, e.by] : [e.playerId])),
		...Object.keys(stored.logHeld),
	]
	const names = await displayNamesOf(ids)
	return {
		events: stored.events.map((e) => ({
			playerId: e.playerId,
			displayName: names.get(e.playerId) ?? null,
			kind: e.kind,
			at: e.at,
			by: e.by ?? null,
			byName: e.by ? (names.get(e.by) ?? null) : null,
			reason: e.reason ?? null,
		})),
		logHeld: Object.entries(stored.logHeld).map(([playerId, held]) => ({
			playerId,
			displayName: names.get(playerId) ?? null,
			held,
		})),
	}
}

export interface RunChatLine {
	id: number
	playerId: string
	displayName: string | null
	message: string
	flagged: boolean
	sentAt: Date
}

export const RUN_CHAT_LIMIT = 500

// The lobby's chat lines inside the run's time window, oldest first. Lobby
// codes are reused, so the window is what tells this lobby's lines from an
// earlier or later lobby with the same code.
export async function listRunChat(
	window: Pick<RunWindow, 'lobbyCode' | 'startedAt' | 'finalizedAt'>,
	until: Date,
): Promise<RunChatLine[]> {
	const end = window.finalizedAt ?? until
	const rows = await db
		.select({
			id: chatLogs.id,
			playerId: chatLogs.playerId,
			message: chatLogs.message,
			flagged: chatLogs.flagged,
			sentAt: chatLogs.sentAt,
		})
		.from(chatLogs)
		.where(
			and(
				eq(chatLogs.lobbyCode, window.lobbyCode),
				sql`${chatLogs.sentAt} >= ${window.startedAt}`,
				sql`${chatLogs.sentAt} <= ${end}`,
			),
		)
		.orderBy(asc(chatLogs.sentAt), asc(chatLogs.id))
		.limit(RUN_CHAT_LIMIT)
	const names = await displayNamesOf(rows.map((r) => r.playerId))
	return rows.map((r) => ({ ...r, displayName: names.get(r.playerId) ?? null }))
}

async function displayNamesOf(ids: string[]): Promise<Map<string, string>> {
	const uuids = [...new Set(ids.filter((id) => UUID.test(id)))]
	if (uuids.length === 0) return new Map()
	const rows = await db
		.select({
			id: players.id,
			steamName: players.steamName,
			discordUsername: players.discordUsername,
			useDiscordName: players.useDiscordName,
			nakamaUserId: players.nakamaUserId,
		})
		.from(players)
		.where(inArray(players.id, uuids))
	return staffNamesOf(
		rows.map((r) => ({
			id: r.id,
			nakamaUserId: r.nakamaUserId,
			steamName: r.useDiscordName && r.discordUsername ? r.discordUsername : r.steamName,
		})),
	)
}

export interface RunMatchRow {
	matchId: string
	gameMode: string
	modId: string
	status: string
	resultPlacements: unknown
	playerNames: Record<string, string>
}

export async function findRunMatch(runId: string): Promise<RunMatchRow | null> {
	const [row] = await db
		.select({
			matchId: matchmakingMatches.matchId,
			gameMode: matchmakingMatches.gameMode,
			modId: matchmakingMatches.modId,
			status: matchmakingMatches.status,
			resultPlacements: matchmakingMatches.resultPlacements,
			lobbyState: matchmakingMatches.lobbyState,
		})
		.from(matchmakingMatches)
		.where(eq(matchmakingMatches.matchId, runId))
		.limit(1)
	if (!row) return null
	const infos =
		(
			row.lobbyState as {
				playerInfos?: Record<string, { displayName?: string }>
			} | null
		)?.playerInfos ?? {}
	const { lobbyState: _lobbyState, ...rest } = row
	return {
		...rest,
		playerNames: Object.fromEntries(
			Object.entries(infos).flatMap(([id, info]) =>
				info.displayName ? [[id, info.displayName]] : [],
			),
		),
	}
}

export type RunQueueItem = typeof serviceQueueItems.$inferSelect

// Which queue items are about a run: a report, match conflict or forfeit flag
// points at the run through its source row; a contest, an anti-cheat item or a
// staff report carries the run id in its own source id.
function aboutRun(runId: string) {
	const source = serviceQueueItems.sourceId
	const type = serviceQueueItems.itemType
	return or(
		and(eq(type, 'contest'), eq(source, runId)),
		and(eq(type, 'anti_cheat'), like(source, `${runId}:%`)),
		and(eq(type, 'staff_report'), like(source, `${runId}:%`)),
		and(
			eq(type, 'report'),
			sql`${source} in (select id::text from reports where run_id = ${runId})`,
		),
		and(
			eq(type, 'match_conflict'),
			sql`${source} in (select id::text from match_result_conflicts where match_id = ${runId})`,
		),
		and(
			eq(type, 'forfeit_reconciliation'),
			sql`${source} in (select id::text from forfeit_reconciliation_flags where match_id = ${runId})`,
		),
	)
}

// The queue items about a run that a role sees, newest first.
export async function listQueueItemsAboutRun(
	runId: string,
	role: 'moderator' | 'admin',
): Promise<RunQueueItem[]> {
	return db
		.select()
		.from(serviceQueueItems)
		.where(
			and(
				inArray(serviceQueueItems.itemType, itemTypesVisibleTo(role)),
				aboutRun(runId),
			),
		)
		.orderBy(desc(serviceQueueItems.createdAt))
}

// Every open queue item about a run, of any type, oldest first. Runs inside
// the match edit's transaction so the items close with the void.
export async function listOpenItemsAboutRun(
	exec: DbExecutor,
	runId: string,
): Promise<RunQueueItem[]> {
	return exec
		.select()
		.from(serviceQueueItems)
		.where(and(eq(serviceQueueItems.status, 'open'), aboutRun(runId)))
		.orderBy(asc(serviceQueueItems.createdAt))
}

// Whether a role may see an open queue item about the run (the moderator's
// licence to edit the match).
export async function hasOpenItemVisibleTo(
	runId: string,
	role: 'moderator' | 'admin',
): Promise<boolean> {
	const [row] = await db
		.select({ id: serviceQueueItems.id })
		.from(serviceQueueItems)
		.where(
			and(
				eq(serviceQueueItems.status, 'open'),
				inArray(serviceQueueItems.itemType, itemTypesVisibleTo(role)),
				aboutRun(runId),
			),
		)
		.limit(1)
	return !!row
}

export interface RunStaffAction {
	id: number
	action: string
	staffPlayerId: string
	staffName: string | null
	staffRole: string
	itemId: number | null
	reason: string
	at: Date
}

// The staff actions taken on the run: those on its queue items and the
// match edits that name it. A moderator reads their own and those on queue
// items they see (the staff log's rule).
export async function listStaffActionsForRun(
	viewer: { playerId: string; role: 'moderator' | 'admin' },
	runId: string,
	itemIds: number[],
): Promise<RunStaffAction[]> {
	const about = or(
		sql`${staffLog.detail}->>'matchId' = ${runId}`,
		itemIds.length > 0 ? inArray(staffLog.itemId, itemIds) : undefined,
	)
	const visible =
		viewer.role === 'admin'
			? undefined
			: or(
					eq(staffLog.staffPlayerId, viewer.playerId),
					itemIds.length > 0 ? inArray(staffLog.itemId, itemIds) : undefined,
				)
	const rows = await db
		.select({
			id: staffLog.id,
			action: staffLog.action,
			staffPlayerId: staffLog.staffPlayerId,
			staffRole: staffLog.staffRole,
			itemId: staffLog.itemId,
			reason: staffLog.reason,
			at: staffLog.at,
		})
		.from(staffLog)
		.where(and(about, visible))
		.orderBy(desc(staffLog.at), desc(staffLog.id))
		.limit(100)
	const names = await displayNamesOf(rows.map((r) => r.staffPlayerId))
	return rows.map((r) => ({
		...r,
		staffName: names.get(r.staffPlayerId) ?? null,
	}))
}

export interface PlayerRating {
	delta: number | null
	newRating: number | null
	isPlacement: boolean
}

// Nakama's rating result for each rated player of the run, by player id.
// Empty when the run is unrated, not rated yet, or Nakama does not answer.
export async function findRunRatings(
	runId: string,
	playerIds: string[],
): Promise<Map<string, PlayerRating>> {
	const found = new Map<string, PlayerRating>()
	if (playerIds.length === 0) return found
	const [run, nakamaIds] = await Promise.all([
		callNakamaRpc<{
			run: { ratings?: Record<string, PlayerRating> }
		}>('admin_run_get', { runId }),
		findNakamaUserIds(playerIds),
	])
	if (!run.ok) return found
	for (const [playerId, nakamaId] of nakamaIds) {
		const rating = run.value.run.ratings?.[nakamaId]
		if (rating)
			found.set(playerId, {
				delta: rating.delta,
				newRating: rating.newRating,
				isPlacement: rating.isPlacement,
			})
	}
	return found
}
