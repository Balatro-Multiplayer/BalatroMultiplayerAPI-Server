// What the player page shows, worked out from its data: the History list,
// Standing facts and Last actions. Pure, so the page only draws.
import type {
  PageAppeal,
  PageBan,
  PageIntegrityEvent,
  PageNote,
  PagePlayer,
  PageWarning,
  PlayerLogEntry,
  PlayerPage,
} from './types'

export type HistoryEntry =
  | { kind: 'ban'; key: string; at: string; ban: PageBan }
  | { kind: 'warning'; key: string; at: string; warning: PageWarning }
  | { kind: 'appeal'; key: string; at: string; appeal: PageAppeal }
  | { kind: 'note'; key: string; at: string; note: PageNote }
  | { kind: 'integrity'; key: string; at: string; event: PageIntegrityEvent }

const time = (iso: string) => new Date(iso).getTime()

// Punishments, appeals, staff notes and launcher failures, newest first.
export function historyOf(page: PlayerPage): HistoryEntry[] {
  const entries: HistoryEntry[] = [
    ...page.punishments.bans.map(
      (ban): HistoryEntry => ({
        kind: 'ban',
        key: `ban:${ban.id}`,
        at: ban.issuedAt,
        ban,
      })
    ),
    ...page.punishments.warnings.map(
      (warning): HistoryEntry => ({
        kind: 'warning',
        key: `warning:${warning.id}`,
        at: warning.issuedAt,
        warning,
      })
    ),
    ...page.appeals.map(
      (appeal): HistoryEntry => ({
        kind: 'appeal',
        key: `appeal:${appeal.id}`,
        at: appeal.createdAt,
        appeal,
      })
    ),
    ...page.notes.map(
      (note): HistoryEntry => ({
        kind: 'note',
        key: `note:${note.id}`,
        at: note.createdAt,
        note,
      })
    ),
    ...page.integrityEvents.map(
      (event): HistoryEntry => ({
        kind: 'integrity',
        key: `integrity:${event.id}`,
        at: event.occurredAt,
        event,
      })
    ),
  ]
  return entries.sort((a, b) => time(b.at) - time(a.at))
}

export function isActiveBan(ban: PageBan, now: number): boolean {
  return (
    !ban.liftedAt && (!ban.expiresAt || new Date(ban.expiresAt).getTime() > now)
  )
}

export function accountAge(createdAt: string, now: number): string {
  const days = Math.max(0, Math.floor((now - time(createdAt)) / 86_400_000))
  if (days < 1) return 'today'
  if (days < 60) return `${days} ${days === 1 ? 'day' : 'days'}`
  const months = Math.floor(days / 30)
  if (months < 24) return `${months} months`
  return `${Math.floor(days / 365)} years`
}

const BAN_NAMES: Record<string, string> = {
  chat: 'chat',
  queue: 'queue',
  account: 'account',
}

export function standingOf(
  page: Pick<PlayerPage, 'punishments' | 'matchTotal'> & {
    player: Pick<PagePlayer, 'createdAt' | 'chatEnabled' | 'chatBlocked'>
  },
  now: number
): [string, string][] {
  const active = page.punishments.bans.filter((b) => isActiveBan(b, now))
  return [
    ['Account age', accountAge(page.player.createdAt, now)],
    ['Matches', String(page.matchTotal)],
    [
      'Chat',
      page.player.chatBlocked
        ? 'blocked'
        : page.player.chatEnabled
          ? 'on'
          : 'off',
    ],
    [
      'Bans',
      active.length === 0
        ? 'none active'
        : active.map((b) => BAN_NAMES[b.banType] ?? b.banType).join(', '),
    ],
  ]
}

// The staff log wording for what staff did to this player.
const ACTION_TEXT: Record<string, string> = {
  warn: 'Warned',
  note: 'Note',
  chat_ban: 'Chat ban',
  queue_ban: 'Queue ban',
  account_ban: 'Account ban',
  lift_ban: 'Ban lifted',
  lift_network_ban: 'Network ban lifted',
  lift_warning: 'Warning lifted',
  dismiss: 'Item dismissed',
  resolve: 'Item resolved',
  void: 'Match voided',
  overturn: 'Result changed',
  reopen: 'Item reopened',
  appeal_deny: 'Appeal denied',
  appeal_grant: 'Appeal granted',
  role_grant: 'Role given',
  role_remove: 'Role removed',
}

export interface LastAction {
  id: number
  at: string
  text: string
  note: string
  by: string
}

export function lastActionsOf(
  entries: readonly PlayerLogEntry[],
  limit = 5
): LastAction[] {
  return [...entries]
    .sort((a, b) => time(b.at) - time(a.at))
    .slice(0, limit)
    .map((e) => ({
      id: e.id,
      at: e.at,
      text: ACTION_TEXT[e.action] ?? e.action.replaceAll('_', ' '),
      note: e.reason,
      by: e.staffName ?? 'unknown',
    }))
}
