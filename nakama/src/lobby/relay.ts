// ClientOp.ACTION: relays an action between players, or runs it when it is
// authoritative (src/actions/registry.ts). Pure, like state.ts.
//
// The server stamps `from` with the sender rather than trusting the payload's,
// so a player can't pose as another, and only the server can send an
// authoritative action's result. A match-deciding action from a sender its
// rule doesn't allow (sender_guard.ts) is dropped, and the step says so.
import {
	type ActionContext,
	LOG_EVENTS_KEY,
	LOG_EVENT_KEY,
	authoritativeAction,
} from '../actions/registry'
import { settle } from '../actions/results'
import {
	type ActionEnvelope,
	type ActionRejection,
	BROADCAST_TARGET,
	SERVER_TARGET,
	type LobbyEventMessage,
	ServerOp,
	type SpectateEvent,
} from './protocol'
import { type SenderRefusal, senderRefusal } from './sender_guard'
import { sharedRulesAction } from './shared_rules'
import { almanacAction } from './almanac'
import { spectateEvent } from './spectate'
import {
	type Lobby,
	type Outbound,
	type Step,
	findPlayer,
	logBudgetKey,
} from './state'

export const ACTION_KEY_PATTERN = /^[a-z0-9_]{1,64}$/
export const MAX_PARAMS_BYTES = 16 * 1024
export const MAX_CID_LENGTH = 64
// Token bucket per sender: RATE_PER_SECOND refill, BURST capacity. Generous:
// a mod's own actions can come in bursts after a scored hand.
export const RATE_PER_SECOND = 40
export const BURST = 100
// mpapi_log_event has a bucket of its own, so a busy replay stream (dozens
// of events after a scored hand) never starves a player's other actions.
// A batch of events (mpapi_log_events) spends one token per event, so batching
// does not make the stream cheaper. The burst holds a whole backlog flushed
// after a drop (the player's log cap, MAX_LOG_EVENTS, bounds what is kept).
export const LOG_RATE_PER_SECOND = 20
export const LOG_BURST = 1024

function reject(to: string, rejection: ActionRejection): Outbound {
	return {
		kind: 'send',
		op: ServerOp.ACTION_REJECTED,
		payload: rejection,
		to: [to],
	}
}

// Spends `cost` tokens (one per replay event) from the bucket for this action;
// null when it holds fewer.
function spend(
	lobby: Lobby,
	userId: string,
	key: string,
	now: number,
	cost = 1,
): Lobby | null {
	const isLog = isLogAction(key)
	const budgetKey = isLog ? logBudgetKey(userId) : userId
	const burst = isLog ? LOG_BURST : BURST
	const rate = isLog ? LOG_RATE_PER_SECOND : RATE_PER_SECOND
	const bucket = lobby.actionBudget[budgetKey] || { tokens: burst, at: now }
	const refilled = Math.min(
		burst,
		bucket.tokens + ((now - bucket.at) / 1000) * rate,
	)
	if (refilled < cost) return null
	return {
		...lobby,
		actionBudget: {
			...lobby.actionBudget,
			[budgetKey]: { tokens: refilled - cost, at: now },
		},
	}
}

// Tokens an action costs: one, or one per event in a batch of replay events.
function spendCost(key: string, params: unknown): number {
	if (key !== LOG_EVENTS_KEY) return 1
	const events = (params as { events?: unknown } | null)?.events
	return Array.isArray(events) ? Math.max(1, events.length) : 1
}

function isLogAction(key: string): boolean {
	return key === LOG_EVENT_KEY || key === LOG_EVENTS_KEY
}

function isAck(params: unknown): boolean {
	return typeof params === 'object' && params !== null && (params as { ack?: unknown }).ack === true
}

function stringField(data: { [key: string]: unknown }, key: string): string {
	const value = data[key]
	return typeof value === 'string' ? value : ''
}

// A relay step; `dropped` when the action was refused by its sender rule, so
// the caller can log (and later record) it.
export interface RelayStep extends Step {
	dropped?: SenderRefusal
	// Set when the action was refused, so the caller can log it with the
	// match and the sender. The sender hears the reason unless it has no seat.
	refused?: { key: string; reason: string }
}

// An action from a player marked away proves their socket is back (a short
// drop that the grace period covered). It is relayed, and the player is marked
// back, so the others do not miss moves played while the seat looked empty.
export function action(
	lobby: Lobby,
	senderId: string,
	data: { [key: string]: unknown },
	ctx: Omit<ActionContext, 'from'>,
): RelayStep {
	const sender = findPlayer(lobby, senderId)
	if (!sender || sender.awaySince === null) return relayAction(lobby, senderId, data, ctx)
	const back: Lobby = {
		...lobby,
		players: lobby.players.map((p) => (p.id === senderId ? { ...p, awaySince: null } : p)),
	}
	const payload: LobbyEventMessage = {
		type: 'player_reconnected',
		lobbyCode: lobby.code,
		playerId: senderId,
		displayName: sender.info.displayName,
	}
	const announce: Outbound = {
		kind: 'send',
		op: ServerOp.EVENT,
		payload,
		to: back.players.map((p) => p.id).filter((id) => id !== senderId),
	}
	const step = relayAction(back, senderId, data, ctx)
	return { ...step, out: [announce, ...step.out] }
}

function relayAction(
	lobby: Lobby,
	senderId: string,
	data: { [key: string]: unknown },
	ctx: Omit<ActionContext, 'from'>,
): RelayStep {
	const cid = stringField(data, 'cid').slice(0, MAX_CID_LENGTH)
	const key = stringField(data, 'action')
	const to = stringField(data, 'to')
	const refuse = (reason: string): RelayStep => ({
		lobby,
		out: [reject(senderId, { cid, action: key, reason })],
		refused: { key, reason },
	})

	// No seat, no reply: the sender is not a player here. The caller still logs it.
	if (!findPlayer(lobby, senderId)) return { lobby, out: [], refused: { key, reason: 'no_seat' } }
	if (!ACTION_KEY_PATTERN.test(key)) return refuse('bad_action')
	const params = data.params === undefined ? null : data.params
	if (JSON.stringify(params).length > MAX_PARAMS_BYTES)
		return refuse('too_large')

	const budgeted = spend(lobby, senderId, key, ctx.now, spendCost(key, params))
	if (!budgeted) return refuse('rate_limited')

	const almanac = almanacAction(budgeted, senderId, key, params)
	if (almanac) return almanac

	const sharedRules = sharedRulesAction(
		budgeted,
		senderId,
		key,
		params,
		ctx.now,
	)
	if (sharedRules) return sharedRules

	const authoritative = authoritativeAction(key)
	if (to === SERVER_TARGET) {
		if (!authoritative) return refuse('not_authoritative')
		const result = authoritative.reduce(
			budgeted,
			{ ...ctx, from: senderId },
			params,
		)
		if ('reject' in result) return refuse(result.reject)
		const next = { ...budgeted, game: result.game }
		const out: Outbound[] = []
		const audience = result.to || 'all'
		if (audience !== 'none') {
			// The request's cid, so the sender's pending callback resolves.
			const envelope: ActionEnvelope = {
				cid,
				action: key,
				from: SERVER_TARGET,
				to: BROADCAST_TARGET,
				params: result.params,
			}
			out.push({
				kind: 'send',
				op: ServerOp.ACTION,
				payload: envelope,
				to: next.players
					.map((p) => p.id)
					.filter((id) => audience === 'all' || id !== senderId),
			})
		}
		// A log action is answered to nobody by default. With `ack: true` the sender
		// gets a small reply, so a client that is about to leave knows the batch was
		// handled first (a leave signal runs before the next tick's match data).
		if (isLogAction(key) && isAck(params))
			out.push({
				kind: 'send',
				op: ServerOp.ACTION,
				payload: { cid, action: key, from: SERVER_TARGET, to: BROADCAST_TARGET, params: { ack: true } },
				to: [senderId],
			})
		if (result.out) out.push(...result.out)
		if (key === LOG_EVENT_KEY && audience !== 'none' && result.params)
			out.push(...spectateEvent(next, result.params as SpectateEvent))
		if (key === LOG_EVENTS_KEY && result.spectate)
			for (const event of result.spectate) out.push(...spectateEvent(next, event))
		// A report may have been the last one the game was waiting for.
		const settled = settle(next, ctx.now)
		return { lobby: settled.lobby, out: out.concat(settled.out) }
	}
	// Only the server may send an authoritative action's result.
	if (authoritative) return refuse('authoritative_only')

	// Not relayed to anyone; only the sender hears why.
	const dropped = senderRefusal(budgeted, senderId, key, params)
	if (dropped)
		return {
			lobby: budgeted,
			out: [reject(senderId, { cid, action: key, reason: dropped.kind })],
			dropped,
		}

	let targets: string[]
	if (to === BROADCAST_TARGET) {
		targets = budgeted.players.map((p) => p.id)
	} else if (findPlayer(budgeted, to)) {
		targets = [to]
	} else {
		return refuse('unknown_target')
	}

	const envelope: ActionEnvelope = {
		cid,
		action: key,
		from: senderId,
		to,
		params,
	}
	const responseTo = stringField(data, 'responseTo')
	if (responseTo) envelope.responseTo = responseTo.slice(0, MAX_CID_LENGTH)
	return {
		lobby: budgeted,
		out: [{ kind: 'send', op: ServerOp.ACTION, payload: envelope, to: targets }],
	}
}
