// What an action does to an item's source row. Reports, conflicts and
// forfeit flags carry their own status, which follows the queue item; the
// other types' sources have none (the queue row alone is authoritative).
import type { ActionKey, ItemType } from './types.js'

export type SourceStatus = 'open' | 'resolved' | 'dismissed' | 'voided'

// The actions that close an open item.
export const CLOSING_ACTIONS: readonly ActionKey[] = [
	'dismiss',
	'resolve',
	'warn',
	'chat_mute',
	'queue_ban',
	'account_ban',
	'username_ban',
	'void',
	'overturn',
]

export function closes(action: ActionKey): boolean {
	return CLOSING_ACTIONS.includes(action)
}

// The status the source row takes, or null when it has none or keeps its own.
export function sourceStatusFor(itemType: ItemType, action: ActionKey): SourceStatus | null {
	if (itemType !== 'report' && itemType !== 'match_conflict' && itemType !== 'forfeit_reconciliation') return null
	if (action === 'reopen') return 'open'
	if (!closes(action)) return null
	if (itemType === 'forfeit_reconciliation') return action === 'void' ? 'voided' : 'dismissed'
	return 'resolved'
}
