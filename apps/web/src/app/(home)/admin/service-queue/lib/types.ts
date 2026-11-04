// The service queue's API shapes, as apps/server's webadmin/service-queue
// route sends them (Q-api.md). Closed unions mirror the server's
// features/service-queue/types.ts.

export const ITEM_TYPES = [
  'report',
  'flagged_chat',
  'match_conflict',
  'forfeit_reconciliation',
  'contest',
  'anti_cheat',
  'integrity',
  'appeal',
] as const
export type ItemType = (typeof ITEM_TYPES)[number]
export const isItemType = (value: unknown): value is ItemType =>
  (ITEM_TYPES as readonly unknown[]).includes(value)

export type ItemStatus = 'open' | 'resolved'
export type StatusFilter = ItemStatus | 'all'
export type QueueSort = 'priority' | 'age'
export type StaffRole = 'moderator' | 'admin'
export type LobbyKind = 'ranked' | 'casual' | 'private' | 'none'

export type ActionKey =
  | 'dismiss'
  | 'resolve'
  | 'warn'
  | 'chat_mute'
  | 'queue_ban'
  | 'account_ban'
  | 'void'
  | 'overturn'
  | 'reopen'
  | 'unban'
  | 'note'

export type Duration = '24h' | '7d' | '30d' | 'permanent'

export type TargetRole =
  | 'subject'
  | 'reporter'
  | 'first_reporter'
  | 'conflicting_reporter'
  | 'contester'

export type ItemEventKind =
  | 'viewed'
  | 'claimed'
  | 'released'
  | 'acted'
  | 'noted'
  | 'reopened'

export interface QueueItem {
  id: number
  itemType: ItemType
  sourceId: string
  subjectPlayerId: string | null
  status: ItemStatus
  priority: number | null
  summary: string
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
  resolvedBy: string | null
  resolutionAction: string | null
  resolutionNotes: string | null
  claimedBy: string | null
  claimedUntil: string | null
  context: {
    lobbyKind?: LobbyKind
    integrityTrigger?: 'ranked' | 'repeated'
    contest?: { contesterId: string; againstId: string | null }
  }
}

export interface Claim {
  claimedBy: string
  claimedByName: string | null
  claimedUntil: string
}

export interface ListedItem extends QueueItem {
  claim: Claim | null
  subjectName: string | null
  subjectOpenItems: number
}

export interface AutomaticGroup {
  playerId: string
  playerName: string | null
  openItems: number
  latestItem: {
    id: number
    itemType: ItemType
    summary: string
    createdAt: string
  }
}

export interface QueueList {
  items: ListedItem[]
  total: number
  page: number
  limit: number
  pages: number
  counts: Record<ItemType, number>
}

export interface AllowedAction {
  action: ActionKey
  presets?: Duration[]
  targeted: boolean
  destructive: boolean
}

export interface Target {
  role: TargetRole
  playerId: string
}

export interface BanRow {
  id: string
  playerId: string
  banType: 'chat' | 'queue' | 'account'
  expiresAt: string | null
  issuedBy: string
  issuedAt: string
  reason: string | null
  liftedAt: string | null
}

export interface WarningRow {
  id: string
  playerId: string
  itemId: number | null
  message: string
  issuedBy: string
  issuedAt: string
}

export interface RatingRow {
  modId: string
  gameMode: string
  season: number
  rating: number
  wins: number
  losses: number
  gamesPlayed: number
  lastMatchAt: string | null
  rank: number | null
}

export interface OtherItem {
  id: number
  itemType: ItemType
  status: ItemStatus
  summary: string
  priority: number | null
  createdAt: string
  resolutionAction: string | null
}

export interface NakamaPlayerView {
  online: number
  lobby: { code?: string; matchId?: string; lobbyType?: string } | null
  ranked: { queued: boolean; inGame: boolean } | null
  mods: { mods: string[]; reportedAt: number } | null
  standing: {
    standing: 'none' | 'valid' | 'verified'
    disallowed: string[]
    reason: string | null
  } | null
  integrity: { verified: boolean; expiresAt: number | null } | null
  bans: Record<string, unknown>
}

export interface SubjectCard {
  player: {
    id: string
    name: string | null
    nakamaUserId: string | null
    createdAt: string | null
    deleted: boolean
    privileges: string[]
    chatEnabled: boolean
    chatBlocked: boolean
  }
  ratings: RatingRow[]
  nakama: NakamaPlayerView | null
  bans: { active: BanRow[]; prior: BanRow[] }
  warnings: WarningRow[]
  reportsAgainst: {
    total: number
    open: number
    distinctReporters: number
    byType: Record<string, number>
    recent: {
      id: number
      type: string
      status: string
      reporterId: string
      createdAt: string
    }[]
  }
  reportsFiled: { total: number; actioned: number }
  otherItems: { open: OtherItem[]; recentResolved: OtherItem[] }
}

// ---------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------

export interface MiniCard {
  id: string
  name: string | null
  nakamaUserId: string | null
}

export interface Placement {
  playerId: string
  place: number
}

export interface ChatLine {
  playerId: string
  displayName: string
  message: string
  sentAt: string
  flagged: boolean
  bySubject: boolean
  isFlaggedLine?: boolean
}

export type LogCheck = 'match' | 'mismatch' | 'unavailable' | string

// Nakama's admin_run_get: player ids in here are Nakama user ids.
export interface NakamaRunView {
  run: {
    runId: string
    code: string
    modId: string
    startedAt: number
    endedAt: number
    status: string
    placements: Placement[]
    reports: Record<string, Placement[]>
    players: { id: string; displayName: string }[]
    gameMode?: string | null
    rankedMode?: string | null
    seed?: string
    stake?: number
    lobbyType?: string
    flags?: Record<string, string>
    logChecks?: Record<string, LogCheck>
    overturned?: unknown
  }
  logs: Record<
    string,
    {
      eventCount: number
      truncated: boolean
      carbonHash: string | null
      check: LogCheck
    }
  >
}

// The stored replay's header: player ids in here are PG player ids.
export interface ReplayView {
  runId: string
  lobbyCode: string
  lobbyType: string
  status: string
  logs: {
    playerId: string
    eventCount: number
    status: string
    flagReason: string | null
    carbonHash: string | null
  }[]
}

export interface ReportEvidence {
  report: {
    id: number
    lobbyId: string | null
    lobbyCode: string | null
    reporterId: string
    reportedId: string
    type: string
    runId: string | null
    status: string
    message: string | null
    additionalDetail: string | null
    createdAt: string
  }
  reporter: MiniCard
  reported: MiniCard
  chat: ChatLine[]
  run: NakamaRunView | null
  replay: ReplayView | null
  related: {
    id: number
    type: string
    status: string
    reporterId: string
    reportedId: string
    createdAt: string
  }[]
}

// The 2 dismiss buttons of a flagged chat item (the server's flagged-chat.ts).
export type DismissLabel = 'not_harmful' | 'harmful_no_action'

export type ChatVerdict =
  | { source: 'local'; matches: string[] }
  | { source: 'remote'; band: string }

export interface FlaggedChatMessage {
  id: number
  message: string
  flaggedAt: string
  sentAt: string
  verdict: ChatVerdict
  // The guard's score and the moderation band; null for a message the guard
  // did not judge (older lines, the word list).
  guardScore: number | null
  band: string | null
  contextUsed: boolean | null
}

export interface ConversationLine extends ChatLine {
  // The flagged message this line is, when it is one of the player's flagged ones.
  flaggedMessageId: number | null
}

export interface FlaggedChatEvidence {
  playerId: string
  messages: FlaggedChatMessage[]
  source: { lobbyCode: string | null; lobbyId: string | null } | null
  conversation: ConversationLine[]
  otherFlags: {
    id: number
    message: string
    matches: unknown
    flaggedAt: string
    verdict: ChatVerdict
  }[]
  alreadyMuted: boolean
}

export interface ConflictPlayer {
  id: string
  name: string | null
  nakamaUserId: string | null
  logCheck: LogCheck | null
  flag: string | null
  // This match's mode only.
  ratings: { season: number; rating: number; gamesPlayed: number }[]
  forfeitFlags: number
  disputes: number
}

export interface MatchConflictEvidence {
  conflict: {
    id: number
    matchId: string
    lobbyCode: string | null
    firstReporterId: string
    firstPlacements: Placement[]
    conflictingReporterId: string
    conflictingPlacements: Placement[]
    status: string
    resolutionNotes: string | null
    createdAt: string
  }
  lobbyKind: LobbyKind
  match: {
    matchId: string
    gameMode: string
    modId: string
    status: string
    resultReportedAt: string | null
  } | null
  // null when no match row recorded a result (e.g. a private lobby).
  recorded: (Placement & { rated?: boolean })[] | null
  sides: {
    role: 'first_reporter' | 'conflicting_reporter'
    playerId: string
    placements: Placement[]
    agreesWithResult: boolean
  }[]
  players: ConflictPlayer[]
  run: NakamaRunView | null
  replay: ReplayView | null
  otherConflicts: MatchConflictEvidence['conflict'][]
}

export interface ContestPlayer {
  id: string
  name: string | null
  nakamaUserId: string | null
  role: 'contester' | 'subject' | null
  logCheck: LogCheck | null
  flag: string | null
  ratings: { season: number; rating: number; gamesPlayed: number }[]
  contestsStarted: number
}

// A contested run, held unrated until a moderator decides.
export interface ContestEvidence {
  contest: { contesterId: string; againstId: string | null }
  runId: string
  lobbyKind: LobbyKind
  match: {
    matchId: string
    gameMode: string
    modId: string
    status: string
    resultReportedAt: string | null
  } | null
  // The result reported before the contest, which a dismiss rates.
  recorded: (Placement & { rated?: boolean })[] | null
  players: ContestPlayer[]
  run: NakamaRunView | null
  replay: ReplayView | null
}

export type TimelineEvent = 'started' | 'forfeited' | 'reconnected' | 'ended'

export interface ForfeitEvidence {
  flag: {
    id: number
    matchId: string
    lobbyCode: string | null
    playerId: string
    forfeitedAt: string
    reconnectedAt: string
    status: string
    resolutionNotes: string | null
    createdAt: string
  }
  lobbyKind: LobbyKind
  timeline: { at: string; event: TimelineEvent }[]
  result: { status: string; placements: Placement[] | null } | null
  match: { matchId: string; gameMode: string; status: string } | null
  run: NakamaRunView | null
  replay: ReplayView | null
  history: {
    id: number
    matchId: string
    status: string
    forfeitedAt: string
    createdAt: string
  }[]
}

export type FlagExplanation =
  | { reason: 'hash_mismatch'; text: string }
  | { reason: 'unverified_log'; text: string }
  | {
      reason: 'elapsed_time_gate'
      text: string
      hands: number
      elapsedMs: number
      minimumMs: number
    }
  | { reason: 'unknown'; text: string }

export interface IntegrityEventRow {
  id: number
  playerId: string
  kind: string
  reason: string
  occurredAt: string
}

export interface AntiCheatEvidence {
  runId: string
  playerId: string
  flag: FlagExplanation
  log: ReplayView['logs'][number] | null
  check: LogCheck | null
  otherFlaggedPlayers: string[]
  run: NakamaRunView | null
  replay: ReplayView | null
  integrityEvents: IntegrityEventRow[]
  pastFlags: { runId: string; flagReason: string | null; finalizedAt: string }[]
}

export interface IntegrityEvidence {
  day: string | null
  trigger: 'ranked' | 'repeated' | null
  today: IntegrityEventRow[]
  recent: IntegrityEventRow[]
  rankedGames: {
    matchId: string
    gameMode: string
    status: string
    resultReportedAt: string | null
    resultPlacements: Placement[] | null
  }[]
}

// The item's type picks its evidence's shape.
export type TypedEvidence =
  | { itemType: 'report'; evidence: ReportEvidence | null }
  | { itemType: 'flagged_chat'; evidence: FlaggedChatEvidence | null }
  | { itemType: 'match_conflict'; evidence: MatchConflictEvidence | null }
  | { itemType: 'forfeit_reconciliation'; evidence: ForfeitEvidence | null }
  | { itemType: 'contest'; evidence: ContestEvidence | null }
  | { itemType: 'anti_cheat'; evidence: AntiCheatEvidence | null }
  | { itemType: 'integrity'; evidence: IntegrityEvidence | null }
  | { itemType: 'appeal'; evidence: AppealEvidence | null }

export interface AppealEvidence {
  appeal: {
    id: string
    message: string
    status: 'open' | 'denied' | 'granted'
    createdAt: string
    decisionReason: string | null
    decidedAt: string | null
    outcome: 'lift' | 'shorten' | null
  }
  target: 'ban' | 'warning' | 'network'
  punishment: {
    id: string
    type: string
    reason: string | null
    issuedBy: string
    issuedByName: string | null
    expiresAt: string | null
    liftedAt: string | null
  } | null
  earlier: {
    status: 'open' | 'denied' | 'granted'
    message: string
    decisionReason: string | null
    createdAt: string
    decidedAt: string | null
  }[]
}

export interface AppealDecisions {
  deny: boolean
  grant: boolean
}

export interface ItemDetail {
  item: QueueItem
  subject: SubjectCard | null
  evidence: unknown
  allowedActions: AllowedAction[]
  role: StaffRole
  claim: Claim | null
  targets: Target[]
  appealDecisions?: AppealDecisions
}

export interface ItemEvent {
  id: number
  itemId: number
  kind: ItemEventKind
  actor: string
  action: string | null
  note: string | null
  detail: unknown
  at: string
}

export interface ItemEvents {
  events: ItemEvent[]
  actorNames: Record<string, string>
}

export interface ActionEffects {
  ban?: BanRow
  liftedBan?: BanRow
  warningId?: string
  delivered?: boolean
  voided?: { runId: string; rerated: boolean }
  overturned?: { runId: string; placements: Placement[]; rerated: boolean }
}

export interface ActionResult {
  item: QueueItem
  action: ActionKey
  effects: ActionEffects
  allowedActions: AllowedAction[]
}

// What an action sends, per action (the server's command.ts).
export type ActionBody =
  | {
      action: 'resolve' | 'void' | 'reopen'
      reason: string
      note?: string
    }
  | {
      action: 'dismiss'
      reason: string
      note?: string
      dismissLabel?: DismissLabel
    }
  | {
      action: 'warn'
      reason: string
      message: string
      targetPlayerId?: string
      note?: string
    }
  | {
      action: 'chat_mute' | 'queue_ban' | 'account_ban'
      duration: Duration
      reason: string
      targetPlayerId?: string
      note?: string
    }
  | { action: 'overturn'; reason: string; toReportOf: string; note?: string }
  | { action: 'unban'; reason: string; banId: string; note?: string }
  | { action: 'note'; note: string }

export type RefusalCode =
  | 'not_found'
  | 'unknown_action'
  | 'invalid_body'
  | 'not_for_type'
  | 'wrong_status'
  | 'forbidden'
  | 'claimed'
  | 'invalid_target'
  | 'no_subject'
  | 'ban_not_found'
  | 'unchanged'
  | 'source_missing'
  | 'nakama_failed'
  | 'not_voidable'
