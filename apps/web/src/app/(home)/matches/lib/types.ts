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

export interface MyRunsResponse {
  runs: RunRow[]
  total: number
  page: number
  pageSize: number
}

export type PlayerLogStatus = 'partial' | 'complete'
export type FlagReason = 'hash_mismatch' | 'elapsed_time_gate'

export interface PlayerLogRow {
  playerId: string
  compressedEvents: string
  carbonHash: string | null
  eventCount: number
  status: PlayerLogStatus
  flagReason: FlagReason | null
}

export interface RunReplayResponse {
  run: RunRow
  logs: PlayerLogRow[]
}
