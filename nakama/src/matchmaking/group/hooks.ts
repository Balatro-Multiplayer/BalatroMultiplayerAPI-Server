// The realtime hooks on a group queue's party. The party only carries the
// ticket; each hook asks the home lobby (binding.ts statusOf) whether what
// the party does fits its group, and tells it what happened. A party no
// lobby is queueing with may do anything but queue.
import { readConfig } from '../../config'
import { PERMISSION_DENIED, runtimeError } from '../../errors'
import type { GroupEndReason, LobbySignal } from '../../lobby/protocol'
import { pvpFloorRefusal, pvpVersionOutliers, queueRefusalFor } from '../gate'
import { PVP_MOD_ID, VERSION_MISMATCH } from '../../standing/pvp_version'
import { MODE_DISABLED, ticketModeDisabled } from '../mode_switch'
import { queueKey } from '../matched'
import { clearMatched, liveTicketHolders, writeGroupRecords } from '../queue'
import {
	markTicketRemoved,
	partyPresences,
	readBinding,
	signalHome,
	statusOf,
	takeTicketRemoved,
	dissolveParty,
} from './binding'
import {
	joinRefusal,
	memberRefused,
	refusalMessage,
	ticketRefusal,
	type GroupRefusal,
	type MemberFacts,
	type PartyTicket,
} from './refusal'
import { settingsOf, type ServerSettings } from '../../server_kind'

// A field of a realtime envelope: the runtime passes the protobuf's JSON
// names (camelCase); snake_case is accepted too.
function field(obj: unknown, camel: string, snake: string): any {
	if (!obj || typeof obj !== 'object') return undefined
	const o = obj as { [key: string]: unknown }
	return o[camel] !== undefined ? o[camel] : o[snake]
}

function partyIdOf(message: unknown): string {
	const id = field(message, 'partyId', 'party_id')
	return typeof id === 'string' ? id : ''
}

function refuse(refusal: GroupRefusal): nkruntime.Error {
	return runtimeError(PERMISSION_DENIED, refusalMessage(refusal))
}

// Whether each member may queue casual right now, and who holds a ticket of
// their own (exceptTicket being the group's own).
export function memberFactsOf(
	nk: nkruntime.Nakama,
	settings: ServerSettings,
	modId: string,
	memberIds: string[],
	exceptTicket: string | null,
	now: number,
): MemberFacts {
	const refusals: MemberFacts['refusals'] = {}
	for (const id of memberIds) {
		const refused = queueRefusalFor(nk, settings, id, false, now)
		if (refused) refusals[id] = refused
	}
	// A PvP group must run one PvP version, or the matched game would be refused.
	if (modId === PVP_MOD_ID) {
		// A member below the version the server referees never queues, even when all agree.
		for (const id of memberIds) {
			const tooOld = pvpFloorRefusal(nk, modId, id)
			if (tooOld && !refusals[id]) refusals[id] = tooOld
		}
		for (const id of pvpVersionOutliers(nk, memberIds)) {
			if (!refusals[id]) refusals[id] = { code: VERSION_MISMATCH }
		}
	}
	return { refusals, queuedIds: liveTicketHolders(nk, memberIds, exceptTicket) }
}

function numberOr(value: unknown, fallback: number | null): number | null {
	return typeof value === 'number' ? value : fallback
}

export function partyTicketOf(add: unknown): PartyTicket {
	return {
		minCount: numberOr(field(add, 'minCount', 'min_count'), 0) as number,
		maxCount: numberOr(field(add, 'maxCount', 'max_count'), 0) as number,
		countMultiple: numberOr(field(add, 'countMultiple', 'count_multiple'), null),
		stringProperties: field(add, 'stringProperties', 'string_properties') || {},
		numericProperties: field(add, 'numericProperties', 'numeric_properties') || {},
		query: field(add, 'query', 'query'),
	}
}

// registerRtBefore('PartyJoin'): a lobby's party takes only its members,
// while the group is forming, and only one who may queue casual.
export function beforePartyJoin(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	envelope: nkruntime.Envelope,
): nkruntime.Envelope {
	const partyId = partyIdOf(field(envelope, 'partyJoin', 'party_join'))
	if (!ctx.userId || !partyId || !readBinding(nk, partyId)) return envelope
	const found = statusOf(nk, partyId)
	if (!found) return envelope
	const refused = joinRefusal(found.status, ctx.userId)
	if (refused) throw refuse(refused)
	const queueRefused = queueRefusalFor(nk, settingsOf(ctx), ctx.userId, false, Date.now())
	if (queueRefused) throw refuse(memberRefused(ctx.userId, queueRefused))
	return envelope
}

// registerRtBefore('PartyMatchmakerAdd'): only a forming group's host may
// queue its party, for the group's casual queue, with every member allowed
// to and nobody else in the party (hooks run on the leader's message, so
// each member is checked here).
export function beforePartyMatchmakerAdd(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	envelope: nkruntime.Envelope,
): nkruntime.Envelope {
	if (!ctx.userId) return envelope
	const add = field(envelope, 'partyMatchmakerAdd', 'party_matchmaker_add')
	const partyId = partyIdOf(add)
	const found = partyId ? statusOf(nk, partyId) : null
	const memberIds = found ? found.status.memberIds : []
	const config = readConfig(nk, logger)
	const refused = ticketRefusal({
		switches: config,
		status: found ? found.status : null,
		leaderId: ctx.userId,
		partyUserIds: partyPresences(nk, partyId).map((p) => p.userId),
		members: memberFactsOf(nk, settingsOf(ctx), found ? found.status.modId : '', memberIds, null, Date.now()),
		ticket: partyTicketOf(add),
	})
	// Groups queue casual only; the ticket was just checked against the group's mode.
	if (refused) {
		logger.info('Group ticket for party %s refused: %s', partyId, refused.code)
		throw refuse(refused)
	}
	if (found && ticketModeDisabled(config.disabledPvpModes, found.status.modId, found.status.mode, false)) {
		logger.info('Group ticket for party %s refused: %s', partyId, MODE_DISABLED)
		throw runtimeError(PERMISSION_DENIED, MODE_DISABLED)
	}
	return envelope
}

// registerRtAfter('PartyMatchmakerAdd'): the ticket is out, so the lobby's
// group is queued and its members count as queued. After hooks run once the
// client already has its ticket, so the host may have taken it back already.
export function afterPartyMatchmakerAdd(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	output: nkruntime.Envelope | null,
	input: nkruntime.Envelope,
) {
	const result = field(output, 'partyMatchmakerTicket', 'party_matchmaker_ticket')
	const partyId = partyIdOf(result)
	const ticket = field(result, 'ticket', 'ticket')
	if (!partyId || typeof ticket !== 'string') return
	if (takeTicketRemoved(nk, ticket)) return
	const binding = readBinding(nk, partyId)
	if (!binding) return
	const reply = signalHome(nk, binding.homeCode, { type: 'group_queued', partyId, ticket })
	const queued = reply ? JSON.parse(reply) : null
	if (!queued || queued.refused) {
		// The group moved on (cancelled) while the ticket was being added.
		logger.warn('Party %s ticket %s has no forming group; breaking it up', partyId, ticket)
		dissolveParty(nk, partyId)
		return
	}
	const props = partyTicketOf(field(input, 'partyMatchmakerAdd', 'party_matchmaker_add')).stringProperties
	writeGroupRecords(
		nk,
		{ modId: binding.modId, gameMode: queueKey(String(props.mode), 'casual'), ticket, at: Date.now() },
		partyPresences(nk, partyId).map((p) => ({ userId: p.userId, sessionId: p.sessionId })),
	)
}

// registerRtBefore('PartyMatchmakerRemove'): the host took the ticket back;
// the group is forming again.
export function beforePartyMatchmakerRemove(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	envelope: nkruntime.Envelope,
): nkruntime.Envelope {
	const remove = field(envelope, 'partyMatchmakerRemove', 'party_matchmaker_remove')
	const partyId = partyIdOf(remove)
	const ticket = field(remove, 'ticket', 'ticket')
	if (!partyId || typeof ticket !== 'string') return envelope
	const found = statusOf(nk, partyId)
	if (!found) return envelope
	if (found.status.phase !== 'queued' || found.status.ticket !== ticket) {
		markTicketRemoved(nk, ticket)
		return envelope
	}
	clearMatched(nk, found.binding.modId, queueKey(found.status.mode, 'casual'), found.status.memberIds)
	signalHome(nk, found.binding.homeCode, { type: 'group_unqueued', partyId })
	return envelope
}

// A member out of the party, by leaving or the leader removing them or
// closing it, ends a forming or queued group queue.
function cancelFor(nk: nkruntime.Nakama, partyId: string, userId: string | undefined, reason: GroupEndReason) {
	const binding = partyId ? readBinding(nk, partyId) : null
	if (!binding) return
	const signal: LobbySignal = { type: 'group_cancel', partyId, reason, userId }
	signalHome(nk, binding.homeCode, signal)
}

// registerRtBefore('PartyLeave').
export function beforePartyLeave(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	envelope: nkruntime.Envelope,
): nkruntime.Envelope {
	cancelFor(nk, partyIdOf(field(envelope, 'partyLeave', 'party_leave')), ctx.userId, 'member_left_party')
	return envelope
}

// registerRtBefore('PartyRemove'): the leader removing a member.
export function beforePartyRemove(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	envelope: nkruntime.Envelope,
): nkruntime.Envelope {
	cancelFor(nk, partyIdOf(field(envelope, 'partyRemove', 'party_remove')), ctx.userId, 'member_left_party')
	return envelope
}

// registerRtBefore('PartyClose').
export function beforePartyClose(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	envelope: nkruntime.Envelope,
): nkruntime.Envelope {
	cancelFor(nk, partyIdOf(field(envelope, 'partyClose', 'party_close')), ctx.userId, 'member_left_party')
	return envelope
}
