// A service queue item's type and status. Shared, as the gateways that read
// items need them too; the rest of the queue's vocabulary is in
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

export const ITEM_STATUSES = ['open', 'resolved'] as const
export type ItemStatus = (typeof ITEM_STATUSES)[number]
