// The sourceId each item type keys its source row by, and back.
//   anti_cheat: 'runId:playerId' (match_run_logs' composite key)
//   integrity:  'playerId:YYYY-MM-DD' (the UTC day of the failed check)
//   staff_report: 'runId:epochMs' (a match can be reported more than once)
//   the rest:   the source row's integer id

export function antiCheatSourceId(runId: string, playerId: string): string {
	return `${runId}:${playerId}`
}

export function parseAntiCheatSourceId(sourceId: string): { runId: string; playerId: string } | null {
	const at = sourceId.indexOf(':')
	if (at <= 0 || at === sourceId.length - 1) return null
	return { runId: sourceId.slice(0, at), playerId: sourceId.slice(at + 1) }
}

// The UTC day an event falls on, as the item's source id carries it.
export function utcDayOf(at: Date): string {
	return at.toISOString().slice(0, 10)
}

export function integritySourceId(playerId: string, at: Date): string {
	return `${playerId}:${utcDayOf(at)}`
}

export function parseIntegritySourceId(sourceId: string): { playerId: string; day: string } | null {
	const at = sourceId.lastIndexOf(':')
	if (at <= 0) return null
	const day = sourceId.slice(at + 1)
	if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null
	return { playerId: sourceId.slice(0, at), day }
}

export function numericSourceId(sourceId: string): number | null {
	return /^\d+$/.test(sourceId) ? Number(sourceId) : null
}

export function staffReportSourceId(runId: string, at: Date): string {
	return `${runId}:${at.getTime()}`
}

export function parseStaffReportSourceId(sourceId: string): { runId: string } | null {
	const at = sourceId.lastIndexOf(':')
	if (at <= 0 || !/^\d+$/.test(sourceId.slice(at + 1))) return null
	return { runId: sourceId.slice(0, at) }
}
