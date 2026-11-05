// The one role table: which actions each item type takes, in which status,
// and the least role (per preset, where an action has presets) that may run
// them. The dispatcher checks it and the detail route sends its answer as
// allowedActions, so the buttons and the server check cannot drift.
import { WITHDRAWN_ACTION } from '../reports/report-page.service.js'
import { expiresAtOf } from './durations.js'
import {
	type ActionKey,
	BAN_DURATIONS,
	ITEM_TYPES,
	CHAT_MUTE_DURATIONS,
	type Duration,
	type ItemStatus,
	type ItemType,
	type StaffRole,
} from './types.js'

type StatusRule = 'open' | 'resolved' | 'any'

interface ActionRule {
	itemTypes: readonly ItemType[]
	status: StatusRule
	minRole: StaffRole
	// Per-preset least role; an action with presets is allowed when any one is.
	presets?: Readonly<Partial<Record<Duration, StaffRole>>>
	// Takes a target player (warn, mute, ban).
	targeted?: true
	// The web confirms before running it.
	destructive?: true
}

const ALL: readonly ItemType[] = [
	'report',
	'flagged_chat',
	'match_conflict',
	'forfeit_reconciliation',
	'contest',
	'anti_cheat',
	'integrity',
	'staff_report',
]

// Item types only admins see or act on, whatever an action's least role says.
export const ADMIN_ONLY_TYPES: readonly ItemType[] = ['staff_report']

export const ACTION_RULES: Readonly<Record<ActionKey, ActionRule>> = {
	dismiss: { itemTypes: ALL, status: 'open', minRole: 'moderator' },
	// A contest is settled by its outcome (dismiss, void, overturn, a punishment),
	// never by a bare resolve. Flagged chat is settled by a dismiss or a
	// punishment, which are the decisions that label its messages.
	resolve: {
		itemTypes: ALL.filter((t) => t !== 'contest' && t !== 'flagged_chat'),
		status: 'open',
		minRole: 'moderator',
	},
	warn: {
		itemTypes: ['report', 'flagged_chat', 'match_conflict', 'contest', 'anti_cheat', 'integrity'],
		status: 'open',
		minRole: 'moderator',
		targeted: true,
	},
	chat_mute: {
		itemTypes: ['report', 'flagged_chat', 'contest'],
		status: 'open',
		minRole: 'moderator',
		presets: {
			'24h': 'moderator',
			'7d': 'moderator',
			'30d': 'moderator',
			permanent: 'moderator',
		},
		targeted: true,
		destructive: true,
	},
	queue_ban: {
		itemTypes: ['report', 'match_conflict', 'contest', 'anti_cheat', 'integrity'],
		status: 'open',
		minRole: 'moderator',
		presets: {
			'24h': 'moderator',
			'7d': 'moderator',
			'30d': 'moderator',
			permanent: 'moderator',
		},
		targeted: true,
		destructive: true,
	},
	account_ban: {
		itemTypes: ['report', 'contest', 'anti_cheat', 'integrity'],
		status: 'open',
		minRole: 'admin',
		presets: { '7d': 'admin', '30d': 'admin', permanent: 'admin' },
		targeted: true,
		destructive: true,
	},
	// Always permanent, so it has no presets; a report of any reason may lead to it.
	username_ban: {
		itemTypes: ['report'],
		status: 'open',
		minRole: 'moderator',
		targeted: true,
		destructive: true,
	},
	void: {
		itemTypes: [
			'match_conflict',
			'forfeit_reconciliation',
			'contest',
			'anti_cheat',
			'staff_report',
		],
		status: 'open',
		minRole: 'moderator',
		destructive: true,
	},
	overturn: {
		itemTypes: ['match_conflict', 'contest'],
		status: 'open',
		minRole: 'moderator',
		destructive: true,
	},
	reopen: { itemTypes: ALL, status: 'resolved', minRole: 'moderator' },
	unban: { itemTypes: ALL, status: 'any', minRole: 'admin', destructive: true },
	note: { itemTypes: ALL, status: 'any', minRole: 'moderator' },
}

const ORDER: Readonly<Record<StaffRole, number>> = { moderator: 0, admin: 1 }

export function roleMeets(role: StaffRole, least: StaffRole): boolean {
	return ORDER[role] >= ORDER[least]
}

function statusMatches(rule: StatusRule, status: ItemStatus): boolean {
	return rule === 'any' || rule === status
}

// The player took the item back (a withdrawn report); staff cannot reopen it.
export function isWithdrawn(item: { resolutionAction?: string | null }): boolean {
	return item.resolutionAction === WITHDRAWN_ACTION
}

export type PermissionRefusal = 'not_for_type' | 'wrong_status' | 'forbidden'

// Whether role may run action (with preset, for one that has presets) on an
// item of this type and status; the refusal says which rule failed.
export function permissionFor(
	action: ActionKey,
	item: { itemType: ItemType; status: ItemStatus },
	role: StaffRole,
	preset?: Duration,
): { ok: true } | { ok: false; refusal: PermissionRefusal } {
	const rule = ACTION_RULES[action]
	if (!rule.itemTypes.includes(item.itemType)) return { ok: false, refusal: 'not_for_type' }
	if (!statusMatches(rule.status, item.status)) return { ok: false, refusal: 'wrong_status' }
	if (!roleMeets(role, rule.minRole)) return { ok: false, refusal: 'forbidden' }
	if (ADMIN_ONLY_TYPES.includes(item.itemType) && role !== 'admin') return { ok: false, refusal: 'forbidden' }
	if (rule.presets && preset !== undefined) {
		const least = rule.presets[preset]
		if (!least) return { ok: false, refusal: 'not_for_type' }
		if (!roleMeets(role, least)) return { ok: false, refusal: 'forbidden' }
	}
	return { ok: true }
}

export interface AllowedAction {
	action: ActionKey
	// The presets this role may pick, for an action that has them.
	presets?: Duration[]
	targeted: boolean
	destructive: boolean
}

function presetOrder(action: ActionKey): readonly Duration[] {
	return action === 'chat_mute' ? CHAT_MUTE_DURATIONS : BAN_DURATIONS
}

// The actions role may run on the item right now, presets narrowed to its role.
export function allowedActionsFor(
	item: { itemType: ItemType; status: ItemStatus; resolutionAction?: string | null },
	role: StaffRole,
): AllowedAction[] {
	const allowed: AllowedAction[] = []
	for (const action of Object.keys(ACTION_RULES) as ActionKey[]) {
		const rule = ACTION_RULES[action]
		if (!permissionFor(action, item, role).ok) continue
		if (isWithdrawn(item) && action !== 'note' && action !== 'unban') continue
		const entry: AllowedAction = { action, targeted: rule.targeted === true, destructive: rule.destructive === true }
		if (rule.presets) {
			const presets = presetOrder(action).filter((p) => {
				const least = rule.presets?.[p]
				return least !== undefined && roleMeets(role, least)
			})
			if (presets.length === 0) continue
			entry.presets = presets
		}
		allowed.push(entry)
	}
	return allowed
}

// The item types a role sees in the queue: those it may act on in some
// status, plus appeals, which the appeal route decides outside the action
// table. The staff log shows a moderator only entries on items of these types.
export function itemTypesVisibleTo(role: StaffRole): ItemType[] {
	return ITEM_TYPES.filter(
		(itemType) =>
			itemType === 'appeal' ||
			(['open', 'resolved'] as const).some((status) =>
				(Object.keys(ACTION_RULES) as ActionKey[]).some((action) =>
					permissionFor(action, { itemType, status }, role).ok,
				),
			),
	)
}

export type BanKind = 'chat' | 'queue' | 'account' | 'username'

// Lifting a punishment is for admins, of any kind.
export function mayLiftBan(role: StaffRole, _banType: BanKind): boolean {
	return role === 'admin'
}

// The queue action whose presets govern a ban of each kind.
const BAN_ACTION: Readonly<Record<BanKind, ActionKey>> = {
	chat: 'chat_mute',
	queue: 'queue_ban',
	account: 'account_ban',
	username: 'username_ban',
}

// A client computes expiresAt a moment before the request lands.
const DIRECT_BAN_SLACK_MS = 60 * 1000

// A ban issued outside the queue (the players page) held to the same table:
// the role must meet the ban's action, and a role below admin picks one of the
// presets the action offers it (a custom length is an admin's).
export function mayIssueBan(
	role: StaffRole,
	banType: BanKind,
	expiresAt: Date | null,
	now: Date,
): boolean {
	// A username ban is always permanent, whoever gives it.
	if (banType === 'username') return expiresAt === null && roleMeets(role, ACTION_RULES.username_ban.minRole)
	if (role === 'admin') return true
	const rule = ACTION_RULES[BAN_ACTION[banType]]
	if (!roleMeets(role, rule.minRole)) return false
	const presets = (Object.keys(rule.presets ?? {}) as Duration[]).filter(
		(p) => {
			const least = rule.presets?.[p]
			return least !== undefined && roleMeets(role, least)
		},
	)
	return presets.some((p) => {
		const end = expiresAtOf(p, now)
		if (expiresAt === null || end === null) return expiresAt === end
		return Math.abs(expiresAt.getTime() - end.getTime()) <= DIRECT_BAN_SLACK_MS
	})
}
