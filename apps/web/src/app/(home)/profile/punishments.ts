// The player's own punishment list, as GET /auth/punishments returns it.
// No staff name is ever in it.
export type PunishmentType = 'warning' | 'chat_ban' | 'queue_ban' | 'account_ban'

export interface Punishment {
  id: string
  type: PunishmentType
  startsAt: string
  endsAt: string | null
  permanent: boolean
  status: 'active' | 'ended' | 'lifted'
  reason: string
}

export interface PunishmentsResponse {
  punishments: Punishment[]
  networkBanned: boolean
}

export const PUNISHMENT_LABEL: Record<PunishmentType, string> = {
  warning: 'Warning',
  chat_ban: 'Chat ban',
  queue_ban: 'Queue ban',
  account_ban: 'Account ban',
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
