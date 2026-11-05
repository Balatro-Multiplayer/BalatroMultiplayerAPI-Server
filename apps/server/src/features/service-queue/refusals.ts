// Why the queue refused a request, as values (never thrown), and the HTTP
// answer each one becomes: {error, code, ...detail}.

export type QueueRefusal =
	| { code: 'not_found' }
	| { code: 'unknown_action' }
	| { code: 'invalid_body'; field: string; message: string }
	| { code: 'not_for_type' }
	| { code: 'wrong_status'; status: string }
	| { code: 'withdrawn' }
	| { code: 'forbidden' }
	| { code: 'claimed'; claimedBy: string; claimedUntil: Date | null }
	| { code: 'invalid_target' }
	| { code: 'no_subject' }
	| { code: 'ban_not_found' }
	| { code: 'unchanged' }
	| { code: 'source_missing' }
	| { code: 'nakama_failed'; reason: string }
	| { code: 'not_voidable'; reason: string }

export type QueueResult<T> = { ok: true; value: T } | { ok: false; refusal: QueueRefusal }

export const refuse = (refusal: QueueRefusal): { ok: false; refusal: QueueRefusal } => ({ ok: false, refusal })

const STATUS: Readonly<Record<QueueRefusal['code'], number>> = {
	not_found: 404,
	unknown_action: 400,
	invalid_body: 400,
	not_for_type: 400,
	wrong_status: 409,
	withdrawn: 409,
	forbidden: 403,
	claimed: 409,
	invalid_target: 400,
	no_subject: 400,
	ban_not_found: 404,
	unchanged: 409,
	source_missing: 404,
	nakama_failed: 502,
	not_voidable: 409,
}

function messageOf(refusal: QueueRefusal): string {
	switch (refusal.code) {
		case 'not_found':
			return 'Queue item not found'
		case 'unknown_action':
			return 'Unknown action'
		case 'invalid_body':
			return refusal.message
		case 'not_for_type':
			return 'That action is not available for this item type'
		case 'wrong_status':
			return `The item is ${refusal.status}`
		case 'withdrawn':
			return 'Withdrawn by the player'
		case 'forbidden':
			return 'Your role may not take this action'
		case 'claimed':
			return 'Another moderator is handling this item'
		case 'invalid_target':
			return 'That player is not a target of this item'
		case 'no_subject':
			return 'This item has no player to act on'
		case 'ban_not_found':
			return 'No matching active ban for this item'
		case 'unchanged':
			return 'That is already the recorded result'
		case 'source_missing':
			return "The item's source record is gone"
		case 'nakama_failed':
			return `Nakama refused: ${refusal.reason}`
		case 'not_voidable':
			return refusal.reason
	}
}

export function httpOf(refusal: QueueRefusal): { status: number; body: Record<string, unknown> } {
	const { code, ...detail } = refusal
	return { status: STATUS[code], body: { error: messageOf(refusal), code, ...detail } }
}
