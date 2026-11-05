// The pure halves of an item's evidence: each takes rows already read and
// shapes what the detail page shows. evidence/assemble.ts does the reading.

// nakama/src/lobby/anticheat.ts MIN_MS_PER_HAND: the least time one scored
// hand can take. Mirrored here to explain an elapsed_time_gate flag.
export const MIN_MS_PER_HAND = 3000
// nakama/src/lobby/anticheat.ts HAND_OPCODE.
const HAND_OPCODE = 'hand_result'

// ---------------------------------------------------------------------------
// Chat
// ---------------------------------------------------------------------------

export interface ChatLine {
	playerId: string
	displayName: string | null
	message: string
	sentAt: Date
	flagged: boolean
}

export interface MarkedChatLine extends ChatLine {
	// Sent by the player the item is about.
	bySubject: boolean
}

export function markChat(lines: readonly ChatLine[], subjectPlayerId: string | null): MarkedChatLine[] {
	return [...lines]
		.sort((a, b) => a.sentAt.getTime() - b.sentAt.getTime())
		.map((line) => ({ ...line, bySubject: subjectPlayerId !== null && line.playerId === subjectPlayerId }))
}

// Up to `radius` lines either side of the line at `centre` (by position in
// time order), the centre line included.
export function chatWindow<T extends { sentAt: Date }>(lines: readonly T[], centre: number, radius: number): T[] {
	if (centre < 0) return []
	return lines.slice(Math.max(0, centre - radius), centre + radius + 1)
}

// A reported lobby's lines, with those the chat log flagged marked: a
// reported line is flagged when the same player sent the same text flagged.
export function withFlags<T extends { playerId: string; message: string }>(
	lines: readonly T[],
	flagged: readonly { playerId: string; message: string }[],
): (T & { flagged: boolean })[] {
	const keys = new Set(flagged.map((f) => `${f.playerId}\u0000${f.message}`))
	return lines.map((line) => ({ ...line, flagged: keys.has(`${line.playerId}\u0000${line.message}`) }))
}

// A flagged message's verdict as the page shows it: local word-filter
// matches or the remote service's band.
export function flagVerdictOf(matches: unknown): { source: 'local'; matches: string[] } | { source: 'remote'; band: string } {
	if (Array.isArray(matches))
		return {
			source: 'local',
			matches: matches.map((m) =>
				typeof m === 'string' ? m : typeof m === 'object' && m && 'term' in m ? String((m as { term: unknown }).term) : JSON.stringify(m),
			),
		}
	const band = typeof matches === 'object' && matches && 'band' in matches ? (matches as { band: unknown }).band : null
	return { source: 'remote', band: typeof band === 'string' ? band : 'unknown' }
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface ReportSummaryRow {
	id: number
	type: string
	status: string
	reporterId: string
	createdAt: Date
}

export function reportsAgainstOf(rows: readonly ReportSummaryRow[]) {
	const byType: Record<string, number> = {}
	for (const row of rows) byType[row.type] = (byType[row.type] ?? 0) + 1
	const recent = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 5)
	return {
		total: rows.length,
		open: rows.filter((r) => r.status === 'open').length,
		distinctReporters: new Set(rows.map((r) => r.reporterId)).size,
		byType,
		recent,
	}
}

// The resolution actions that count as the reported player being sanctioned.
export const SANCTIONING_ACTIONS = ['warn', 'chat_mute', 'queue_ban', 'account_ban', 'username_ban'] as const

export function reportsFiledOf(rows: readonly { resolutionAction: string | null }[]) {
	return {
		total: rows.length,
		actioned: rows.filter((r) => (SANCTIONING_ACTIONS as readonly string[]).includes(r.resolutionAction ?? '')).length,
	}
}

// ---------------------------------------------------------------------------
// Bans
// ---------------------------------------------------------------------------

export function splitBans<T extends { liftedAt: Date | null; expiresAt: Date | null }>(bans: readonly T[], now: Date) {
	const active = bans.filter((b) => !b.liftedAt && (!b.expiresAt || b.expiresAt > now))
	return { active, prior: bans.filter((b) => !active.includes(b)) }
}

// ---------------------------------------------------------------------------
// Results and conflicts
// ---------------------------------------------------------------------------

export interface Placement {
	playerId: string
	place: number
}

function asPlacements(value: unknown): Placement[] {
	if (!Array.isArray(value)) return []
	return value.filter(
		(p): p is Placement => !!p && typeof p === 'object' && typeof p.playerId === 'string' && typeof p.place === 'number',
	)
}

export function placementsAgree(a: unknown, b: unknown): boolean {
	const left = asPlacements(a)
	const right = asPlacements(b)
	if (left.length === 0 || left.length !== right.length) return false
	const places = new Map(left.map((p) => [p.playerId, p.place]))
	return right.every((p) => places.get(p.playerId) === p.place)
}

// Per reporter of a conflict: what they reported and whether it matches the
// recorded result.
export function conflictSides(
	conflict: { firstReporterId: string; firstPlacements: unknown; conflictingReporterId: string; conflictingPlacements: unknown },
	recorded: unknown,
) {
	return [
		{
			role: 'first_reporter' as const,
			playerId: conflict.firstReporterId,
			placements: asPlacements(conflict.firstPlacements),
			agreesWithResult: placementsAgree(conflict.firstPlacements, recorded),
		},
		{
			role: 'conflicting_reporter' as const,
			playerId: conflict.conflictingReporterId,
			placements: asPlacements(conflict.conflictingPlacements),
			agreesWithResult: placementsAgree(conflict.conflictingPlacements, recorded),
		},
	]
}

// ---------------------------------------------------------------------------
// Anti-cheat
// ---------------------------------------------------------------------------

export type FlagExplanation =
	| { reason: 'hash_mismatch'; text: string }
	| { reason: 'unverified_log'; text: string }
	| { reason: 'elapsed_time_gate'; text: string; hands: number; elapsedMs: number; minimumMs: number }
	| { reason: 'unknown'; text: string }

// A stored log event is the tuple [t, opcode, args] (Nakama match_logs); an
// {opcode} object is accepted too.
function opcodeOf(event: unknown): unknown {
	if (Array.isArray(event)) return event[1]
	return event && typeof event === 'object' ? (event as { opcode?: unknown }).opcode : undefined
}

export function handCount(events: readonly unknown[] | undefined): number {
	if (!events) return 0
	return events.filter((e) => opcodeOf(e) === HAND_OPCODE).length
}

export function explainFlag(reason: string | null, hands: number, elapsedMs: number): FlagExplanation {
	if (reason === 'hash_mismatch')
		return {
			reason,
			text: "The replay log's checksum does not match the events it carries: the log was altered or is incomplete.",
		}
	if (reason === 'unverified_log')
		return {
			reason,
			text: 'In a ranked game, the replay log is missing, cut off or has no checksum, so the season best it claims could not be checked.',
		}
	if (reason === 'elapsed_time_gate') {
		const minimumMs = hands * MIN_MS_PER_HAND
		return {
			reason,
			hands,
			elapsedMs,
			minimumMs,
			text: `${hands} scored hands need at least ${Math.round(minimumMs / 1000)}s (${MIN_MS_PER_HAND / 1000}s each), but the game lasted ${Math.round(elapsedMs / 1000)}s.`,
		}
	}
	return { reason: 'unknown', text: `Flag reason: ${reason ?? 'none recorded'}` }
}

// ---------------------------------------------------------------------------
// Forfeits
// ---------------------------------------------------------------------------

export type TimelineEvent = 'started' | 'forfeited' | 'reconnected' | 'ended'

export function forfeitTimeline(input: {
	startedAt: Date | null
	forfeitedAt: Date
	reconnectedAt: Date
	endedAt: Date | null
}): { at: Date; event: TimelineEvent }[] {
	const events: { at: Date; event: TimelineEvent }[] = [
		{ at: input.forfeitedAt, event: 'forfeited' },
		{ at: input.reconnectedAt, event: 'reconnected' },
	]
	if (input.startedAt) events.push({ at: input.startedAt, event: 'started' })
	if (input.endedAt) events.push({ at: input.endedAt, event: 'ended' })
	return events.sort((a, b) => a.at.getTime() - b.at.getTime())
}
