// What the match page's Void and Set result do to the service queue: who may
// edit a match, how a void closes the open items about it, and the moderator's
// "Report to admins". The match edit itself is features/ratings/match-edit.
import {
	hasOpenItemVisibleTo,
	listOpenItemsAboutRun,
} from '../../infrastructure/gateways/match-staff.gateway.js'
import type { DbTransaction } from '../../infrastructure/db/executor.js'
import {
	enqueueServiceQueueItem,
	markServiceQueueItemResolved,
	recordItemEvent,
} from '../../infrastructure/gateways/service-queue.gateway.js'
import { staffReportSourceId } from '../../shared/service-queue/source-ids.js'
import { setSourceStatusOf } from './queue.service.js'
import { type ItemType, type StaffRole, actorOf } from './types.js'
import { sourceStatusFor } from './transitions.js'

export interface OpenItem {
	id: number
	itemType: string
	sourceId: string
	subjectPlayerId: string | null
	status: string
	claimedBy: string | null
	claimedUntil: Date | null
}

export interface MatchItemsDeps<Tx> {
	// Whether the role sees an open item about the run; with tx, as of that transaction.
	hasOpenItemFor(runId: string, role: StaffRole, tx?: Tx): Promise<boolean>
	openItems(tx: Tx, runId: string): Promise<OpenItem[]>
	markResolved(
		tx: Tx,
		itemId: number,
		actor: string,
		note: string,
		now: Date,
	): Promise<boolean>
	setSourceStatus(
		tx: Tx,
		item: OpenItem,
		status: 'voided' | 'resolved' | 'dismissed' | 'open',
		note: string,
	): Promise<boolean>
	recordEvent(
		tx: Tx,
		event: { itemId: number; actor: string; note: string; detail: unknown },
	): Promise<void>
	enqueue(input: {
		sourceId: string
		summary: string
		context: {
			staffReport: { runId: string; reporterId: string; note: string }
		}
	}): Promise<unknown>
	now(): Date
}

// An admin edits any match. A moderator edits one only while it has an open
// queue item they see (an item for admins only does not count).
export async function mayEditMatch<Tx>(
	deps: MatchItemsDeps<Tx>,
	role: StaffRole,
	runId: string,
	tx?: Tx,
): Promise<boolean> {
	return role === 'admin' || deps.hasOpenItemFor(runId, role, tx)
}

// A void closes every open item about the match with the action "void" and
// the staff member's note. Runs in the transaction of the match edit, so the
// items close only if the void is saved.
export async function resolveItemsOfVoid<Tx>(
	deps: MatchItemsDeps<Tx>,
	tx: Tx,
	runId: string,
	staff: { playerId: string; role: StaffRole },
	note: string,
): Promise<number[]> {
	const items = await deps.openItems(tx, runId)
	const actor = actorOf(staff.role, staff.playerId)
	const now = deps.now()
	const closed: number[] = []
	for (const item of items) {
		if (!(await deps.markResolved(tx, item.id, actor, note, now))) continue
		const status = sourceStatusFor(item.itemType as ItemType, 'void')
		if (status) await deps.setSourceStatus(tx, item, status, note)
		await deps.recordEvent(tx, {
			itemId: item.id,
			actor,
			note,
			detail: { runId, from: 'match_page' },
		})
		closed.push(item.id)
	}
	return closed
}

// A moderator's note to admins about the match. Only admins see the item.
export async function reportMatchToAdmins<Tx>(
	deps: MatchItemsDeps<Tx>,
	runId: string,
	staff: { playerId: string; role: StaffRole },
	note: string,
): Promise<void> {
	await deps.enqueue({
		sourceId: staffReportSourceId(runId, deps.now()),
		summary: `Staff report on a match: ${note}`.slice(0, 200),
		context: { staffReport: { runId, reporterId: staff.playerId, note } },
	})
}

export const matchItemsDeps: MatchItemsDeps<DbTransaction> = {
	hasOpenItemFor: hasOpenItemVisibleTo,
	openItems: (tx, runId) => listOpenItemsAboutRun(tx, runId),
	async markResolved(tx, itemId, actor, note, now) {
		return !!(await markServiceQueueItemResolved(
			tx,
			itemId,
			actor,
			'void',
			note,
			now,
		))
	},
	setSourceStatus: (tx, item, status, note) =>
		setSourceStatusOf(tx, item, status, note),
	recordEvent: (tx, event) =>
		recordItemEvent(tx, { ...event, kind: 'acted', action: 'void' }),
	enqueue: (input) =>
		enqueueServiceQueueItem({ itemType: 'staff_report', ...input }),
	now: () => new Date(),
}
