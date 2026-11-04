// Flagged chat as the queue holds it: one item for each player in each lobby,
// and the training label each flagged message gets when staff decide the item.
// Pure rules; the gateways do the reads and writes.
import type { ActionKey } from './types.js'

export const DISMISS_LABELS = ['not_harmful', 'harmful_no_action'] as const
export type DismissLabel = (typeof DISMISS_LABELS)[number]
export type ChatLabel = DismissLabel | 'harmful'

export const isDismissLabel = (value: unknown): value is DismissLabel =>
	typeof value === 'string' &&
	(DISMISS_LABELS as readonly string[]).includes(value)

export const dismissLabelOf = (value: unknown): DismissLabel | null =>
	isDismissLabel(value) ? value : null

// The label an action gives the item's messages: a punishment says the
// messages were harmful, a dismiss says what its button says. Anything else
// (a resolve, a ban that is not for chat) gives none.
export function labelOfAction(
	action: ActionKey,
	dismiss: DismissLabel | null,
): ChatLabel | null {
	if (action === 'warn' || action === 'chat_mute') return 'harmful'
	if (action === 'dismiss') return dismiss
	return null
}

// An item's key: the lobby instance, the player, and a round number. A later
// round starts when the earlier item is already decided.
export function flaggedSourceId(
	lobbyId: string,
	playerId: string,
	round: number,
): string {
	const base = `${lobbyId}:${playerId}`
	return round <= 1 ? base : `${base}:${round}`
}

export function nextRound(base: string, used: readonly string[]): number {
	let highest = 0
	for (const id of used) {
		if (id === base) highest = Math.max(highest, 1)
		else if (id.startsWith(`${base}:`)) {
			const round = Number(id.slice(base.length + 1))
			if (Number.isInteger(round)) highest = Math.max(highest, round)
		}
	}
	return highest + 1
}

// The flagged message ids an item holds. An item from before grouping has its
// one message's id as its source id and no list.
export function membersOf(
	context: { flaggedMessageIds?: number[] },
	sourceId: string,
): number[] {
	if (context.flaggedMessageIds?.length) return context.flaggedMessageIds
	return /^\d+$/.test(sourceId) ? [Number(sourceId)] : []
}

export const summaryOf = (count: number): string =>
	`Flagged chat, ${count} message${count === 1 ? '' : 's'}`

export interface GuardReading {
	score: number | null
	band: string | null
	safety: string | null
	contextUsed: boolean | null
}

// What the moderation service said about a line (chat_logs.moderation_verdict).
// A line from before the guard score was kept, or flagged by the word list, has none.
export function guardReadingOf(verdict: unknown): GuardReading {
	const record =
		typeof verdict === 'object' && verdict !== null
			? (verdict as { [key: string]: unknown })
			: {}
	return {
		score: typeof record.guardScore === 'number' ? record.guardScore : null,
		band: typeof record.band === 'string' ? record.band : null,
		safety: typeof record.guardSafety === 'string' ? record.guardSafety : null,
		contextUsed:
			typeof record.guardContextUsed === 'boolean'
				? record.guardContextUsed
				: null,
	}
}

// The messages said before the line with `id`, oldest first, at most `limit`.
export function linesBefore(
	lines: readonly { id: number; message: string }[],
	id: number,
	limit: number,
): string[] {
	const at = lines.findIndex((l) => l.id === id)
	if (at === -1) return []
	return lines.slice(Math.max(0, at - limit), at).map((l) => l.message)
}

export interface LabelMember {
	flaggedMessageId: number
	message: string
	context: string[]
	verdict: unknown
}

export interface ChatLabelRow {
	itemId: number
	flaggedMessageId: number
	message: string
	context: string[]
	score: number | null
	band: string | null
	label: ChatLabel
	decidedAt: Date
}

export function chatLabelRows(input: {
	itemId: number
	label: ChatLabel
	decidedAt: Date
	members: readonly LabelMember[]
}): ChatLabelRow[] {
	return input.members.map((m) => {
		const guard = guardReadingOf(m.verdict)
		return {
			itemId: input.itemId,
			flaggedMessageId: m.flaggedMessageId,
			message: m.message,
			context: m.context,
			score: guard.score,
			band: guard.band,
			label: input.label,
			decidedAt: input.decidedAt,
		}
	})
}

export const LABEL_EXPORT_COLUMNS = [
	'message',
	'context',
	'score',
	'band',
	'label',
	'decided_at',
] as const

const quote = (value: string) =>
	/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value

// The admin's label export as CSV. The context is a JSON array of the lines
// said before the message.
export function labelsCsv(
	rows: readonly {
		message: string
		context: unknown
		score: number | null
		band: string | null
		label: string
		decidedAt: Date
	}[],
): string {
	const lines = rows.map((r) =>
		[
			r.message,
			JSON.stringify(r.context ?? []),
			r.score === null ? '' : String(r.score),
			r.band ?? '',
			r.label,
			r.decidedAt.toISOString(),
		]
			.map(quote)
			.join(','),
	)
	return `${[LABEL_EXPORT_COLUMNS.join(','), ...lines].join('\r\n')}\r\n`
}
