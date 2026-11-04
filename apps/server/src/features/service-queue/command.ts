// A request body as the action it asks for, or why it is not one. Every
// action but a note needs a reason (it goes in the staff log) and takes an
// optional note; the rest of each body is per action.
import {
	type ActionKey,
	type BanDuration,
	type ChatMuteDuration,
	isBanDuration,
	isChatMuteDuration,
} from './types.js'
import { type DismissLabel, dismissLabelOf, isDismissLabel } from './flagged-chat.js'
import { parseReason } from '../../shared/staff-log/actions.js'

export const MAX_NOTE_LENGTH = 2000
export const MAX_WARNING_LENGTH = 500

export type QueueCommand =
	// dismissLabel: which dismiss button a flagged chat item was closed with.
	| { action: 'dismiss'; reason: string; note: string | null; dismissLabel: DismissLabel | null }
	| { action: 'resolve'; reason: string; note: string | null }
	| { action: 'warn'; reason: string; targetPlayerId: string | null; message: string; note: string | null }
	| { action: 'chat_mute'; targetPlayerId: string | null; duration: ChatMuteDuration; reason: string; note: string | null }
	| { action: 'queue_ban'; targetPlayerId: string | null; duration: BanDuration; reason: string; note: string | null }
	| { action: 'account_ban'; targetPlayerId: string | null; duration: BanDuration; reason: string; note: string | null }
	| { action: 'void'; reason: string; note: string | null }
	| { action: 'overturn'; reason: string; toReportOf: string; note: string | null }
	| { action: 'reopen'; reason: string; note: string | null }
	| { action: 'unban'; reason: string; banId: string; note: string | null }
	| { action: 'note'; note: string }

export type SanctionCommand = Extract<QueueCommand, { action: 'chat_mute' | 'queue_ban' | 'account_ban' }>

export interface BodyRefusal {
	field: string
	message: string
}

type Parsed<T> = { ok: true; value: T } | { ok: false; refusal: BodyRefusal }

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value })
const bad = (field: string, message: string): Parsed<never> => ({ ok: false, refusal: { field, message } })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function optionalText(body: Record<string, unknown>, field: string, max: number): Parsed<string | null> {
	const value = body[field]
	if (value === undefined || value === null || value === '') return ok(null)
	if (typeof value !== 'string') return bad(field, `${field} must be a string`)
	if (value.length > max) return bad(field, `${field} is over ${max} characters`)
	return ok(value.trim() || null)
}

function target(body: Record<string, unknown>): Parsed<string | null> {
	const value = body.targetPlayerId
	if (value === undefined || value === null || value === '') return ok(null)
	if (typeof value !== 'string' || !value) return bad('targetPlayerId', 'targetPlayerId must be a player id')
	return ok(value)
}

// The old routes' resolutionNotes is accepted as the note.
function noteOf(body: Record<string, unknown>): Parsed<string | null> {
	const note = optionalText(body, 'note', MAX_NOTE_LENGTH)
	if (!note.ok || note.value !== null) return note
	return optionalText(body, 'resolutionNotes', MAX_NOTE_LENGTH)
}

export function parseCommand(action: ActionKey, body: Record<string, unknown>): Parsed<QueueCommand> {
	const note = noteOf(body)
	if (!note.ok) return note
	if (action === 'note') {
		if (note.value === null) return bad('note', 'note is required')
		return ok({ action, note: note.value })
	}
	const why = parseReason(body.reason)
	if (!why.ok) return bad('reason', why.message)
	const reason = why.reason
	switch (action) {
		case 'dismiss': {
			const label = body.dismissLabel
			if (label !== undefined && label !== null && !isDismissLabel(label))
				return bad('dismissLabel', "dismissLabel must be 'not_harmful' or 'harmful_no_action'")
			return ok({ action, reason, note: note.value, dismissLabel: dismissLabelOf(label) })
		}
		case 'resolve':
		case 'void':
		case 'reopen':
			return ok({ action, reason, note: note.value })
		case 'warn': {
			const who = target(body)
			if (!who.ok) return who
			const message = optionalText(body, 'message', MAX_WARNING_LENGTH)
			if (!message.ok) return message
			if (message.value === null) return bad('message', 'message is required')
			return ok({ action, reason, targetPlayerId: who.value, message: message.value, note: note.value })
		}
		case 'chat_mute':
		case 'queue_ban':
		case 'account_ban': {
			const who = target(body)
			if (!who.ok) return who
			const duration = body.duration
			if (action === 'chat_mute') {
				if (!isChatMuteDuration(duration)) return bad('duration', "duration must be '24h', '7d', '30d' or 'permanent'")
				return ok({ action, targetPlayerId: who.value, duration, reason, note: note.value })
			}
			if (!isBanDuration(duration)) return bad('duration', "duration must be '7d', '30d' or 'permanent'")
			return ok({ action, targetPlayerId: who.value, duration, reason, note: note.value })
		}
		case 'overturn': {
			const to = body.toReportOf
			if (typeof to !== 'string' || !to) return bad('toReportOf', 'toReportOf must name the reporter whose result stands')
			return ok({ action, reason, toReportOf: to, note: note.value })
		}
		case 'unban': {
			const banId = body.banId
			if (typeof banId !== 'string' || !UUID.test(banId)) return bad('banId', 'banId must be a ban id')
			return ok({ action, reason, banId, note: note.value })
		}
	}
}

// The preset a command carries, for the role table's per-preset check.
export function presetOf(command: QueueCommand): ChatMuteDuration | BanDuration | undefined {
	return command.action === 'chat_mute' || command.action === 'queue_ban' || command.action === 'account_ban'
		? command.duration
		: undefined
}

export function banTypeOf(command: SanctionCommand): 'chat' | 'queue' | 'account' {
	return command.action === 'chat_mute' ? 'chat' : command.action === 'queue_ban' ? 'queue' : 'account'
}
