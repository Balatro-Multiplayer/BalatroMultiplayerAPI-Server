// ClientOp.REQUEST: a client asks for a change to match state and the server
// answers it exactly once (docs/pvp-match.md, Wire). Pure, like state.ts.
//
// Each request type has a reducer in a table (PVP_REQUESTS, pvp/register.ts);
// the reducer decides, this module does the bookkeeping: the once-only dedupe
// by reqId, the revision, and the ANSWER / STATE messages.
import type { StepContext } from '../actions/registry'
import { settle } from '../actions/results'
import {
	announceChange,
	announceDrift,
	matchKeys,
	maskedIn,
	matchStateOf,
	registerMatchKey,
	revOf,
} from './match_state'
import type { Reducer, Reduction } from './request_types'
export type { Reducer, Reduction }
import { type AnswerMessage, ServerOp, type StateMessage } from './protocol'
import { withLiveDeadline } from './pvp/deadline'
import { PVP_REQUESTS } from './pvp/register'
import { refereeOf } from './pvp/state'
import { withLiveClocks } from './pvp/view'
import { BURST, MAX_CID_LENGTH, spend } from './relay'
import {
	type AnsweredEntry,
	type Lobby,
	type Outbound,
	type Step,
	findPlayer,
} from './state'

export const SNAPSHOT_TYPE = 'snapshot'
// How many terminal answers a seat keeps for dedupe: at least the rate limit's
// burst, so a full burst resent after a reconnect is never applied twice.
export const ANSWERED_LIMIT = BURST
// Refusals that depend on when the request arrives, not on what it asks: a
// resend may succeed, so they are never stored.
const TRANSIENT_REASONS = ['rate_limited', 'no_seat']

// The reducer each request type runs: the PvP table, and whatever a test adds.
const reducers: { [type: string]: Reducer } = { ...PVP_REQUESTS }

// Test seam: add a request type and the match keys it owns.
export function registerReducer(type: string, reducer: Reducer): void {
	reducers[type] = reducer
	for (const key of Object.keys(reducer.keys))
		registerMatchKey(key, reducer.keys[key])
}

function stateOut(msg: StateMessage, to: string[]): Outbound {
	return { kind: 'send', op: ServerOp.STATE, payload: msg, to }
}

function answerOut(answer: AnswerMessage, to: string): Outbound {
	return { kind: 'send', op: ServerOp.ANSWER, payload: answer, to: [to] }
}

function withAnswered(
	lobby: Lobby,
	userId: string,
	entry: AnsweredEntry,
): Lobby {
	const kept = (lobby.answered?.[userId] ?? [])
		.concat([entry])
		.slice(-ANSWERED_LIMIT)
	return { ...lobby, answered: { ...(lobby.answered || {}), [userId]: kept } }
}

export interface RequestResult {
	lobby: Lobby
	// Null when the message had no usable reqId: nothing to answer.
	answer: AnswerMessage | null
	// STATE messages, to go out before the answer.
	pushes: Outbound[]
	// A reducer applied and changed match state (the caller runs settle).
	changed: boolean
	// Set on a refusal, for the caller's log.
	refused?: { type: string; reason: string }
}

function refusal(
	lobby: Lobby,
	reqId: string,
	type: string,
	reason: string,
	store: boolean,
	senderId: string,
	key?: string,
): RequestResult {
	const answer: AnswerMessage = {
		reqId,
		ok: false,
		reason,
		...(key === undefined ? {} : { key }),
	}
	const next = store ? withAnswered(lobby, senderId, { reqId, answer }) : lobby
	return {
		lobby: next,
		answer,
		pushes: [],
		changed: false,
		refused: { type, reason },
	}
}

// `msg` is the decoded message body as sent: {v, reqId, type, payload}.
export function handleRequest(
	lobby: Lobby,
	senderId: string,
	msg: { [key: string]: unknown },
	ctx: StepContext,
): RequestResult {
	const reqId = msg.reqId
	const fullType = typeof msg.type === 'string' ? msg.type : ''
	// The copy that reaches the refusal and the log is capped like the reqId;
	// the reducer is looked up by the full name.
	const type = fullType.slice(0, MAX_CID_LENGTH)
	if (
		typeof reqId !== 'string' ||
		reqId === '' ||
		reqId.length > MAX_CID_LENGTH
	)
		return {
			lobby,
			answer: null,
			pushes: [],
			changed: false,
			refused: { type, reason: 'no_req_id' },
		}

	// Nothing is kept for a sender with no seat: there is no seat to drop it with.
	if (!findPlayer(lobby, senderId))
		return refusal(lobby, reqId, type, 'no_seat', false, senderId)

	const budgeted = spend(lobby, senderId, 'request', ctx.now)
	if (!budgeted)
		return refusal(lobby, reqId, type, 'rate_limited', false, senderId)

	// A snapshot is never stored: a resend gets a fresh full STATE, with the live
	// remaining time of a running deadline, as a join's SNAPSHOT has.
	if (fullType === SNAPSHOT_TYPE) {
		const full: StateMessage = {
			rev: revOf(budgeted),
			full: true,
			changed: withLiveClocks(
				withLiveDeadline(
					matchStateOf(
						budgeted,
						matchKeys(),
						maskedIn(budgeted, senderId),
						senderId,
					),
					refereeOf(budgeted)?.facts.deadline,
					ctx.now,
				),
				refereeOf(budgeted),
				ctx.now,
			),
		}
		return {
			lobby: budgeted,
			answer: { reqId, ok: true, rev: revOf(budgeted) },
			pushes: [stateOut(full, [senderId])],
			changed: false,
		}
	}

	const stored = (budgeted.answered?.[senderId] ?? []).find(
		(e) => e.reqId === reqId,
	)
	if (stored)
		return {
			lobby: budgeted,
			answer: stored.answer,
			pushes: [],
			changed: false,
		}

	if (fullType === '')
		return refusal(budgeted, reqId, type, 'bad_payload', true, senderId)
	const reducer = Object.prototype.hasOwnProperty.call(reducers, fullType)
		? reducers[fullType]
		: undefined
	if (!reducer)
		return refusal(budgeted, reqId, type, 'unknown_type', true, senderId)

	// Lua JSON encoders send an empty object as [].
	const raw = msg.payload
	const payload = Array.isArray(raw) && raw.length === 0 ? {} : raw
	const result = reducer.reduce(budgeted, senderId, payload, ctx)
	if (!result.ok)
		return refusal(
			budgeted,
			reqId,
			type,
			result.reason,
			TRANSIENT_REASONS.indexOf(result.reason) === -1,
			senderId,
			result.key,
		)

	const announced = announceChange(result.lobby, result.changed, lobby)
	const recorded = result.refusal
	const answer: AnswerMessage = recorded
		? {
				reqId,
				ok: false,
				reason: recorded.reason,
				...(result.changed.length > 0 ? { rev: revOf(announced.lobby) } : {}),
			}
		: { reqId, ok: true, rev: revOf(announced.lobby) }
	return {
		lobby: withAnswered(announced.lobby, senderId, { reqId, answer }),
		answer,
		pushes: announced.out,
		changed: result.changed.length > 0,
		...(recorded
			? {
					refused: {
						type,
						reason:
							recorded.detail === undefined
								? recorded.reason
								: `${recorded.reason}: ${recorded.detail}`,
					},
				}
			: {}),
	}
}

// handleRequest as a match step: the pushes then the answer out, and settle
// once a request changed the match.
export function requestStep(
	lobby: Lobby,
	senderId: string,
	msg: { [key: string]: unknown },
	ctx: StepContext,
): Step & { refused?: { key: string; reason: string } } {
	const result = handleRequest(lobby, senderId, msg, ctx)
	const out: Outbound[] = [...result.pushes]
	if (result.answer) out.push(answerOut(result.answer, senderId))
	let next = result.lobby
	if (result.changed) {
		// A settle that ends the game moves match state after the request's own
		// announcement: announce that drift too.
		const settled = announceDrift(next, settle(next, ctx.now))
		next = settled.lobby
		out.push(...settled.out)
	}
	return {
		lobby: next,
		out,
		...(result.refused
			? {
					refused: {
						key: `request:${result.refused.type}`,
						reason: result.refused.reason,
					},
				}
			: {}),
	}
}
