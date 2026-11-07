import { TYPE_LABELS } from '../../admin/service-queue/lib/format'
import type {
  ConnectionEvent,
  QueueItemClaim,
  StaffQueueItem,
  StaffResultRow,
} from './types'

// Pure rules for the staff parts of the match page: the tabs, the links back
// to the queue, and the wording of the result, claims and staff actions.

export type StaffTabKey =
  | 'timeline'
  | 'chat'
  | 'rounds'
  | 'logs'
  | 'connections'

export interface StaffTab {
  key: StaffTabKey
  label: string
  /** Shown next to the label; null while it is not known yet. */
  count: number | null
}

export function staffTabs(counts: {
  chat: number | null
  rounds: number
  logs: number
  /** Null while the staff data is not loaded, or the match has none. */
  connections: number | null
}): StaffTab[] {
  return [
    { key: 'timeline', label: 'Timeline', count: null },
    { key: 'chat', label: 'Chat', count: counts.chat },
    { key: 'rounds', label: 'Rounds', count: counts.rounds },
    { key: 'logs', label: 'Logs', count: counts.logs },
    { key: 'connections', label: 'Connections', count: counts.connections },
  ]
}

/** "A vs B", or "Match" when no player is known. */
export function matchTitle(names: readonly string[]): string {
  return names.length > 0 ? names.join(' vs ') : 'Match'
}

export const playerPageHref = (playerId: string) => `/admin/players/${playerId}`

export const queueItemHref = (itemId: number) =>
  `/admin/service-queue/${itemId}`

export const STAFF_LOG_HREF = '/admin/staff-log'

/** The "Back to queue item" link, shown only when staff came from an item. */
export function backToQueueItem(
  itemId: number | null,
  items: readonly Pick<StaffQueueItem, 'id' | 'itemType'>[]
): { href: string; text: string } | null {
  if (itemId === null || !Number.isInteger(itemId) || itemId <= 0) return null
  const item = items.find((i) => i.id === itemId)
  return {
    href: queueItemHref(itemId),
    text: item
      ? `Back to queue item: ${TYPE_LABELS[item.itemType]}`
      : 'Back to queue item',
  }
}

/** "+23 to 767", "-23 to 854", "Placement game" or "Not rated". */
export function ratingChangeText(
  row: Pick<StaffResultRow, 'delta' | 'newRating' | 'isPlacement'>
): string {
  if (row.isPlacement) return 'Placement game'
  if (row.delta === null) return 'Not rated'
  const sign = row.delta > 0 ? '+' : row.delta < 0 ? '-' : ''
  const change = `${sign}${Math.abs(row.delta)}`
  return row.newRating === null ? change : `${change} to ${row.newRating}`
}

export function claimText(claim: QueueItemClaim): string | null {
  if (claim === 'you') return 'claimed by you'
  if (claim === 'other') return 'claimed by another staff member'
  return null
}

/** "open, claimed by you" or "resolved". */
export function queueItemStatusText(
  item: Pick<StaffQueueItem, 'status' | 'claim'>
): string {
  const claim = item.status === 'open' ? claimText(item.claim) : null
  return claim ? `${item.status}, ${claim}` : item.status
}

const ACTION_TEXT: Record<string, string> = {
  match_result: 'Set result',
  match_void: 'Void match',
  void: 'Void match',
  overturn: 'Change result',
  chat_ban: 'Chat ban',
  queue_ban: 'Queue ban',
  account_ban: 'Account ban',
  username_ban: 'Username ban',
}

/** A staff log action kind in words. */
export function actionText(action: string): string {
  if (ACTION_TEXT[action]) return ACTION_TEXT[action]
  const words = action.replaceAll('_', ' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

const CONNECTION_TEXT: Record<ConnectionEvent['kind'], string> = {
  joined: 'Joined',
  rejoined: 'Rejoined',
  left: 'Left',
  disconnected: 'Disconnected',
  kicked: 'Kicked',
  timed_out: 'Timed out while away',
  catch_up_limit: 'Catch-up limit reached',
}

/** "Rejoined", or "Kicked by the server: banned" for a kick. */
export function connectionText(
  event: Pick<ConnectionEvent, 'kind' | 'by' | 'byName' | 'reason'>
): string {
  const base = CONNECTION_TEXT[event.kind]
  if (event.kind !== 'kicked') return base
  const who =
    event.by === 'server' ? 'the server' : (event.byName ?? 'another player')
  return event.reason ? `${base} by ${who}: ${event.reason}` : `${base} by ${who}`
}
