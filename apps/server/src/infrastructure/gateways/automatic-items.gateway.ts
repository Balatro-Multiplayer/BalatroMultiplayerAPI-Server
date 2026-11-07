// Data access for the one-time job that closes the open automatic items the
// current rules would not make (features/service-queue/automatic-rules.ts).
import { and, eq, inArray } from 'drizzle-orm'
import {
	type ObsoleteCandidate,
	type ObsoleteRule,
} from '../../features/service-queue/automatic-rules.js'
import { AUTOMATIC_TYPES } from '../../features/service-queue/lanes.js'
import { contextOf } from '../../features/service-queue/types.js'
import { parseAntiCheatSourceId } from '../../shared/service-queue/source-ids.js'
import { decompressFromBase64 } from '../../shared/utils/compression.js'
import { db } from '../db/index.js'
import { lobbyRuns, matchRunLogs, serviceQueueItems } from '../db/schema.js'
import { recordItemEvent, markServiceQueueItemResolved } from './service-queue.gateway.js'
import { recordStaffAction } from './staff-log.gateway.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CHUNK = 500

// The system has no player row. Its staff log entries use the nil id.
export const SYSTEM_STAFF_ID = '00000000-0000-0000-0000-000000000000'

function chunks<T>(list: T[]): T[][] {
	const out: T[][] = []
	for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK))
	return out
}

// Whether the log's JSON events hold the closing 'end' event.
function hasEnd(compressedEvents: string): boolean {
	try {
		const events = JSON.parse(decompressFromBase64(compressedEvents)) as unknown
		return Array.isArray(events) && events.some((e) => Array.isArray(e) && e[1] === 'end')
	} catch {
		return false
	}
}

export async function listOpenAutomaticCandidates(): Promise<ObsoleteCandidate[]> {
	const items = await db
		.select()
		.from(serviceQueueItems)
		.where(and(eq(serviceQueueItems.status, 'open'), inArray(serviceQueueItems.itemType, [...AUTOMATIC_TYPES])))
	const out: ObsoleteCandidate[] = []
	const antiCheat: { id: number; playerId: string | null; runId: string; logPlayerId: string }[] = []
	for (const item of items) {
		if (item.itemType === 'integrity') {
			out.push({ id: item.id, playerId: item.subjectPlayerId, facts: { itemType: 'integrity', context: contextOf(item.context) } })
			continue
		}
		if (item.itemType !== 'anti_cheat') continue
		// Rows from before the source id held the player carried the bare run id.
		const parsed = parseAntiCheatSourceId(item.sourceId) ?? { runId: item.sourceId, playerId: item.subjectPlayerId ?? '' }
		if (UUID.test(parsed.runId)) antiCheat.push({ id: item.id, playerId: item.subjectPlayerId, runId: parsed.runId, logPlayerId: parsed.playerId })
		// A run that is gone cannot be judged: the item stays.
		else out.push(unjudged(item.id, item.subjectPlayerId))
	}

	const runIds = [...new Set(antiCheat.map((a) => a.runId))]
	const statusOf = new Map<string, 'active' | 'completed' | 'abandoned' | 'terminated'>()
	const flagsOf = new Map<string, { flagged: number; total: number; reasons: Map<string, string | null> }>()
	for (const part of chunks(runIds)) {
		for (const r of await db.select({ id: lobbyRuns.id, status: lobbyRuns.status }).from(lobbyRuns).where(inArray(lobbyRuns.id, part)))
			statusOf.set(r.id, r.status as 'active' | 'completed' | 'abandoned' | 'terminated')
		for (const l of await db
			.select({ runId: matchRunLogs.runId, playerId: matchRunLogs.playerId, flagReason: matchRunLogs.flagReason })
			.from(matchRunLogs)
			.where(inArray(matchRunLogs.runId, part))) {
			const entry = flagsOf.get(l.runId) ?? { flagged: 0, total: 0, reasons: new Map() }
			entry.total++
			if (l.flagReason) entry.flagged++
			entry.reasons.set(l.playerId, l.flagReason)
			flagsOf.set(l.runId, entry)
		}
	}

	// Only an unverified-log item needs the log itself.
	const ends = new Map<string, boolean>()
	const wanted = antiCheat.filter((a) => flagsOf.get(a.runId)?.reasons.get(a.logPlayerId) === 'unverified_log')
	for (const part of chunks([...new Set(wanted.map((a) => a.runId))])) {
		for (const l of await db
			.select({ runId: matchRunLogs.runId, playerId: matchRunLogs.playerId, events: matchRunLogs.compressedEvents })
			.from(matchRunLogs)
			.where(inArray(matchRunLogs.runId, part)))
			ends.set(`${l.runId}:${l.playerId}`, hasEnd(l.events))
	}

	for (const a of antiCheat) {
		const run = flagsOf.get(a.runId)
		if (!run) {
			out.push(unjudged(a.id, a.playerId))
			continue
		}
		out.push({
			id: a.id,
			playerId: a.playerId,
			facts: {
				itemType: 'anti_cheat',
				flagReason: (run.reasons.get(a.logPlayerId) ?? null) as 'hash_mismatch' | 'elapsed_time_gate' | 'unverified_log' | null,
				runStatus: statusOf.get(a.runId) ?? 'completed',
				runPlayers: run.total,
				runFlagged: run.flagged,
				// A log that is not stored counts as no result.
				logHasEnd: ends.get(`${a.runId}:${a.logPlayerId}`) ?? false,
			},
		})
	}
	return out
}

// A candidate no rule can close: no stored run to judge it by.
function unjudged(id: number, playerId: string | null): ObsoleteCandidate {
	return {
		id,
		playerId,
		facts: { itemType: 'anti_cheat', flagReason: null, runStatus: 'completed', runPlayers: 0, runFlagged: 0, logHasEnd: true },
	}
}

// Dismisses one item as the system and writes its item event and staff log
// entry together. False when the item was no longer open.
export async function closeItemAsSystem(input: {
	id: number
	playerId: string | null
	rule: ObsoleteRule
	note: string
}): Promise<boolean> {
	return db.transaction(async (tx) => {
		const row = await markServiceQueueItemResolved(tx, input.id, 'system', 'dismiss', input.note)
		if (!row) return false
		const detail = { rule: input.rule, system: true }
		await recordItemEvent(tx, { itemId: input.id, kind: 'acted', actor: 'system', action: 'dismiss', note: input.note, detail })
		await recordStaffAction(tx, {
			staff: { playerId: SYSTEM_STAFF_ID, role: 'admin' },
			action: 'dismiss',
			reason: input.note,
			targetPlayerId: input.playerId,
			itemId: input.id,
			detail,
		})
		return true
	})
}
