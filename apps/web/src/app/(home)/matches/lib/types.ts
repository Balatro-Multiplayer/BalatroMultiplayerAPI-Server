export type RunStatus = 'active' | 'completed' | 'abandoned' | 'terminated'

export interface RunRow {
  id: string
  lobbyCode: string
  modId: string
  lobbyType: string
  status: RunStatus
  startedAt: string
  finalizedAt: string | null
}

// The run in a match view. A public viewer gets no lobby code.
export interface ReplayRun extends Omit<RunRow, 'lobbyCode'> {
  lobbyCode: string | null
}

export interface MyRunsResponse {
  runs: RunRow[]
  total: number
  page: number
  pageSize: number
}

export type PlayerLogStatus = 'partial' | 'complete'
export type FlagReason = 'hash_mismatch' | 'elapsed_time_gate' | 'unverified_log'

export interface PlayerLogRow {
  playerId: string
  displayName: string
  // The player shared their own side.
  shared: boolean
  // The side was reduced to the result, lives lost and PvP blind scores.
  hidden: boolean
  compressedEvents: string
  carbonHash: string | null
  eventCount: number
  status: PlayerLogStatus
  flagReason: FlagReason | null
}

export type ReplayViewerRole = 'participant' | 'moderator' | 'public'

export interface RunReplayResponse {
  run: ReplayRun
  logs: PlayerLogRow[]
  viewer: { role: ReplayViewerRole; playerId?: string }
}
