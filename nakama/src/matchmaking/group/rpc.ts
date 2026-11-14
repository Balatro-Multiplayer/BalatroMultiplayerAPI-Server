// The group queue's RPCs. Both answer {groupQueue} (the lobby's group queue
// afterwards, null once there is none) or, refused, {refused: {code, userId?,
// message}}: a refusal is an answer, not an error, so the client can tell
// the player which member is in the way. Only a malformed call throws.
import { readConfig } from '../../config'
import type { GroupEndReason, GroupQueueView, LobbySignal } from '../../lobby/protocol'
import { currentLobby } from '../../lobby/rpc'
import { parsePayload, requireUser } from '../../rpc'
import { partyPresences, readBinding } from './binding'
import { memberFactsOf } from './hooks'
import {
	homeRefusal,
	memberRefusal,
	partyRefusal,
	refusalMessage,
	requestRefusal,
	type GroupHomeFacts,
	type GroupRefusal,
} from './refusal'
import { settingsOf } from '../../server_kind'

type RpcReply = { groupQueue: GroupQueueView | null } | { refused: GroupRefusal & { message: string } }

function refusedReply(refusal: GroupRefusal): string {
	const reply: RpcReply = { refused: { ...refusal, message: refusalMessage(refusal) } }
	return JSON.stringify(reply)
}

// The lobby's own reply to a group signal, as the RPC's.
function relayed(reply: string): string {
	const parsed = JSON.parse(reply)
	return parsed && parsed.refused ? refusedReply(parsed.refused) : reply
}

function signal(nk: nkruntime.Nakama, matchId: string, message: LobbySignal): string {
	return nk.matchSignal(matchId, JSON.stringify(message))
}

// {partyId, mode, teams?, kind?} -> RpcReply. The host of a private lobby,
// with every player connected and allowed to queue, opens its group queue
// on a party the host has just created (and is alone in, or with members
// only). The members are told (GROUP_QUEUE forming) to join the party; the
// host then adds the party's ticket.
export function rpcGroupQueueOpen(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	const userId = requireUser(ctx)
	const input = parsePayload(payload)
	const request = {
		partyId: typeof input.partyId === 'string' ? input.partyId : '',
		mode: typeof input.mode === 'string' ? input.mode : '',
		teams: input.teams === true,
		ranked: input.kind === 'ranked' || input.ranked === true,
	}
	const badRequest = requestRefusal(request)
	if (badRequest) return refusedReply(badRequest)
	const seat = currentLobby(nk, logger, userId)
	if (!seat) return refusedReply({ code: 'not_in_lobby' })
	const home = JSON.parse(signal(nk, seat.matchId, { type: 'group_members' })) as GroupHomeFacts
	const memberIds = home.members.map((m) => m.id)
	const refused =
		homeRefusal(home, userId, readConfig(nk)) ||
		(readBinding(nk, request.partyId) ? { code: 'party_in_use' as const } : null) ||
		partyRefusal(partyPresences(nk, request.partyId).map((p) => p.userId), memberIds, userId) ||
		memberRefusal(memberIds, memberFactsOf(nk, settingsOf(ctx), home.modId, memberIds, null, Date.now()))
	if (refused) {
		// The other players get no RPC reply: tell them who is in the way.
		if (refused.code === 'member_refused' && refused.userId && refused.reason) {
			const member = { userId: refused.userId, reason: refused.reason, mods: refused.mods || [] }
			signal(nk, seat.matchId, { type: 'group_open_refused', userId, partyId: request.partyId, refused: member })
		}
		return refusedReply(refused)
	}
	const reply = signal(nk, seat.matchId, {
		type: 'group_open',
		userId,
		partyId: request.partyId,
		mode: request.mode,
		teams: request.teams,
	})
	logger.info('Lobby %s opened a group queue for %s on party %s', seat.code, request.mode, request.partyId)
	return relayed(reply)
}

// {} -> RpcReply: any member ends their lobby's group queue while it is
// forming or queued.
export function rpcGroupQueueCancel(
	ctx: nkruntime.Context,
	logger: nkruntime.Logger,
	nk: nkruntime.Nakama,
	payload: string,
) {
	const userId = requireUser(ctx)
	const seat = currentLobby(nk, logger, userId)
	if (!seat) return refusedReply({ code: 'not_in_lobby' })
	const home = JSON.parse(signal(nk, seat.matchId, { type: 'group_members' })) as GroupHomeFacts
	if (!home.groupQueue) return JSON.stringify({ groupQueue: null })
	const reason: GroupEndReason = 'cancelled'
	return relayed(signal(nk, seat.matchId, { type: 'group_cancel', partyId: home.groupQueue.partyId, reason, userId }))
}
