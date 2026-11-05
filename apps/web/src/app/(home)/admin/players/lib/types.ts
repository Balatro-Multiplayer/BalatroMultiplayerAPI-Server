import type { BanType } from '@bmp/types'
import type { StrikeSummary } from './strikes'

// The shapes of GET /webadmin/players/:id/page and /identity
// (apps/server features/webadmin/player-page.route.ts).

export interface PagePlayer {
  id: string
  steamName: string
  privileges: string[]
  nakamaUserId: string | null
  createdAt: string
  deletedAt: string | null
  chatEnabled: boolean
  chatBlocked: boolean
  tosAcceptedVersion: number
  noticeAcceptedAt: string | null
}

export interface PageBan {
  id: string
  banType: BanType
  expiresAt: string | null
  issuedAt: string
  issuedByName: string | null
  reason: string
  liftedAt: string | null
  liftedByName: string | null
}

export interface PageWarning {
  id: string
  message: string
  issuedAt: string
  issuedByName: string | null
  liftedAt: string | null
}

export interface PageAppeal {
  id: string
  punishment: {
    id: string | null
    kind: 'ban' | 'warning' | 'network_ban' | 'gone'
    banType: string | null
    reason: string | null
  }
  message: string
  status: 'open' | 'denied' | 'granted'
  outcome: 'lifted' | 'shortened' | null
  decisionReason: string | null
  decidedByName: string | null
  decidedAt: string | null
  createdAt: string
}

export interface PageMatch {
  id: string
  lobbyCode: string
  modId: string
  lobbyType: string
  status: string
  startedAt: string
}

export interface PageChatLine {
  id: number
  lobbyCode: string
  message: string
  flagged: boolean
  sentAt: string
}

export interface PlayerChatGroup {
  key: string
  lobbyCode: string
  runId: string | null
  flagged: boolean
  lines: (PageChatLine & { lobbyId: string | null; runId: string | null })[]
}

// GET /webadmin/players/:id/chat
export interface PlayerChatPage {
  groups: PlayerChatGroup[]
  total: number
  page: number
  limit: number
  pages: number
}

export interface PageQueueItem {
  id: number
  itemType: string
  status: string
  summary: string
  createdAt: string
  resolutionAction: string | null
}

export interface PageNote {
  id: string
  note: string
  createdAt: string
  authorName: string | null
}

export interface PageIntegrityEvent {
  id: number
  kind: string
  reason: string
  occurredAt: string
}

export interface PlayerPage {
  player: PagePlayer
  punishments: { bans: PageBan[]; warnings: PageWarning[] }
  appeals: PageAppeal[]
  matches: PageMatch[]
  matchTotal: number
  chat: PageChatLine[]
  queueItems: PageQueueItem[]
  notes: PageNote[]
  integrityEvents: PageIntegrityEvent[]
  strikes: StrikeSummary
}

export interface PlayerIdentity {
  steamIdHash: string | null
  discordIdHash: string | null
  discordUsername: string | null
  networks: { count: number; hashes: { hash: string; lastSeen: number }[] }
  networkBans: {
    banId: string
    own: boolean
    networks: number
    bannedAt: number
    liftedAt: number | null
  }[]
  linkedAccounts: { playerId: string; name: string | null }[]
}

// One row of GET /webadmin/staff-log?player=<id> (the staff log's own shape).
export interface PlayerLogEntry {
  id: number
  staffName: string | null
  action: string
  itemId: number | null
  reason: string
  at: string
}
