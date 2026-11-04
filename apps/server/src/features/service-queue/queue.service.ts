// The service queue wired to Postgres and Nakama: the dispatcher's
// dependencies, and claim/release. The routes call these.
import { and, eq, isNotNull } from 'drizzle-orm'
import { db } from '../../infrastructure/db/index.js'
import type { DbTransaction } from '../../infrastructure/db/executor.js'
import { matchRunLogs, matchmakingMatches } from '../../infrastructure/db/schema.js'
import { setMatchResult, voidMatch } from '../../infrastructure/db/void-match.js'
import { getBanById, insertBan, liftBan } from '../../infrastructure/gateways/ban.gateway.js'
import {
	getForfeitReconciliationFlag,
	setForfeitFlagStatus,
} from '../../infrastructure/gateways/forfeit-reconciliation.gateway.js'
import { getMatchConflict, setMatchConflictStatus } from '../../infrastructure/gateways/match-conflict.gateway.js'
import { findNakamaUserIds, findPlayerById } from '../../infrastructure/gateways/player.gateway.js'
import { getReportById, setReportStatus } from '../../infrastructure/gateways/report.gateway.js'
import {
	type ServiceQueueItemRecord,
	claimItem,
	getServiceQueueItemById,
	markServiceQueueItemReopened,
	openAutomaticItemIds,
	markServiceQueueItemResolved,
	recordItemEvent,
	releaseItem,
	rescoreAfterChange,
	rescoreSubject,
	touchServiceQueueItem,
} from '../../infrastructure/gateways/service-queue.gateway.js'
import { recordStaffAction } from '../../infrastructure/gateways/staff-log.gateway.js'
import { insertWarning } from '../../infrastructure/gateways/warning.gateway.js'
import { callNakamaRpc } from '../../infrastructure/nakama/admin-client.js'
import { banInNakama, liftBanInNakama, notifyWarnedInNakama } from '../../infrastructure/nakama/moderation-sync.js'
import { dismissAutomaticItems } from './automatic.js'
import { decideClaim, decideRelease } from './claim.js'
import { type DispatcherDeps, type GameRef, type QueueItem, createDispatcher } from './dispatcher.js'
import { type Placement, samePlaces } from './overturn.js'
import { type QueueResult, refuse } from './refusals.js'
import { numericSourceId, parseAntiCheatSourceId } from '../../shared/service-queue/source-ids.js'
import { type StaffRole, actorOf, contextOf } from './types.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The run an item is about: a conflict's or forfeit flag's match id (the run
// id), a contest's source id (the run id), or an anti-cheat item's run.
async function runIdOf(item: QueueItem): Promise<string | null> {
	const id = numericSourceId(item.sourceId)
	switch (item.itemType) {
		case 'match_conflict':
			return id === null ? null : ((await getMatchConflict(id))?.matchId ?? null)
		case 'forfeit_reconciliation':
			return id === null ? null : ((await getForfeitReconciliationFlag(id))?.matchId ?? null)
		case 'contest':
			return item.sourceId
		case 'anti_cheat':
			// Rows from before migration 0054 held the bare run id.
			return parseAntiCheatSourceId(item.sourceId)?.runId ?? item.sourceId
		default:
			return null
	}
}

export async function gameOf(item: QueueItem): Promise<GameRef | null> {
	const runId = await runIdOf(item)
	if (!runId) return null
	const [match] = await db
		.select({ gameMode: matchmakingMatches.gameMode })
		.from(matchmakingMatches)
		.where(eq(matchmakingMatches.matchId, runId))
		.limit(1)
	return { runId, matchmade: !!match, ranked: !!match && match.gameMode.startsWith('ranked:') }
}

// Nakama's result for the run, pushed first (Nakama owns run records), then
// the matchmade record and its ratings.
async function overturnGame(
	game: GameRef,
	placements: (Placement & { rated?: boolean })[],
): Promise<{ kind: 'applied'; rerated: boolean } | { kind: 'failed'; reason: string }> {
	const nakamaIds = await findNakamaUserIds(placements.map((p) => p.playerId))
	if (placements.some((p) => !nakamaIds.has(p.playerId)))
		return { kind: 'failed', reason: 'a player in that result has no Nakama account' }
	const nakamaPlacements = placements.map((p) => ({ playerId: nakamaIds.get(p.playerId) as string, place: p.place }))
	const set = await callNakamaRpc('admin_run_set_result', { runId: game.runId, placements: nakamaPlacements })
	if (!set.ok) {
		// Already the result (a retried overturn) is success.
		const current = await callNakamaRpc<{ run: { placements: Placement[] } }>('admin_run_get', { runId: game.runId })
		if (!current.ok || !samePlaces(current.value.run.placements, nakamaPlacements))
			return { kind: 'failed', reason: `admin_run_set_result ${set.error}` }
	}
	if (!game.matchmade) return { kind: 'applied', rerated: false }
	const outcome = await setMatchResult(game.runId, placements)
	if (outcome.kind === 'failed') return { kind: 'failed', reason: outcome.reason }
	if (outcome.kind === 'not_found') return { kind: 'failed', reason: 'the matchmade record is gone' }
	return { kind: 'applied', rerated: outcome.rerated }
}

const deps: DispatcherDeps<DbTransaction> = {
	now: () => new Date(),
	getItem: (id) => getServiceQueueItemById(id),
	async sourcesOf(item) {
		const id = numericSourceId(item.sourceId)
		if (item.itemType === 'report') {
			const report = id === null ? null : await getReportById(id)
			return report ? { subjectPlayerId: item.subjectPlayerId, report } : null
		}
		if (item.itemType === 'match_conflict') {
			const conflict = id === null ? null : await getMatchConflict(id)
			return conflict ? { subjectPlayerId: item.subjectPlayerId, conflict } : null
		}
		if (item.itemType === 'contest') {
			const { contest } = contextOf(item.context)
			return contest ? { subjectPlayerId: item.subjectPlayerId, contest } : null
		}
		return { subjectPlayerId: item.subjectPlayerId }
	},
	async playerExists(playerId) {
		return UUID.test(playerId) && !!(await findPlayerById(playerId))
	},
	getBan: (banId) => getBanById(banId),
	gameOf,
	async conflictOf(item) {
		const id = numericSourceId(item.sourceId)
		return item.itemType === 'match_conflict' && id !== null ? getMatchConflict(id) : null
	},
	async participantsOf(game) {
		const [match] = await db
			.select({ players: matchmakingMatches.players })
			.from(matchmakingMatches)
			.where(eq(matchmakingMatches.matchId, game.runId))
			.limit(1)
		return Array.isArray(match?.players) ? (match.players as string[]) : []
	},
	async originalResultOf(game) {
		const [match] = await db
			.select({ resultPlacements: matchmakingMatches.resultPlacements })
			.from(matchmakingMatches)
			.where(eq(matchmakingMatches.matchId, game.runId))
			.limit(1)
		const placements = match?.resultPlacements
		if (!Array.isArray(placements)) return []
		return (placements as Placement[]).map(({ playerId, place }) => ({ playerId, place }))
	},
	async flaggedPlayersOf(runId) {
		if (!UUID.test(runId)) return new Set()
		const rows = await db
			.select({ playerId: matchRunLogs.playerId })
			.from(matchRunLogs)
			.where(and(eq(matchRunLogs.runId, runId), isNotNull(matchRunLogs.flagReason)))
		return new Set(rows.map((r) => r.playerId))
	},
	async voidGame(game) {
		const outcome = await voidMatch(game.runId)
		switch (outcome.kind) {
			case 'voided':
				return { kind: 'voided', rerated: outcome.ranked }
			case 'not_resolved':
				return outcome
			case 'failed':
				return outcome
			case 'not_found':
				return { kind: 'failed', reason: 'the matchmade record is gone' }
		}
	},
	overturnGame,

	transaction: (fn) => db.transaction(fn),
	async markResolved(tx, id, actor, action, note, now) {
		return !!(await markServiceQueueItemResolved(tx, id, actor, action, note, now))
	},
	async markReopened(tx, id, now) {
		return !!(await markServiceQueueItemReopened(tx, id, now))
	},
	touch: (tx, id, now) => touchServiceQueueItem(tx, id, now),
	async setSourceStatus(tx, item, status, note) {
		const id = numericSourceId(item.sourceId)
		if (id === null) return false
		if (item.itemType === 'report')
			return !!(await setReportStatus(tx, id, status === 'open' ? 'open' : 'resolved'))
		if (item.itemType === 'match_conflict')
			return !!(await setMatchConflictStatus(tx, id, status === 'open' ? 'open' : 'resolved', note))
		if (item.itemType === 'forfeit_reconciliation')
			return !!(await setForfeitFlagStatus(tx, id, status === 'resolved' ? 'dismissed' : status, note))
		return true
	},
	recordEvent: (tx, event) => recordItemEvent(tx, event),
	insertBan: (tx, ban) => insertBan(ban, tx),
	liftBan: (tx, playerId, banId, liftedBy) => liftBan(playerId, banId, liftedBy, tx),
	insertWarning: (tx, warning) => insertWarning(tx, warning),
	recordStaffAction: (tx, entry) => recordStaffAction(tx, entry),

	banInNakama: (ban) => banInNakama(ban),
	liftBanInNakama: (playerId, banId) => liftBanInNakama(playerId, banId),
	notifyWarned: (playerId, payload) => notifyWarnedInNakama(playerId, payload),
	async rescore(item, playerIds) {
		try {
			for (const playerId of new Set(playerIds)) await rescoreSubject(playerId)
			const fresh = await getServiceQueueItemById(item.id)
			if (fresh && fresh.status === 'open') await rescoreAfterChange(fresh)
		} catch (err) {
			console.error('[service-queue] Rescoring failed:', err)
		}
	},
}

export const serviceQueueDispatcher = createDispatcher(deps)

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

export async function claim(
	itemId: number,
	staff: { playerId: string; role: StaffRole },
	now: Date = new Date(),
): Promise<QueueResult<ServiceQueueItemRecord>> {
	const item = await getServiceQueueItemById(itemId)
	if (!item) return refuse({ code: 'not_found' })
	const decision = decideClaim(item, staff.playerId, now)
	if (decision.kind === 'closed') return refuse({ code: 'wrong_status', status: item.status })
	if (decision.kind === 'held')
		return refuse({ code: 'claimed', claimedBy: decision.claimedBy, claimedUntil: decision.claimedUntil })
	const actor = actorOf(staff.role, staff.playerId)
	const claimed = await claimItem(itemId, actor, staff.playerId, decision.until, now)
	if (!claimed) {
		// Someone claimed it between the read and the update.
		const fresh = await getServiceQueueItemById(itemId)
		return refuse({ code: 'claimed', claimedBy: fresh?.claimedBy ?? 'unknown', claimedUntil: fresh?.claimedUntil ?? null })
	}
	// One event per claim, not per refresh.
	if (item.claimedBy !== actor || !item.claimedUntil || item.claimedUntil <= now)
		await recordItemEvent(db, { itemId, kind: 'claimed', actor, detail: { until: decision.until } })
	return { ok: true, value: claimed }
}

export async function release(
	itemId: number,
	staff: { playerId: string; role: StaffRole },
	force: boolean,
	now: Date = new Date(),
): Promise<QueueResult<ServiceQueueItemRecord>> {
	const item = await getServiceQueueItemById(itemId)
	if (!item) return refuse({ code: 'not_found' })
	if (force && staff.role !== 'admin') return refuse({ code: 'forbidden' })
	const decision = decideRelease(item, staff.playerId, force, now)
	if (decision.kind === 'held')
		return refuse({ code: 'claimed', claimedBy: decision.claimedBy, claimedUntil: item.claimedUntil })
	if (decision.kind === 'unclaimed') return { ok: true, value: item }
	const released = await releaseItem(itemId)
	await recordItemEvent(db, {
		itemId,
		kind: 'released',
		actor: actorOf(staff.role, staff.playerId),
		detail: force ? { forced: true, from: item.claimedBy } : null,
	})
	return { ok: true, value: released ?? item }
}

// Dismisses all of a player's open automatic items with one reason.
export const dismissAutomaticItemsOf = (playerId: string, staff: { playerId: string; role: StaffRole }, reason: string) =>
	dismissAutomaticItems(
		{
			openItemIds: openAutomaticItemIds,
			async run(itemId, action, who, body) {
				const result = await serviceQueueDispatcher.run(itemId, action, who, body)
				return result.ok ? { ok: true } : { ok: false, code: result.refusal.code }
			},
		},
		playerId,
		staff,
		reason,
	)
