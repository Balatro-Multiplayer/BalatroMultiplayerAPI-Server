import { resolveReport } from '../../infrastructure/gateways/report.gateway.js'
import { resolveMatchConflict } from '../../infrastructure/gateways/match-conflict.gateway.js'
import {
	dismissForfeitReconciliationFlag,
	voidForfeitReconciliationFlag,
} from '../../infrastructure/gateways/forfeit-reconciliation.gateway.js'
import { isBanType } from '../../infrastructure/gateways/ban.gateway.js'
import {
	getServiceQueueItemById,
	markServiceQueueItemResolved,
	type ServiceQueueItemRecord,
	type ServiceQueueItemType,
} from '../../infrastructure/gateways/service-queue.gateway.js'
import { AppError } from '../../shared/utils/errors.js'
import { parseExpiresAt } from '../../shared/utils/parse-expires-at.js'
import { issueBan } from './ban.service.js'

export interface QueueActionResult {
	queueItem: ServiceQueueItemRecord
	// The updated/underlying source-table row, if any -- returned so the
	// route can pass it straight back to the client without a second detail
	// fetch.
	sourceRecord?: unknown
}

type QueueActionFn = (
	item: ServiceQueueItemRecord,
	actingPlayerId: string,
	body: Record<string, unknown>,
) => Promise<QueueActionResult>

function notesFromBody(body: Record<string, unknown>): string | undefined {
	return typeof body.resolutionNotes === 'string' ? body.resolutionNotes : undefined
}

async function resolveReportAction(
	item: ServiceQueueItemRecord,
	actingPlayerId: string,
): Promise<QueueActionResult> {
	const updated = await resolveReport(Number(item.sourceId))
	if (!updated) throw new AppError('Report not found', 404)
	const queueItem = await markServiceQueueItemResolved(item.id, `moderator:${actingPlayerId}`, 'resolve')
	if (!queueItem) throw new AppError('Queue item not found', 404)
	return { queueItem, sourceRecord: updated }
}

async function resolveMatchConflictAction(
	item: ServiceQueueItemRecord,
	actingPlayerId: string,
	body: Record<string, unknown>,
): Promise<QueueActionResult> {
	const updated = await resolveMatchConflict(Number(item.sourceId), notesFromBody(body))
	if (!updated) throw new AppError('Match conflict not found', 404)
	const queueItem = await markServiceQueueItemResolved(item.id, `moderator:${actingPlayerId}`, 'resolve')
	if (!queueItem) throw new AppError('Queue item not found', 404)
	return { queueItem, sourceRecord: updated }
}

async function dismissForfeitFlagAction(
	item: ServiceQueueItemRecord,
	actingPlayerId: string,
	body: Record<string, unknown>,
): Promise<QueueActionResult> {
	const updated = await dismissForfeitReconciliationFlag(Number(item.sourceId), notesFromBody(body))
	if (!updated) throw new AppError('Forfeit reconciliation flag not found', 404)
	const queueItem = await markServiceQueueItemResolved(item.id, `moderator:${actingPlayerId}`, 'dismiss')
	if (!queueItem) throw new AppError('Queue item not found', 404)
	return { queueItem, sourceRecord: updated }
}

async function voidForfeitFlagAction(
	item: ServiceQueueItemRecord,
	actingPlayerId: string,
	body: Record<string, unknown>,
): Promise<QueueActionResult> {
	const updated = await voidForfeitReconciliationFlag(Number(item.sourceId), notesFromBody(body))
	if (!updated) throw new AppError('Forfeit reconciliation flag not found', 404)
	const queueItem = await markServiceQueueItemResolved(item.id, `admin:${actingPlayerId}`, 'void')
	if (!queueItem) throw new AppError('Queue item not found', 404)
	return { queueItem, sourceRecord: updated }
}

async function dismissFlaggedChatAction(
	item: ServiceQueueItemRecord,
	actingPlayerId: string,
): Promise<QueueActionResult> {
	// flaggedMessages has no status column (see schema.ts's rationale) --
	// nothing to write on the source table, only the index row.
	const queueItem = await markServiceQueueItemResolved(item.id, `moderator:${actingPlayerId}`, 'dismiss')
	if (!queueItem) throw new AppError('Queue item not found', 404)
	return { queueItem }
}

async function dismissAntiCheatAction(
	item: ServiceQueueItemRecord,
	actingPlayerId: string,
): Promise<QueueActionResult> {
	// matchRunLogs has no separate review-status column either -- same shape
	// as dismissFlaggedChatAction.
	const queueItem = await markServiceQueueItemResolved(item.id, `moderator:${actingPlayerId}`, 'dismiss')
	if (!queueItem) throw new AppError('Queue item not found', 404)
	return { queueItem }
}

async function banFromQueueItemAction(
	item: ServiceQueueItemRecord,
	actingPlayerId: string,
	body: Record<string, unknown>,
): Promise<QueueActionResult> {
	const { banType, expiresAt, reason } = body as { banType?: unknown; expiresAt?: unknown; reason?: unknown }
	if (!isBanType(banType)) throw new AppError("banType must be 'chat', 'queue', or 'account'", 400)
	if (!item.subjectPlayerId) throw new AppError('This item has no associated player to ban', 400)

	const ban = await issueBan({
		playerId: item.subjectPlayerId,
		banType,
		expiresAt: parseExpiresAt(expiresAt),
		reason: typeof reason === 'string' ? reason : '',
		issuedBy: `admin:${actingPlayerId}`,
	})
	const queueItem = await markServiceQueueItemResolved(item.id, `admin:${actingPlayerId}`, `ban_${banType}`)
	if (!queueItem) throw new AppError('Queue item not found', 404)
	return { queueItem, sourceRecord: ban }
}

// action key -> item type -> handler. A given actionKey is only valid for
// the item types listed here; dispatchServiceQueueAction 400s if actionKey
// isn't registered for the item's actual itemType. This registry (plus the
// PATCH /service-queue/:id/actions/:actionKey surface it backs) is the seam
// a future Discord bot's interaction handler would reuse -- calling
// dispatchServiceQueueAction directly, or hitting the same HTTP route.
const ACTIONS: Partial<Record<string, Partial<Record<ServiceQueueItemType, QueueActionFn>>>> = {
	resolve: {
		report: resolveReportAction,
		match_conflict: resolveMatchConflictAction,
	},
	dismiss: {
		flagged_chat: dismissFlaggedChatAction,
		forfeit_reconciliation: dismissForfeitFlagAction,
		anti_cheat: dismissAntiCheatAction,
	},
	void: {
		forfeit_reconciliation: voidForfeitFlagAction,
	},
	// One generic ban handler reused across the 3 types with a clear single
	// accused player (item.subjectPlayerId). match_conflict/
	// forfeit_reconciliation are deliberately excluded -- neither implicates
	// a single misbehaving player.
	ban: {
		report: banFromQueueItemAction,
		flagged_chat: banFromQueueItemAction,
		anti_cheat: banFromQueueItemAction,
	},
}

// Destructive actions require the stricter admin-only gate (mirrors
// config.route.ts's requireAdmin precedent) -- everything else only needs
// the router-level admin-or-moderator webAdmin gate.
export const DESTRUCTIVE_ACTION_KEYS = new Set(['ban', 'void'])

export async function dispatchServiceQueueAction(
	itemId: number,
	actionKey: string,
	actingPlayerId: string,
	body: Record<string, unknown>,
): Promise<QueueActionResult> {
	const item = await getServiceQueueItemById(itemId)
	if (!item) throw new AppError('Queue item not found', 404)
	const fn = ACTIONS[actionKey]?.[item.itemType as ServiceQueueItemType]
	if (!fn) {
		throw new AppError(`Action '${actionKey}' is not valid for item type '${item.itemType}'`, 400)
	}
	return fn(item, actingPlayerId, body)
}
