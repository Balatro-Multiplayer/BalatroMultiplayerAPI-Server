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

export interface RunRow {
	id: string
	lobbyCode: string
	modId: string
	lobbyType: string
	status: LobbyRunStatus
	startedAt: Date
	finalizedAt: Date | null
}

export interface PlayerLogRow {
	playerId: string
	compressedEvents: string
	carbonHash: string | null
	eventCount: number
	status: PlayerLogStatus
}

export interface RunWithLogs {
	run: RunRow
	logs: PlayerLogRow[]
}

export interface IReplayLogRepository {
	insertRun(params: InsertRunParams): Promise<string>
	upsertPlayerLog(params: UpsertPlayerLogParams): Promise<void>
	updateRunStatus(runId: string, status: LobbyRunStatus): Promise<void>
	purgeExpiredRunLogs(): Promise<number>
	getRunWithLogs(runId: string): Promise<RunWithLogs | undefined>
}
