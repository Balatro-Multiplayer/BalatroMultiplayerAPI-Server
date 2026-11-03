export type LobbyRunStatus = 'active' | 'completed' | 'abandoned' | 'terminated'
export type PlayerLogStatus = 'partial' | 'complete'
export type FlagReason =
	| 'hash_mismatch'
	| 'elapsed_time_gate'
	| 'unverified_log'

export interface RunRow {
	id: string
	lobbyCode: string
	modId: string
	lobbyType: string
	status: LobbyRunStatus
	startedAt: Date
	finalizedAt: Date | null
}

// The run as the replay response shows it. A public viewer gets no lobby code.
export interface ReplayRun extends Omit<RunRow, 'lobbyCode'> {
	lobbyCode: string | null
}

export interface PlayerLogRow {
	playerId: string
	compressedEvents: string
	carbonHash: string | null
	eventCount: number
	status: PlayerLogStatus
	flagReason: FlagReason | null
	// When this player shared their own side, or null.
	sharedAt: Date | null
}

export type ReplayViewerRole = 'participant' | 'moderator' | 'public'

// One side of a Shared match as the viewer may see it.
export interface ReplaySide {
	playerId: string
	displayName: string
	shared: boolean
	// True when the side was reduced to the result, lives lost and PvP blind
	// scores (see features/replay-log/hidden-side.ts).
	hidden: boolean
	compressedEvents: string
	carbonHash: string | null
	eventCount: number
	status: PlayerLogStatus
	flagReason: FlagReason | null
}

export interface ReplayResponse {
	run: ReplayRun
	logs: ReplaySide[]
	viewer: { role: ReplayViewerRole; playerId?: string }
}

export interface RunWithLogs {
	run: RunRow
	logs: PlayerLogRow[]
}

export interface PaginatedRuns {
	runs: RunRow[]
	total: number
}

export interface IReplayLogRepository {
	getRunWithLogs(runId: string): Promise<RunWithLogs | undefined>
	getRunsForPlayer(
		playerId: string,
		page: number,
		pageSize: number,
	): Promise<PaginatedRuns>
	getRunIdsForMatchIds(matchIds: string[]): Promise<Map<string, string>>
	// False when the player has no row in the run.
	setShared(runId: string, playerId: string, shared: boolean): Promise<boolean>
	getDisplayNames(playerIds: string[]): Promise<Map<string, string>>
}
