// The player's own punishment list, as GET /auth/punishments returns it.
// No staff name is ever in it.
export type PunishmentType = 'warning' | 'chat_ban' | 'queue_ban' | 'account_ban' | 'username_ban'

export interface Punishment {
  id: string
  type: PunishmentType
  startsAt: string
  endsAt: string | null
  permanent: boolean
  status: 'active' | 'ended' | 'lifted'
  reason: string
  // The latest appeal of this punishment, and whether another can be made now.
  appeal: Appeal | null
  canAppeal: boolean
  // When the wait after a denial ends (null when no wait is running).
  appealAvailableAt: string | null
}

export interface Appeal {
  status: 'open' | 'denied' | 'granted'
  // Why staff decided as they did (null while the appeal is open).
  reason: string | null
  createdAt: string
  decidedAt: string | null
}

export interface AppealState {
  appeal: Appeal | null
  canAppeal: boolean
  appealAvailableAt: string | null
}

export interface PunishmentsResponse {
  punishments: Punishment[]
  networkBanned: boolean
  // The appeal state of the network ban (null when no network ban blocks the player).
  networkAppeal: AppealState | null
}

export const APPEAL_STATUS_LABEL: Record<Appeal['status'], string> = {
  open: 'Appeal open',
  denied: 'Appeal denied',
  granted: 'Appeal granted',
}

export const MAX_APPEAL_LENGTH = 2000

export const PUNISHMENT_LABEL: Record<PunishmentType, string> = {
  warning: 'Warning',
  chat_ban: 'Chat ban',
  queue_ban: 'Queue ban',
  account_ban: 'Account ban',
  username_ban: 'Username ban',
}

export const STATUS_LABEL: Record<Punishment['status'], string> = {
  active: 'Active',
  ended: 'Ended',
  lifted: 'Lifted',
}

export function endText(p: Punishment, format: (iso: string) => string): string {
  if (p.type === 'warning') return 'No end'
  if (p.permanent) return 'Permanent'
  return p.endsAt ? format(p.endsAt) : 'Permanent'
}
