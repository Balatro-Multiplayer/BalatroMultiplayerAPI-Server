// Why a private lobby may not queue as a group, as pure checks over facts the
// callers gather: the home lobby's own (GroupHomeFacts, from the lobby), its
// members' (from storage and the party's stream) and the server switches.
// Each check answers the first refusal it finds, or null.
import type { GroupPhase, GroupQueueView } from '../../lobby/protocol'
import { MODE_DISABLED_MESSAGE } from '../mode_switch'
import { queueRefusalMessage, refusedMods, type QueueRefusal, type QueueRefusalCode } from '../queue_refusal'
import { ticketQueryRefusal } from '../ticket_query'

// The largest group that may queue together. A group needs at least one
// stranger in its match (min_count = size + 1), and a Teams group a whole
// other team, so the bound keeps a group from asking the matchmaker for a
// game it will hardly ever fill.
export const MAX_GROUP_SIZE = 8
export const MIN_GROUP_SIZE = 2

export type GroupRefusalCode =
	// groupQueueEnabled is off.
	| 'disabled'
	| 'not_in_lobby'
	| 'not_host'
	// Only a private lobby queues as a group (a matchmade one already is a game).
	| 'not_private'
	| 'ranked'
	| 'in_game'
	| 'already_queued'
	| 'too_few'
	| 'too_many'
	// A member is disconnected: the whole lobby goes, or nobody does.
	| 'member_away'
	// A member may not queue at all (a ban, a switch, testing mode).
	| 'member_refused'
	// A member still holds a ticket of their own.
	| 'member_queued'
	| 'bad_request'
	// The party is already some lobby's group queue.
	| 'party_in_use'
	// The party holds someone who isn't a member of the lobby, or lacks the host.
	| 'party_mismatch'
	// A party ticket for a party no lobby opened a group queue with.
	| 'not_bound'
	| 'not_forming'
	// The group is playing the public game it was matched into.
	| 'group_away'
	| 'not_leader'
	// Only the lobby's members may join its group's party.
	| 'not_member'
	// The ticket's properties disagree with the group (mod, mode, size, teams).
	| 'ticket_mismatch'
	// The ticket's counts would let the group match only itself, or split it.
	| 'bad_counts'
	// The group's PvP mode is switched off (config.disabledPvpModes).
	| 'mode_disabled'

export interface GroupRefusal {
	code: GroupRefusalCode
	// The member it is about, when it's about one.
	userId?: string
	// A member refused: their refusal (matchmaking/queue_refusal.ts) as
	// they'd get it, its code, and the mods it names (mods_not_allowed).
	detail?: string
	reason?: QueueRefusalCode
	mods?: string[]
}

const MESSAGES: { [code in GroupRefusalCode]: string } = {
	disabled: 'Group matchmaking is currently disabled.',
	not_in_lobby: 'You are not in a lobby.',
	not_host: 'Only the host can queue the lobby.',
	not_private: 'Only a private lobby can queue as a group.',
	ranked: 'Groups can only queue casual matchmaking.',
	in_game: 'The lobby is in a game.',
	already_queued: 'The lobby is already queueing.',
	too_few: 'A group needs at least ' + MIN_GROUP_SIZE + ' players.',
	too_many: 'A group can have at most ' + MAX_GROUP_SIZE + ' players.',
	member_away: 'Every player must be connected.',
	member_refused: 'A player in the lobby may not queue.',
	member_queued: 'A player in the lobby is already queueing.',
	bad_request: 'Invalid group queue request.',
	party_in_use: 'That party is already queueing.',
	party_mismatch: "The party doesn't match the lobby.",
	not_bound: 'Queue as a group from your lobby.',
	not_forming: 'The group is not ready to queue.',
	group_away: 'The group is in a game.',
	not_leader: 'Only the host can queue the group.',
	not_member: 'Only players in the lobby can join its group.',
	ticket_mismatch: "The ticket doesn't match the group.",
	bad_counts: 'Invalid player counts for a group ticket.',
	mode_disabled: MODE_DISABLED_MESSAGE,
}

export function refusalMessage(refusal: GroupRefusal): string {
	const base = MESSAGES[refusal.code]
	return refusal.detail ? base + ' ' + refusal.detail : base
}

export interface GroupSwitches {
	groupQueueEnabled: boolean
}

export interface HomeMember {
	id: string
	present: boolean
}

// What the home lobby answers to group_members.
export interface GroupHomeFacts {
	code: string
	modId: string
	hostId: string
	isPrivate: boolean
	ranked: boolean
	started: boolean
	closed: boolean
	members: HomeMember[]
	groupQueue: GroupQueueView | null
}

export interface OpenRequest {
	partyId: string
	mode: string
	teams: boolean
	ranked: boolean
}

// What the members' own records say: each refused member's reason
// (queueRefusalFor), and who already holds a ticket of their own.
export interface MemberFacts {
	refusals: { [userId: string]: QueueRefusal }
	queuedIds: string[]
}

const NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/
// "<uuid>.<node>", as Nakama names a party.
const PARTY_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[A-Za-z0-9_.-]{1,64}$/

export function isPartyId(value: unknown): value is string {
	return typeof value === 'string' && PARTY_ID_PATTERN.test(value)
}

export function requestRefusal(request: OpenRequest): GroupRefusal | null {
	if (request.ranked) return { code: 'ranked' }
	if (!isPartyId(request.partyId) || !NAME_PATTERN.test(request.mode)) return { code: 'bad_request' }
	return null
}

// What the home lobby itself decides: checked by the RPC on its answer to
// group_members and again by the lobby when the open lands (it may have moved
// on in between).
export function homeRefusal(home: GroupHomeFacts, byId: string, switches: GroupSwitches): GroupRefusal | null {
	if (!switches.groupQueueEnabled) return { code: 'disabled' }
	if (home.closed || !home.members.some((m) => m.id === byId)) return { code: 'not_in_lobby' }
	if (home.hostId !== byId) return { code: 'not_host' }
	if (!home.isPrivate) return { code: 'not_private' }
	if (home.ranked) return { code: 'ranked' }
	if (home.started) return { code: 'in_game' }
	if (home.groupQueue) return { code: 'already_queued' }
	if (home.members.length < MIN_GROUP_SIZE) return { code: 'too_few' }
	if (home.members.length > MAX_GROUP_SIZE) return { code: 'too_many' }
	const away = home.members.filter((m) => !m.present)[0]
	if (away) return { code: 'member_away', userId: away.id }
	return null
}

export function memberRefused(userId: string, refusal: QueueRefusal): GroupRefusal {
	return {
		code: 'member_refused',
		userId,
		detail: queueRefusalMessage(refusal),
		reason: refusal.code,
		mods: refusedMods(refusal),
	}
}

// Whether every member may queue right now.
export function memberRefusal(memberIds: string[], facts: MemberFacts): GroupRefusal | null {
	for (const id of memberIds) {
		const refused = facts.refusals[id]
		if (refused) return memberRefused(id, refused)
	}
	for (const id of memberIds) {
		if (facts.queuedIds.indexOf(id) !== -1) return { code: 'member_queued', userId: id }
	}
	return null
}

// The party a group queue opens with: the host must be in it, and nobody
// who isn't a member.
export function partyRefusal(partyUserIds: string[], memberIds: string[], hostId: string): GroupRefusal | null {
	if (partyUserIds.indexOf(hostId) === -1) return { code: 'party_mismatch', userId: hostId }
	const stranger = partyUserIds.filter((id) => memberIds.indexOf(id) === -1)[0]
	if (stranger) return { code: 'party_mismatch', userId: stranger }
	return null
}

function sameMembers(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false
	return a.every((id) => b.indexOf(id) !== -1) && b.every((id) => a.indexOf(id) !== -1)
}

// PartyJoin: a bound party takes only the lobby's members, and only while
// the group is forming.
export function joinRefusal(status: GroupQueueView, joinerId: string): GroupRefusal | null {
	if (status.memberIds.indexOf(joinerId) === -1) return { code: 'not_member', userId: joinerId }
	if (status.phase !== 'forming') return { code: 'not_forming' }
	return null
}

// A party ticket (PartyMatchmakerAdd), with its properties as the client sent
// them: string properties name the queue, numeric ones the group.
export interface PartyTicket {
	minCount: number
	maxCount: number
	countMultiple: number | null
	stringProperties: { [key: string]: unknown }
	numericProperties: { [key: string]: unknown }
	query: unknown
}

// The ticket property naming a ticket's group size; every ticket of a group
// queue carries it, a solo ticket may (as 1).
export const GROUP_SIZE_PROPERTY = 'groupSize'
// Numeric 1 on every ticket for a Teams game, solo or group.
export const TEAMS_PROPERTY = 'teams'

// What the matchmaker may do with a group ticket: never match the group
// with only itself (min_count above its size), and for Teams fill two equal
// teams (count_multiple 2, at least a whole other team of strangers).
export function countRefusal(size: number, teams: boolean, ticket: PartyTicket): GroupRefusal | null {
	const { minCount, maxCount, countMultiple } = ticket
	if (!(minCount > size) || !(maxCount >= minCount)) return { code: 'bad_counts' }
	if (teams) {
		if (countMultiple !== 2 || minCount < 2 * size || minCount % 2 !== 0) return { code: 'bad_counts' }
	} else if (countMultiple !== null && countMultiple !== 1) {
		return { code: 'bad_counts' }
	}
	return null
}

// Whether the ticket asks for the group's queue: its mod and mode (in its
// query too), casual, its size, and Teams exactly when the group queued for
// Teams.
export function ticketPropsRefusal(status: GroupQueueView, ticket: PartyTicket): GroupRefusal | null {
	const s = ticket.stringProperties
	const n = ticket.numericProperties
	if (s.kind === 'ranked') return { code: 'ranked' }
	if (s.modId !== status.modId || s.mode !== status.mode || (s.kind !== undefined && s.kind !== 'casual'))
		return { code: 'ticket_mismatch' }
	if (ticketQueryRefusal(ticket.query, s)) return { code: 'ticket_mismatch' }
	if (n[GROUP_SIZE_PROPERTY] !== status.memberIds.length) return { code: 'ticket_mismatch' }
	const teams = n[TEAMS_PROPERTY]
	if (teams !== undefined && teams !== 0 && teams !== 1) return { code: 'ticket_mismatch' }
	if ((teams === 1) !== status.teams) return { code: 'ticket_mismatch' }
	return null
}

export interface TicketFacts {
	switches: GroupSwitches
	// The home lobby's answer to group_status: null when no lobby has the party.
	status: GroupQueueView | null
	leaderId: string
	// Who is in the party right now (its stream).
	partyUserIds: string[]
	members: MemberFacts
	ticket: PartyTicket
}

// PartyMatchmakerAdd: everything a group ticket must be.
export function ticketRefusal(facts: TicketFacts): GroupRefusal | null {
	const status = facts.status
	if (!status) return { code: 'not_bound' }
	if (!facts.switches.groupQueueEnabled) return { code: 'disabled' }
	if (status.phase !== 'forming') return { code: 'not_forming' }
	if (facts.leaderId !== status.hostId) return { code: 'not_leader' }
	if (!sameMembers(facts.partyUserIds, status.memberIds)) return { code: 'party_mismatch' }
	return (
		ticketPropsRefusal(status, facts.ticket) ||
		countRefusal(status.memberIds.length, status.teams, facts.ticket) ||
		memberRefusal(status.memberIds, facts.members)
	)
}

// Which phases a member's solo ticket is refused in: while the group gathers
// or queues. Away, the members are in a game anyway, and once it's over they
// may go their own ways.
export function blocksSoloQueue(phase: GroupPhase): boolean {
	return phase === 'forming' || phase === 'queued'
}
