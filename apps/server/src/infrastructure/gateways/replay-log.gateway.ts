import { desc, eq, inArray, lt } from 'drizzle-orm'
import type {
	InsertRunParams,
	LobbyRunStatus,
	RunRow,
	RunWithLogs,
	UpsertPlayerLogParams,
} from '../../contracts/IReplayLogRepository.js'
import { db } from '../db/index.js'
import { lobbyRuns, matchRunLogs } from '../db/schema.js'

export async function insertRun(params: InsertRunParams): Promise<string> {
	const [row] = await db
		.insert(lobbyRuns)
		.values({
			lobbyCode: params.lobbyCode,
			modId: params.modId,
			lobbyType: params.lobbyType,
			matchmakingMatchId: params.matchmakingMatchId ?? undefined,
		})
		.returning({ id: lobbyRuns.id })
	return row.id
}

export async function upsertPlayerLog(
	params: UpsertPlayerLogParams,
): Promise<void> {
	const finalizedAt = new Date()
	await db
		.insert(matchRunLogs)
		.values({
			runId: params.runId,
			playerId: params.playerId,
			compressedEvents: params.compressedEvents,
			carbonHash: params.carbonHash ?? undefined,
			eventCount: params.eventCount,
			status: params.status,
			flagReason: params.flagReason ?? undefined,
			finalizedAt,
			expiresAt: params.expiresAt ?? undefined,
		})
		.onConflictDoUpdate({
			target: [matchRunLogs.runId, matchRunLogs.playerId],
			set: {
				compressedEvents: params.compressedEvents,
				carbonHash: params.carbonHash ?? undefined,
				eventCount: params.eventCount,
				status: params.status,
				flagReason: params.flagReason ?? undefined,
				finalizedAt,
				expiresAt: params.expiresAt ?? undefined,
			},
		})
}

export async function updateRunStatus(
	runId: string,
	status: LobbyRunStatus,
): Promise<void> {
	await db
		.update(lobbyRuns)
		.set({ status, finalizedAt: new Date() })
		.where(eq(lobbyRuns.id, runId))
}

export async function purgeExpiredRunLogs(): Promise<number> {
	const result = await db
		.delete(matchRunLogs)
		.where(lt(matchRunLogs.expiresAt, new Date()))
	return result.rowCount ?? 0
}

// Account-deletion side effect: gameplay logs aren't deleted (they may still
// be needed for anti-cheat/replay purposes for the remainder of their normal
// retention window), but the player is no longer identifiable via playerId
// once their account is gone.
export async function pseudonymizeRunLogsForPlayer(
	playerId: string,
): Promise<void> {
	await db
		.update(matchRunLogs)
		.set({ playerId: `deleted_user_${playerId}` })
		.where(eq(matchRunLogs.playerId, playerId))
}

// The "current match" for a report filed from this lobby code (§15.6):
// codes get reused across different lobby instances over time, so this
// resolves to whichever run is most recent for that code -- correct at
// report-filing time, since that's necessarily the one just played. Returns
// null if no run has ever started under this code (e.g. reported mid-lobby
// before the match began).
export async function getMostRecentRunForLobbyCode(
	lobbyCode: string,
): Promise<string | null> {
	const [row] = await db
		.select({ id: lobbyRuns.id })
		.from(lobbyRuns)
		.where(eq(lobbyRuns.lobbyCode, lobbyCode))
		.orderBy(desc(lobbyRuns.startedAt))
		.limit(1)
	return row?.id ?? null
}

// §22.2: the discovery step a player-facing "My Matches" replay list needs --
// previously nothing let a player find their own past run ids at all; the
// only existing lookup (getMostRecentRunForLobbyCode) serves report-filing,
// not browsing. Two queries (run ids this player has a log row for, then
// those runs' own rows) rather than a join, since matchRunLogs has no FK
// back to a single canonical "which runs is this player in" projection and
// drizzle's own relational query builder isn't wired up elsewhere in this
// gateway (every other function here is plain query-builder style).
export async function getRunsForPlayer(
	playerId: string,
	limit: number,
): Promise<RunRow[]> {
	const logRows = await db
		.select({ runId: matchRunLogs.runId })
		.from(matchRunLogs)
		.where(eq(matchRunLogs.playerId, playerId))
	const runIds = [...new Set(logRows.map((r) => r.runId))]
	if (runIds.length === 0) return []

	const rows = await db
		.select()
		.from(lobbyRuns)
		.where(inArray(lobbyRuns.id, runIds))
		.orderBy(desc(lobbyRuns.startedAt))
		.limit(limit)

	return rows.map((run) => ({
		id: run.id,
		lobbyCode: run.lobbyCode,
		modId: run.modId,
		lobbyType: run.lobbyType,
		status: run.status as LobbyRunStatus,
		startedAt: run.startedAt,
		finalizedAt: run.finalizedAt,
	}))
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
