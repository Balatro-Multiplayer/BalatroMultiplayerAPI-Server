import { and, desc, eq, inArray } from 'drizzle-orm'
import type {
	LobbyRunStatus,
	PaginatedRuns,
	RunRow,
	RunWithLogs,
} from '../../contracts/IReplayLogRepository.js'
import { db } from '../db/index.js'
import { shownNameOf } from '../../shared/players/shown-name.js'
import { usernameBannedAmong } from './ban.gateway.js'
import { lobbyRuns, matchRunLogs, players } from '../db/schema.js'

// A player's own runs, for "My Matches". Two queries (run ids this player has a log row for, then
// those runs' own rows) rather than a join, since matchRunLogs has no FK
// back to a single canonical "which runs is this player in" projection and
// drizzle's own relational query builder isn't wired up elsewhere in this
// gateway (every other function here is plain query-builder style).
export async function getRunsForPlayer(
	playerId: string,
	page: number,
	pageSize: number,
): Promise<PaginatedRuns> {
	const logRows = await db
		.select({ runId: matchRunLogs.runId })
		.from(matchRunLogs)
		.where(eq(matchRunLogs.playerId, playerId))
	const runIds = [...new Set(logRows.map((r) => r.runId))]
	const total = runIds.length
	if (total === 0) return { runs: [], total: 0 }

	const rows = await db
		.select()
		.from(lobbyRuns)
		.where(inArray(lobbyRuns.id, runIds))
		.orderBy(desc(lobbyRuns.startedAt))
		.limit(pageSize)
		.offset((page - 1) * pageSize)

	return {
		runs: rows.map((run) => ({
			id: run.id,
			lobbyCode: run.lobbyCode,
			modId: run.modId,
			lobbyType: run.lobbyType,
			status: run.status as LobbyRunStatus,
			startedAt: run.startedAt,
			finalizedAt: run.finalizedAt,
		})),
		total,
	}
}

// Exact join for the admin Match History page's "View Log" button:
// lobbyRuns.matchmakingMatchId is populated at run-creation time
// (replay-log.service.ts, from the live matchByLobby lookup) for any run
// backing a real ranked/casual match -- unlike getMostRecentRunForLobbyCode,
// this doesn't need to guess by lobby code + recency (codes get reused
// across unrelated lobby instances over time).
export async function getRunIdsForMatchIds(
	matchIds: string[],
): Promise<Map<string, string>> {
	if (matchIds.length === 0) return new Map()
	const rows = await db
		.select({
			id: lobbyRuns.id,
			matchmakingMatchId: lobbyRuns.matchmakingMatchId,
		})
		.from(lobbyRuns)
		.where(inArray(lobbyRuns.matchmakingMatchId, matchIds))
	const map = new Map<string, string>()
	for (const row of rows) {
		if (row.matchmakingMatchId) map.set(row.matchmakingMatchId, row.id)
	}
	return map
}

// The run a lobby is playing now: its newest active run, if any. Codes are
// reused, so only an active run counts.
export async function getActiveRunIdForLobbyCode(
	lobbyCode: string,
): Promise<string | null> {
	const [row] = await db
		.select({ id: lobbyRuns.id })
		.from(lobbyRuns)
		.where(and(eq(lobbyRuns.lobbyCode, lobbyCode), eq(lobbyRuns.status, 'active')))
		.orderBy(desc(lobbyRuns.startedAt))
		.limit(1)
	return row?.id ?? null
}

export async function getRunWithLogs(
	runId: string,
): Promise<RunWithLogs | undefined> {
	const [run] = await db.select().from(lobbyRuns).where(eq(lobbyRuns.id, runId))
	if (!run) return undefined

	const logs = await db
		.select({
			playerId: matchRunLogs.playerId,
			compressedEvents: matchRunLogs.compressedEvents,
			carbonHash: matchRunLogs.carbonHash,
			eventCount: matchRunLogs.eventCount,
			status: matchRunLogs.status,
			flagReason: matchRunLogs.flagReason,
			sharedAt: matchRunLogs.sharedAt,
		})
		.from(matchRunLogs)
		.where(eq(matchRunLogs.runId, runId))

	return {
		run: {
			id: run.id,
			lobbyCode: run.lobbyCode,
			modId: run.modId,
			lobbyType: run.lobbyType,
			status: run.status as LobbyRunStatus,
			startedAt: run.startedAt,
			finalizedAt: run.finalizedAt,
		},
		logs: logs.map((log) => ({
			...log,
			status: log.status as RunWithLogs['logs'][number]['status'],
			flagReason: log.flagReason as RunWithLogs['logs'][number]['flagReason'],
		})),
	}
}

// Sets or clears the player's own share flag. False when they have no row.
export async function setShared(
	runId: string,
	playerId: string,
	shared: boolean,
): Promise<boolean> {
	const rows = await db
		.update(matchRunLogs)
		.set({ sharedAt: shared ? new Date() : null })
		.where(
			and(eq(matchRunLogs.runId, runId), eq(matchRunLogs.playerId, playerId)),
		)
		.returning({ playerId: matchRunLogs.playerId })
	return rows.length > 0
}

// The name other players see: the Discord name when the player chose it, the
// Ban name under a username ban.
export async function getDisplayNames(
	playerIds: string[],
): Promise<Map<string, string>> {
	if (playerIds.length === 0) return new Map()
	const rows = await db
		.select({
			id: players.id,
			nakamaUserId: players.nakamaUserId,
			steamName: players.steamName,
			discordUsername: players.discordUsername,
			useDiscordName: players.useDiscordName,
		})
		.from(players)
		.where(inArray(players.id, playerIds))
	const banned = await usernameBannedAmong(playerIds)
	return new Map(rows.map((row) => [row.id, shownNameOf(row, banned.has(row.id))]))
}
