import { Router } from 'express'
import {
	type RunQueueItem,
	findRunMatch,
	findRunRatings,
	findRunWindow,
	listQueueItemsAboutRun,
	listRunChat,
	listStaffActionsForRun,
} from '../../infrastructure/gateways/match-staff.gateway.js'
import { AppError } from '../../shared/utils/errors.js'
import { activeClaimant } from '../service-queue/claim.js'
import { staffOf } from '../service-queue/staff.js'

// The staff-only parts of the public match page. The whole webadmin router
// already refuses anyone without a staff role; each route checks it again so
// it never answers a player.
const router = Router()

interface Placement {
	playerId: string
	place: number
}

const placementsOf = (value: unknown): Placement[] =>
	Array.isArray(value)
		? (value as Placement[]).filter(
				(p) => typeof p?.playerId === 'string' && Number.isInteger(p.place),
			)
		: []

// Whose claim an item carries, as the viewer sees it.
function claimOf(
	item: RunQueueItem,
	viewerId: string,
	now: Date,
): 'you' | 'other' | null {
	const holder = activeClaimant(item, now)
	if (!holder) return null
	return holder.slice(holder.indexOf(':') + 1) === viewerId ? 'you' : 'other'
}

// The match, its result with rating changes, the queue items about it and the
// staff actions taken on it.
router.get('/matches/:runId/staff', async (req, res, next) => {
	try {
		const staff = await staffOf(req)
		if (!staff) throw new AppError('Forbidden', 403)
		const runId = String(req.params.runId)
		const run = await findRunWindow(runId)
		if (!run) throw new AppError('Run not found', 404)

		const [match, items] = await Promise.all([
			findRunMatch(runId),
			listQueueItemsAboutRun(runId, staff.role),
		])
		const placements = match ? placementsOf(match.resultPlacements) : []
		const [ratings, actions] = await Promise.all([
			findRunRatings(
				runId,
				placements.map((p) => p.playerId),
			),
			listStaffActionsForRun(
				staff,
				runId,
				items.map((i) => i.id),
			),
		])
		const now = new Date()
		res.json({
			match: match && {
				gameMode: match.gameMode,
				modId: match.modId,
				status: match.status,
			},
			result: match
				? [...placements]
						.sort((a, b) => a.place - b.place)
						.map((p) => ({
							playerId: p.playerId,
							displayName: match.playerNames[p.playerId] ?? null,
							place: p.place,
							delta: ratings.get(p.playerId)?.delta ?? null,
							newRating: ratings.get(p.playerId)?.newRating ?? null,
							isPlacement: ratings.get(p.playerId)?.isPlacement ?? false,
						}))
				: null,
			queueItems: items.map((i) => ({
				id: i.id,
				itemType: i.itemType,
				status: i.status,
				summary: i.summary,
				createdAt: i.createdAt,
				claim: claimOf(i, staff.playerId, now),
			})),
			staffActions: actions,
			viewer: { role: staff.role },
		})
	} catch (err) {
		next(err)
	}
})

// The lobby's chat lines inside the match's time window.
router.get('/matches/:runId/chat', async (req, res, next) => {
	try {
		const staff = await staffOf(req)
		if (!staff) throw new AppError('Forbidden', 403)
		const run = await findRunWindow(String(req.params.runId))
		if (!run) throw new AppError('Run not found', 404)
		const lines = await listRunChat(run, new Date())
		res.json({
			lines,
			window: { from: run.startedAt, to: run.finalizedAt },
		})
	} catch (err) {
		next(err)
	}
})

export default router
