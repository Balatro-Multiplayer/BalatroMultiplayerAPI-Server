import type { ItemType } from '../../admin/service-queue/lib/types'

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

// The staff-only parts of the match page (apps/server webadmin match-staff
// route): the result with rating changes, the queue items about the match and
// the staff actions taken on it.
export interface StaffResultRow {
  playerId: string
  displayName: string | null
  place: number
  /** The match's rating change; null when the player was not rated. */
  delta: number | null
  newRating: number | null
  isPlacement: boolean
}

export type QueueItemClaim = 'you' | 'other' | null

export interface StaffQueueItem {
  id: number
  itemType: ItemType
  status: 'open' | 'resolved'
  summary: string
  createdAt: string
  claim: QueueItemClaim
}

export interface StaffActionRow {
  id: number
  action: string
  staffPlayerId: string
  staffName: string | null
  staffRole: string
  itemId: number | null
  reason: string
  at: string
}

export type ConnectionKind =
  | 'joined'
  | 'rejoined'
  | 'left'
  | 'disconnected'
  | 'kicked'
  | 'timed_out'
  | 'catch_up_limit'

export interface ConnectionEvent {
  playerId: string
  displayName: string | null
  kind: ConnectionKind
  /** Epoch milliseconds. */
  at: number
  /** A kick: the player who did it, or 'server'. */
  by: string | null
  byName: string | null
  reason: string | null
}

export interface RunConnections {
  events: ConnectionEvent[]
  /** The highest log event the server held for each player at the end. */
  logHeld: { playerId: string; displayName: string | null; held: number }[]
}

export interface MatchStaffResponse {
  match: { gameMode: string; modId: string; status: string } | null
  result: StaffResultRow[] | null
  queueItems: StaffQueueItem[]
  staffActions: StaffActionRow[]
  /** Null for a match stored before joins and leaves were kept. */
  connections: RunConnections | null
  viewer: { role: 'moderator' | 'admin' }
}

export interface MatchChatLine {
  id: number
  playerId: string
  displayName: string | null
  message: string
  flagged: boolean
  sentAt: string
}

export interface MatchChatResponse {
  lines: MatchChatLine[]
  window: { from: string; to: string | null }
}
