// What the staff log knows: the closed list of staff actions, the one entry
// shape every writer fills in, and the one rule for a reason. Every ticket
// that adds a staff action adds its kind here and calls recordStaffAction.

export const STAFF_ACTIONS = [
	'warn',
	'note',
	'chat_ban',
	'queue_ban',
	'account_ban',
	'lift_ban',
	'lift_network_ban',
	'dismiss',
	'resolve',
	'void',
	'overturn',
	'reopen',
	'match_result',
	'match_void',
	'role_grant',
	'role_remove',
] as const
export type StaffAction = (typeof STAFF_ACTIONS)[number]

export const isStaffAction = (value: unknown): value is StaffAction =>
	typeof value === 'string' && (STAFF_ACTIONS as readonly string[]).includes(value)

export type LoggedRole = 'moderator' | 'admin'

// One staff action: who did it, to whom, on which queue item, and why.
export interface StaffActionEntry {
	staff: { playerId: string; role: LoggedRole }
	action: StaffAction
	reason: string
	// The player the action is about (a ban's target, a role's holder).
	targetPlayerId?: string | null
	// The service queue item it was taken on; a moderator reads entries that have one.
	itemId?: number | null
	// Extra facts, such as a ban's length or a role's name.
	detail?: unknown
}

export const MAX_REASON_LENGTH = 2000

export type ReasonCheck = { ok: true; reason: string } | { ok: false; message: string }

// A reason is a non-blank string of at most MAX_REASON_LENGTH characters.
export function parseReason(value: unknown): ReasonCheck {
	if (typeof value !== 'string' || !value.trim()) return { ok: false, message: 'reason is required' }
	const reason = value.trim()
	if (reason.length > MAX_REASON_LENGTH)
		return { ok: false, message: `reason is over ${MAX_REASON_LENGTH} characters` }
	return { ok: true, reason }
}
