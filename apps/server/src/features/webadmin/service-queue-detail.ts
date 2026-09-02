import { eq } from 'drizzle-orm'
import { db } from '../../infrastructure/db/index.js'
import { flaggedMessages, forfeitReconciliationFlags, matchResultConflicts, reports } from '../../infrastructure/db/schema.js'
import {
	getHardwareFingerprintsForPlayer,
	getIntegrityEventsForPlayer,
} from '../../infrastructure/gateways/launcher-integrity.gateway.js'
import type { ServiceQueueItemRecord, ServiceQueueItemType } from '../../infrastructure/gateways/service-queue.gateway.js'
import { replayLogService } from '../replay-log/replay-log.service.js'
import { enrichReport } from './reports.route.js'

// A uuid-shaped string -- launcherIntegrityEvents/playerHardwareFingerprints
// have real uuid FKs to players.id, while subjectPlayerId is `text` and may
// hold a non-uuid temp/dev account id (see schema.ts's rationale on
// serviceQueueItems). Guard before querying rather than letting Postgres
// reject the query.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function getReportDetail(item: ServiceQueueItemRecord) {
	const [row] = await db.select().from(reports).where(eq(reports.id, Number(item.sourceId))).limit(1)
	if (!row) return null
	return enrichReport(row, 200)
}

async function getFlaggedChatDetail(item: ServiceQueueItemRecord) {
	const [row] = await db
		.select()
		.from(flaggedMessages)
		.where(eq(flaggedMessages.id, Number(item.sourceId)))
		.limit(1)
	return row ?? null
}

async function getMatchConflictDetail(item: ServiceQueueItemRecord) {
	const [row] = await db
		.select()
		.from(matchResultConflicts)
		.where(eq(matchResultConflicts.id, Number(item.sourceId)))
		.limit(1)
	return row ?? null
}

async function getForfeitReconciliationDetail(item: ServiceQueueItemRecord) {
	const [row] = await db
		.select()
		.from(forfeitReconciliationFlags)
		.where(eq(forfeitReconciliationFlags.id, Number(item.sourceId)))
		.limit(1)
	return row ?? null
}

/** sourceId = lobbyRuns.id (a uuid), subjectPlayerId = the flagged player --
 *  see schema.ts's comment on why anti_cheat is the one type without a
 *  single-column source PK. Composite of 3 forensic sources: the run/replay
 *  log, launcher-integrity events, and hardware fingerprints -- the latter
 *  two are best-effort (moderator-privileged replay access, matching
 *  getReplay's isModerator=true bypass; empty arrays on a non-uuid player id
 *  or lookup failure rather than a hard error). */
async function getAntiCheatDetail(item: ServiceQueueItemRecord, actingPlayerId: string) {
	const run = await replayLogService.getReplay(item.sourceId, actingPlayerId, true).catch(() => null)
	const playerLog = run?.logs.find((l) => l.playerId === item.subjectPlayerId) ?? null

	const isUuidPlayer = item.subjectPlayerId !== null && UUID_PATTERN.test(item.subjectPlayerId)
	const [integrityEvents, hardware] = await Promise.all([
		isUuidPlayer ? getIntegrityEventsForPlayer(item.subjectPlayerId!).catch(() => []) : Promise.resolve([]),
		isUuidPlayer ? getHardwareFingerprintsForPlayer(item.subjectPlayerId!).catch(() => []) : Promise.resolve([]),
	])

	return { run: run?.run ?? null, playerLog, integrityEvents, hardware }
}

export async function getServiceQueueItemDetail(
	item: ServiceQueueItemRecord,
	actingPlayerId: string,
): Promise<{ item: ServiceQueueItemRecord; detail: unknown }> {
	switch (item.itemType as ServiceQueueItemType) {
		case 'report':
			return { item, detail: await getReportDetail(item) }
		case 'flagged_chat':
			return { item, detail: await getFlaggedChatDetail(item) }
		case 'match_conflict':
			return { item, detail: await getMatchConflictDetail(item) }
		case 'forfeit_reconciliation':
			return { item, detail: await getForfeitReconciliationDetail(item) }
		case 'anti_cheat':
			return { item, detail: await getAntiCheatDetail(item, actingPlayerId) }
	}
}
