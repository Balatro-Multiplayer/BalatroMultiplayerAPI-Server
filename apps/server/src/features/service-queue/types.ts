// The moderator service queue's vocabulary: item types, staff roles, the
// actions a moderator can take and their presets. Closed unions throughout;
// every parser that turns a request value into one of these lives here.

import { ITEM_STATUSES, ITEM_TYPES, type ItemStatus, type ItemType } from '../../shared/service-queue/items.js'

// Items are shared with the gateways (shared/service-queue/items.ts).
export { ITEM_STATUSES, ITEM_TYPES, type ItemStatus, type ItemType }

export type StaffRole = 'moderator' | 'admin'

export const ACTION_KEYS = [
	'dismiss',
	'resolve',
	'warn',
	'chat_mute',
	'queue_ban',
	'account_ban',
	'void',
	'overturn',
	'reopen',
	'unban',
	'note',
] as const
export type ActionKey = (typeof ACTION_KEYS)[number]

export const CHAT_MUTE_DURATIONS = ['24h', '7d', '30d', 'permanent'] as const
export type ChatMuteDuration = (typeof CHAT_MUTE_DURATIONS)[number]

export const BAN_DURATIONS = ['24h', '7d', '30d', 'permanent'] as const
export type BanDuration = (typeof BAN_DURATIONS)[number]

export type Duration = ChatMuteDuration | BanDuration

// What kind of game an item came from (Nakama review/ranked.ts LobbyKind);
// 'none' for an item about no game (an integrity failure outside ranked).
export type LobbyKind = 'ranked' | 'casual' | 'private' | 'none'

// Why an integrity item was raised (integrity-flag.ts).
export type IntegrityTrigger = 'ranked' | 'repeated'

// What an item was raised with, kept on the row for later rescoring.
export interface ItemContext {
	lobbyKind?: LobbyKind
	integrityTrigger?: IntegrityTrigger
	// A contest item: who contested, and whom (null when no one was named).
	contest?: ContestParties
	// A flagged chat item: the flagged messages it holds (flagged_messages ids).
	flaggedMessageIds?: number[]
	// A staff report item: the match, who reported it and why.
	staffReport?: StaffReportContext
}

export interface StaffReportContext {
	runId: string
	reporterId: string
	note: string
}

export interface ContestParties {
	contesterId: string
	againstId: string | null
}

export type ItemEventKind = 'viewed' | 'claimed' | 'released' | 'acted' | 'noted' | 'reopened'

// Who a target-taking action (warn, mute, ban) can be aimed at, per type.
export type TargetRole = 'subject' | 'reporter' | 'first_reporter' | 'conflicting_reporter' | 'contester'

const includes = <T extends string>(list: readonly T[], value: unknown): value is T =>
	typeof value === 'string' && (list as readonly string[]).includes(value)

export const isItemType = (value: unknown): value is ItemType => includes(ITEM_TYPES, value)
export const isItemStatus = (value: unknown): value is ItemStatus => includes(ITEM_STATUSES, value)
export const isActionKey = (value: unknown): value is ActionKey => includes(ACTION_KEYS, value)
export const isChatMuteDuration = (value: unknown): value is ChatMuteDuration => includes(CHAT_MUTE_DURATIONS, value)
export const isBanDuration = (value: unknown): value is BanDuration => includes(BAN_DURATIONS, value)

const LOBBY_KINDS: readonly LobbyKind[] = ['ranked', 'casual', 'private', 'none']
export const isLobbyKind = (value: unknown): value is LobbyKind => includes(LOBBY_KINDS, value)

export function roleOf(privileges: readonly string[]): StaffRole | null {
	if (privileges.includes('admin')) return 'admin'
	if (privileges.includes('moderator')) return 'moderator'
	return null
}

// The 'role:playerId' actor string resolvedBy/issuedBy/claimedBy carry.
export function actorOf(role: StaffRole, playerId: string): string {
	return `${role}:${playerId}`
}

export function playerIdOfActor(actor: string | null): string | null {
	if (!actor) return null
	const at = actor.indexOf(':')
	return at === -1 ? null : actor.slice(at + 1)
}

export function contextOf(value: unknown): ItemContext {
	if (typeof value !== 'object' || value === null) return {}
	const record = value as {
		lobbyKind?: unknown
		integrityTrigger?: unknown
		contest?: unknown
		flaggedMessageIds?: unknown
		staffReport?: unknown
	}
	return {
		...(isLobbyKind(record.lobbyKind) ? { lobbyKind: record.lobbyKind } : {}),
		...(record.integrityTrigger === 'ranked' || record.integrityTrigger === 'repeated'
			? { integrityTrigger: record.integrityTrigger }
			: {}),
		...contestOf(record.contest),
		...staffReportOf(record.staffReport),
		...(Array.isArray(record.flaggedMessageIds) && record.flaggedMessageIds.every((id) => Number.isInteger(id))
			? { flaggedMessageIds: record.flaggedMessageIds as number[] }
			: {}),
	}
}

function staffReportOf(value: unknown): { staffReport?: StaffReportContext } {
	if (typeof value !== 'object' || value === null) return {}
	const { runId, reporterId, note } = value as { runId?: unknown; reporterId?: unknown; note?: unknown }
	if (typeof runId !== 'string' || typeof reporterId !== 'string' || typeof note !== 'string') return {}
	return { staffReport: { runId, reporterId, note } }
}

function contestOf(value: unknown): { contest?: ContestParties } {
	if (typeof value !== 'object' || value === null) return {}
	const { contesterId, againstId } = value as { contesterId?: unknown; againstId?: unknown }
	if (typeof contesterId !== 'string') return {}
	if (typeof againstId !== 'string' && againstId !== null) return {}
	return { contest: { contesterId, againstId } }
}
