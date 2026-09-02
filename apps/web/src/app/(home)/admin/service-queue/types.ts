export type ServiceQueueItemType =
  | 'report'
  | 'flagged_chat'
  | 'match_conflict'
  | 'forfeit_reconciliation'
  | 'anti_cheat'

export interface QueueItemEnvelope {
  id: number
  itemType: ServiceQueueItemType
  subjectPlayerId: string | null
  status: 'open' | 'resolved'
  summary: string
  createdAt: string
  resolvedAt: string | null
  resolvedBy: string | null
  resolutionAction: string | null
}
