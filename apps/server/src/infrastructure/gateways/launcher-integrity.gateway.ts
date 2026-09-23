import { desc, eq } from 'drizzle-orm'
import type {
	ChallengeKind,
	LauncherIntegrityFailureReason,
} from '../../shared/types/index.js'
import { db } from '../db/index.js'
import { launcherIntegrityEvents } from '../db/schema.js'

export type LauncherIntegrityEventRecord = typeof launcherIntegrityEvents.$inferSelect

export async function insertEvent(
	playerId: string,
	kind: ChallengeKind,
	reason: LauncherIntegrityFailureReason,
): Promise<void> {
	await db.insert(launcherIntegrityEvents).values({ playerId, kind, reason })
}

// Read side for the admin Service Queue's anti-cheat detail view
// (service-queue.gateway.ts) -- this table was write-only until now
// (see schema.ts's comment: "an audit trail, not itself a ban").

export async function getIntegrityEventsForPlayer(
	playerId: string,
	limit = 20,
): Promise<LauncherIntegrityEventRecord[]> {
	return db
		.select()
		.from(launcherIntegrityEvents)
		.where(eq(launcherIntegrityEvents.playerId, playerId))
		.orderBy(desc(launcherIntegrityEvents.occurredAt))
		.limit(limit)
}
