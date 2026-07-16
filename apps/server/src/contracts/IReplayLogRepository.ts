export type LobbyRunStatus = 'active' | 'completed' | 'abandoned' | 'terminated'
export type PlayerLogStatus = 'partial' | 'complete'

export interface InsertRunParams {
	lobbyCode: string
	modId: string
	lobbyType: string
	matchmakingMatchId: string | null
}

export interface UpsertPlayerLogParams {
	runId: string
	playerId: string
	compressedEvents: string
	carbonHash: string | null
	eventCount: number
	status: PlayerLogStatus
	expiresAt: Date | null
}

export interface IReplayLogRepository {
	insertRun(params: InsertRunParams): Promise<string>
	upsertPlayerLog(params: UpsertPlayerLogParams): Promise<void>
	updateRunStatus(runId: string, status: LobbyRunStatus): Promise<void>
	purgeExpiredRunLogs(): Promise<number>
}
