// Which tab the player page opens on, and the link back to the queue item.
import { TYPE_LABELS } from '../../service-queue/lib/format'
import { queueItemHref } from '../../service-queue/lib/links'
import { isItemType } from '../../service-queue/lib/types'

export const PLAYER_TABS = [
  'history',
  'chat',
  'matches',
  'reports',
  'linked',
] as const
export type PlayerTab = (typeof PLAYER_TABS)[number]

export const TAB_LABELS: Record<PlayerTab, string> = {
  history: 'History',
  chat: 'Chat',
  matches: 'Matches',
  reports: 'Reports',
  linked: 'Linked accounts',
}

// Linked accounts is identity data: only admins get the tab.
export const tabsFor = (isAdmin: boolean): PlayerTab[] =>
  PLAYER_TABS.filter((t) => t !== 'linked' || isAdmin)

// Chat from a chat item, Matches from a report or a forfeit, History otherwise.
export function openingTab(itemType: string | null): PlayerTab {
  if (itemType === 'flagged_chat') return 'chat'
  if (itemType === 'report' || itemType === 'forfeit_reconciliation')
    return 'matches'
  return 'history'
}

export const isPlayerTab = (value: unknown): value is PlayerTab =>
  (PLAYER_TABS as readonly unknown[]).includes(value)

type ItemRef = { id: number; itemType: string }

// The "Back to queue item" link, shown only when staff came from an item. The
// item's type names the link when it is one of this player's items.
export function backToQueueItem(
  itemId: number | null,
  items: readonly ItemRef[],
): { href: string; text: string } | null {
  if (itemId === null) return null
  const type = items.find((i) => i.id === itemId)?.itemType
  return {
    href: queueItemHref(itemId),
    text:
      type && isItemType(type)
        ? `Back to queue item: ${TYPE_LABELS[type]}`
        : 'Back to queue item',
  }
}

// The type of the item staff came from, if it is among the player's items.
export const sourceTypeOf = (
  itemId: number | null,
  items: readonly ItemRef[],
): string | null =>
  itemId === null ? null : (items.find((i) => i.id === itemId)?.itemType ?? null)
