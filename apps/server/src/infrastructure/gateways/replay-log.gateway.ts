import { eq, lt } from 'drizzle-orm'
import type {
	InsertRunParams,
	LobbyRunStatus,
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
