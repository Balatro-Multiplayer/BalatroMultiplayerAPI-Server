import { Router } from 'express'
import type { Response } from 'express'
import { db } from '../../infrastructure/db/index.js'
import {
	type QueueSort,
	type QueueStatusFilter,
	actorNames,
	getServiceQueueItemById,
	isServiceQueueItemType,
	listAutomaticGroups,
	listItemEvents,
	listServiceQueueItems,
	openCountsByType,
	recordItemEvent,
	viewedSince,
} from '../../infrastructure/gateways/service-queue.gateway.js'
import { decisionsFor } from '../appeals/appeal-rules.js'
import { appealService } from '../appeals/appeals.deps.js'
import { MAX_PAGE, queryInt } from '../../shared/utils/query-int.js'
import { activeClaimant } from '../service-queue/claim.js'
import { evidenceOf, subjectCard } from '../service-queue/evidence/assemble.js'
import type { QueueLane } from '../service-queue/lanes.js'
import { allowedActionsFor } from '../service-queue/permissions.js'
import { claim, dismissAutomaticItemsOf, release, serviceQueueDispatcher } from '../service-queue/queue.service.js'
import { type QueueRefusal, httpOf } from '../service-queue/refusals.js'
import { staffOf } from '../service-queue/staff.js'
import { targetsOf } from '../service-queue/targets.js'
import { type ItemStatus, type ItemType, actorOf, isItemType } from '../service-queue/types.js'

// The moderator service queue (Q-api.md documents every route and shape).
const router = Router()

// A detail view is recorded once per staff member per this window.
const VIEW_WINDOW_MS = 10 * 60 * 1000

function sendRefusal(res: Response, refusal: QueueRefusal) {
	const { status, body } = httpOf(refusal)
	res.status(status).json(body)
}

function itemIdOf(raw: string): number | null {
	const id = Number(raw)
	return Number.isInteger(id) && id > 0 ? id : null
}

function claimOf(item: { claimedBy: string | null; claimedUntil: Date | null }, now: Date, names: Record<string, string> = {}) {
	const holder = activeClaimant(item, now)
	return holder ? { claimedBy: holder, claimedByName: names[holder] ?? null, claimedUntil: item.claimedUntil } : null
}

// A claim with its holder's name, for "Being handled by X".
async function namedClaimOf(item: { claimedBy: string | null; claimedUntil: Date | null }, now: Date) {
	return claimOf(item, now, await actorNames([item.claimedBy]))
}

// A refusal; a 'claimed' one also names who holds the claim.
async function sendNamedRefusal(res: Response, refusal: QueueRefusal) {
	if (refusal.code !== 'claimed') return sendRefusal(res, refusal)
	const { status, body } = httpOf(refusal)
	const names = await actorNames([refusal.claimedBy])
	res.status(status).json({ ...body, claimedByName: names[refusal.claimedBy] ?? null })
}

// Who a target-taking action may be aimed at, from the item's evidence (a
// report's two players, a conflict's two reporters, a contest's two players, otherwise the subject).
function targetsFor(item: { itemType: string; subjectPlayerId: string | null }, evidence: unknown) {
	const ev = (evidence ?? {}) as {
		report?: { reporterId: string; reportedId: string }
		conflict?: { firstReporterId: string; conflictingReporterId: string }
		contest?: { contesterId: string; againstId: string | null }
	}
	return targetsOf({
		itemType: item.itemType,
		subjectPlayerId: item.subjectPlayerId,
		report: ev.report ?? null,
		conflict: ev.conflict ?? null,
		contest: ev.contest ?? null,
	})
}

const STATUS_FILTERS: readonly QueueStatusFilter[] = ['open', 'resolved', 'all']

router.get('/service-queue', async (req, res, next) => {
	try {
		const page = queryInt(req.query.page, 1, 1, MAX_PAGE)
		const limit = queryInt(req.query.limit, 50, 1, 100)
		const itemType = isServiceQueueItemType(req.query.itemType) ? req.query.itemType : undefined
		// Unfiltered (the old default) is every status.
		const status = STATUS_FILTERS.find((s) => s === req.query.status) ?? 'all'
		const lane: QueueLane | undefined =
			req.query.lane === 'main' || req.query.lane === 'automatic' ? req.query.lane : undefined
		const sort: QueueSort = req.query.sort === 'age' ? 'age' : 'priority'
		const subject =
			typeof req.query.subject === 'string' && req.query.subject.trim() ? req.query.subject.trim() : undefined
		const olderThanHours = queryInt(req.query.olderThanHours, 0, 0, 24 * 365)
		const claimedByMe = req.query.claimedByMe === '1' || req.query.claimedByMe === 'true'
		const now = new Date()

		const [{ items, total }, counts] = await Promise.all([
			listServiceQueueItems({
				page,
				limit,
				itemType,
				lane,
				status,
				subject,
				claimedBy: claimedByMe ? req.player!.playerId : undefined,
				olderThanMs: olderThanHours > 0 ? olderThanHours * 60 * 60 * 1000 : undefined,
				sort,
				now,
			}),
			openCountsByType(),
		])
		const names = await actorNames(items.map((item) => activeClaimant(item, now)))
		res.json({
			items: items.map((item) => ({ ...item, claim: claimOf(item, now, names) })),
			total,
			page,
			limit,
			pages: Math.ceil(total / limit),
			counts,
		})
	} catch (err) {
		next(err)
	}
})

// The Automatic tab: one row per player with open anti-cheat or integrity items.
router.get('/service-queue/automatic', async (_req, res, next) => {
	try {
		res.json({ groups: await listAutomaticGroups() })
	} catch (err) {
		next(err)
	}
})

// Dismisses all of one player's open automatic items with one reason.
router.post('/service-queue/automatic/:playerId/dismiss', async (req, res, next) => {
	try {
		const staff = await staffOf(req)
		if (!staff) return sendRefusal(res, { code: 'forbidden' })
		const reason = typeof req.body?.reason === 'string' ? req.body.reason : ''
		const result = await dismissAutomaticItemsOf(req.params.playerId, staff, reason)
		if (!result.ok) return res.status(400).json({ error: 'A reason is required', code: result.error })
		console.log(
			`[webadmin] ${staff.role}:${staff.playerId} dismissed ${result.dismissed} automatic items of ${req.params.playerId}`,
		)
		res.json(result)
	} catch (err) {
		next(err)
	}
})

router.get('/service-queue/:id', async (req, res, next) => {
	try {
		const id = itemIdOf(req.params.id)
		if (id === null) return sendRefusal(res, { code: 'not_found' })
		const staff = await staffOf(req)
		if (!staff) return sendRefusal(res, { code: 'forbidden' })
		const item = await getServiceQueueItemById(id)
		if (!item || !isItemType(item.itemType)) return sendRefusal(res, { code: 'not_found' })

		const now = new Date()
		const [subject, evidence] = await Promise.all([subjectCard(item.subjectPlayerId, item, now), evidenceOf(item, now)])
		const actor = actorOf(staff.role, staff.playerId)
		if (!(await viewedSince(item.id, actor, new Date(now.getTime() - VIEW_WINDOW_MS))))
			await recordItemEvent(db, { itemId: item.id, kind: 'viewed', actor })

		res.json({
			item,
			subject,
			evidence,
			allowedActions: allowedActionsFor(
				{ itemType: item.itemType as ItemType, status: item.status as ItemStatus },
				staff.role,
			),
			role: staff.role,
			// What this staff member may decide on an appeal (the appeal's own buttons).
			appealDecisions:
				item.itemType === 'appeal'
					? decisionsFor(staff, (evidence as { punishment?: { issuedBy?: string } | null } | null)?.punishment?.issuedBy ?? null)
					: undefined,
			claim: await namedClaimOf(item, now),
			targets: targetsFor(item, evidence),
		})
	} catch (err) {
		next(err)
	}
})

router.get('/service-queue/:id/events', async (req, res, next) => {
	try {
		const id = itemIdOf(req.params.id)
		if (id === null) return sendRefusal(res, { code: 'not_found' })
		const item = await getServiceQueueItemById(id)
		if (!item) return sendRefusal(res, { code: 'not_found' })
		const events = await listItemEvents(id)
		res.json({ events, actorNames: await actorNames(events.map((e) => e.actor)) })
	} catch (err) {
		next(err)
	}
})

router.post('/service-queue/:id/claim', async (req, res, next) => {
	try {
		const id = itemIdOf(req.params.id)
		if (id === null) return sendRefusal(res, { code: 'not_found' })
		const staff = await staffOf(req)
		if (!staff) return sendRefusal(res, { code: 'forbidden' })
		const result = await claim(id, staff)
		if (!result.ok) return sendNamedRefusal(res, result.refusal)
		res.json({ item: result.value, claim: await namedClaimOf(result.value, new Date()) })
	} catch (err) {
		next(err)
	}
})

router.delete('/service-queue/:id/claim', async (req, res, next) => {
	try {
		const id = itemIdOf(req.params.id)
		if (id === null) return sendRefusal(res, { code: 'not_found' })
		const staff = await staffOf(req)
		if (!staff) return sendRefusal(res, { code: 'forbidden' })
		const force = req.query.force === '1' || req.query.force === 'true'
		const result = await release(id, staff, force)
		if (!result.ok) return sendRefusal(res, result.refusal)
		res.json({ item: result.value, claim: claimOf(result.value, new Date()) })
	} catch (err) {
		next(err)
	}
})

// Decides an appeal: deny, or grant by lifting or shortening (appeals.service.ts).
router.post('/service-queue/:id/appeal', async (req, res, next) => {
	try {
		const id = itemIdOf(req.params.id)
		if (id === null) return sendRefusal(res, { code: 'not_found' })
		const staff = await staffOf(req)
		if (!staff) return sendRefusal(res, { code: 'forbidden' })
		const result = await appealService.decide(id, staff, (req.body ?? {}) as Record<string, unknown>)
		if (!result.ok) return sendNamedRefusal(res, result.refusal)
		console.log(`[webadmin] ${staff.role}:${staff.playerId} decided appeal item ${id}: ${result.value.appeal.status}`)
		res.json({ appeal: result.value.appeal })
	} catch (err) {
		next(err)
	}
})

router.post('/service-queue/:id/actions/:action', async (req, res, next) => {
	try {
		const id = itemIdOf(req.params.id)
		if (id === null) return sendRefusal(res, { code: 'not_found' })
		const staff = await staffOf(req)
		if (!staff) return sendRefusal(res, { code: 'forbidden' })
		const result = await serviceQueueDispatcher.run(
			id,
			req.params.action,
			staff,
			(req.body ?? {}) as Record<string, unknown>,
		)
		if (!result.ok) return sendNamedRefusal(res, result.refusal)
		const { item, action, effects } = result.value
		console.log(`[webadmin] ${staff.role}:${staff.playerId} ran service-queue action '${action}' on item ${id}`)
		res.json({
			item,
			action,
			effects,
			allowedActions: allowedActionsFor(
				{ itemType: item.itemType as ItemType, status: item.status as ItemStatus },
				staff.role,
			),
		})
	} catch (err) {
		next(err)
	}
})

export default router
