import { eq, sql } from 'drizzle-orm'
import type { ChatRows, ForfeitRow, GameKind, RunRows } from '../../features/nakama/mirror.service.js'
import { antiCheatSourceId } from '../../shared/service-queue/source-ids.js'
import { db } from '../db/index.js'
import {
	chatLogs,
	flaggedMessages,
	lobbyRuns,
	matchResultConflicts,
	matchRunLogs,
	matchmakingMatches,
	matchmakingRatings,
} from '../db/schema.js'
import { hasOpenForfeitReconciliationFlag, insertForfeitReconciliationFlag } from './forfeit-reconciliation.gateway.js'
import { summaryOf } from '../../features/service-queue/flagged-chat.js'
import { addToFlaggedChatItem } from './flagged-chat.gateway.js'
import { enqueueServiceQueueItem, rescoreAfterChange } from './service-queue.gateway.js'

// Writes what the Nakama mirror pulled (features/nakama/mirror.service.ts).
// Every write is an upsert keyed by the run id or the outbox key, so storing
// the same entry twice (the API died before acking it) changes nothing.

export async function storeMirroredRun(rows: RunRows): Promise<void> {
	await db.transaction(async (tx) => {
		const { lobbyRun } = rows
		await tx
			.insert(lobbyRuns)
			.values(lobbyRun)
			.onConflictDoUpdate({
				target: lobbyRuns.id,
				set: { status: lobbyRun.status, finalizedAt: lobbyRun.finalizedAt },
			})
		for (const log of rows.logs) {
			await tx
				.insert(matchRunLogs)
				.values(log)
				.onConflictDoUpdate({
					target: [matchRunLogs.runId, matchRunLogs.playerId],
					set: {
						compressedEvents: log.compressedEvents,
						carbonHash: log.carbonHash,
						eventCount: log.eventCount,
						status: log.status,
						flagReason: log.flagReason,
						finalizedAt: log.finalizedAt,
						expiresAt: log.expiresAt,
					},
				})
		}
		if (rows.match) {
			await tx.insert(matchmakingMatches).values(rows.match).onConflictDoNothing({ target: matchmakingMatches.matchId })
		}
		for (const rating of rows.ratings) {
			// Nakama owns the rating; the row is its latest copy.
			await tx
				.insert(matchmakingRatings)
				.values(rating)
				.onConflictDoUpdate({
					target: [
						matchmakingRatings.playerId,
						matchmakingRatings.modId,
						matchmakingRatings.gameMode,
						matchmakingRatings.season,
					],
					set: {
						rating: rating.rating,
						wins: rating.wins,
						losses: rating.losses,
						gamesPlayed: rating.gamesPlayed,
						seasonBest: rating.seasonBest,
						seasonBestLen: rating.seasonBestLen,
						seasonBestRev: rating.seasonBestRev,
						seasonBestText: rating.seasonBestText,
						lastMatchAt: rating.lastMatchAt,
						updatedAt: sql`now()`,
					},
				})
		}
		// Once per run: a retried entry finds them already there.
		if (rows.conflicts.length > 0) {
			const [existing] = await tx
				.select({ id: matchResultConflicts.id })
				.from(matchResultConflicts)
				.where(eq(matchResultConflicts.matchId, rows.lobbyRun.id))
				.limit(1)
			if (!existing) await tx.insert(matchResultConflicts).values(rows.conflicts)
		}
	})
	// After the commit: the queue item points at rows that now exist. One
	// item per flagged player (sourceId = 'runId:playerId', the run log's key).
	for (const flag of rows.flagged) {
		await enqueueServiceQueueItem({
			itemType: 'anti_cheat',
			sourceId: antiCheatSourceId(rows.lobbyRun.id, flag.playerId),
			subjectPlayerId: flag.playerId,
			summary: `Anti-cheat flag (${flag.reason})`,
			context: { lobbyKind: rows.lobbyKind },
		})
	}
	// One item per contested run (sourceId = the run id), however often the
	// entry is stored. The held run waits on it.
	if (rows.contest) {
		await enqueueServiceQueueItem({
			itemType: 'contest',
			sourceId: rows.lobbyRun.id,
			subjectPlayerId: rows.contest.againstId,
			summary: `Contested ${rows.lobbyKind === 'ranked' ? 'ranked' : 'casual'} match, lobby ${rows.lobbyRun.lobbyCode}`,
			context: { lobbyKind: rows.lobbyKind, contest: rows.contest },
		})
	}
	if (rows.conflicts.length > 0) {
		const conflicts = await db
			.select({ id: matchResultConflicts.id })
			.from(matchResultConflicts)
			.where(eq(matchResultConflicts.matchId, rows.lobbyRun.id))
		for (const conflict of conflicts) {
			await enqueueServiceQueueItem({
				itemType: 'match_conflict',
				sourceId: String(conflict.id),
				subjectPlayerId: null,
				summary: `${rows.lobbyKind === 'private' ? 'Private game' : 'Match'} result conflict — lobby ${rows.lobbyRun.lobbyCode}`,
				context: { lobbyKind: rows.lobbyKind },
			})
		}
	}
}

export async function storeMirroredForfeit(row: ForfeitRow, lobbyKind: GameKind | null): Promise<void> {
	if (await hasOpenForfeitReconciliationFlag(row.matchId, row.playerId)) return
	await insertForfeitReconciliationFlag(row, lobbyKind ? { lobbyKind } : {})
}

export async function storeMirroredChat(rows: ChatRows): Promise<void> {
	await db.insert(chatLogs).values(rows.chat).onConflictDoNothing()
	const flagged = rows.flaggedMessage
	if (!flagged) return
	await db.insert(flaggedMessages).values(flagged).onConflictDoNothing()
	const [row] = await db
		.select({ id: flaggedMessages.id })
		.from(flaggedMessages)
		.where(eq(flaggedMessages.mirrorKey, flagged.mirrorKey))
	if (!row) return
	// One item for each player in each lobby instance. A line from a lobby that
	// has no instance id (older lines) keeps its own item.
	const lobbyId = rows.chat.lobbyId
	if (lobbyId) {
		const made = await addToFlaggedChatItem({
			flaggedMessageId: row.id,
			playerId: flagged.playerId,
			lobbyId,
			lobbyKind: rows.lobbyKind ?? undefined,
		})
		if (made) await rescoreAfterChange(made).catch((err) => console.error('[service-queue] Rescoring failed:', err))
		return
	}
	await enqueueServiceQueueItem({
		itemType: 'flagged_chat',
		sourceId: String(row.id),
		subjectPlayerId: flagged.playerId,
		summary: summaryOf(1),
		context: { ...(rows.lobbyKind ? { lobbyKind: rows.lobbyKind } : {}), flaggedMessageIds: [row.id] },
	})
}
