import { Router } from 'express'
import type { Response } from 'express'
import { recordStaffAction } from '../../infrastructure/gateways/staff-log.gateway.js'
import { parseReason } from '../../shared/staff-log/actions.js'
import { AppError } from '../../shared/utils/errors.js'
import { requireRole } from '../../shared/utils/staff-role.js'
import { matchEditorFor } from '../ratings/match-edit.deps.js'
import type {
	EditedPlacement,
	MatchEditOutcome,
	MatchEditRequest,
} from '../ratings/match-edit.service.js'

// An admin sets or voids the result of any stored match from its match page.
// Moderators do the same only from a queue item (service-queue.route.ts).
// Either way only that match's players' ratings move (ADR 0010).
const router = Router()

export function parsePlacements(value: unknown): EditedPlacement[] | null {
	if (!Array.isArray(value) || value.length < 2) return null
	const out: EditedPlacement[] = []
	for (const entry of value) {
		const { playerId, place } = (entry ?? {}) as {
			playerId?: unknown
			place?: unknown
		}
		if (
			typeof playerId !== 'string' ||
			typeof place !== 'number' ||
			!Number.isInteger(place) ||
			place < 1
		)
			return null
		out.push({ playerId, place })
	}
	return new Set(out.map((p) => p.playerId)).size === out.length ? out : null
}

function send(res: Response, outcome: MatchEditOutcome) {
	switch (outcome.kind) {
		case 'edited':
			res.json({ rerated: outcome.rerated, summary: outcome.summary })
			return
		case 'not_found':
			throw new AppError('No such match', 404)
		case 'not_resolved':
			throw new AppError(
				`The match is ${outcome.status}, so it cannot be changed this way`,
				409,
			)
		case 'failed':
			throw new AppError(outcome.reason, 502)
	}
}

async function edit(
	req: Parameters<typeof requireRole>[0],
	res: Response,
	request: MatchEditRequest | null,
) {
	const role = await requireRole(req, 'admin')
	const reason = parseReason(
		(req.body as { reason?: unknown } | undefined)?.reason,
	)
	if (!reason.ok) throw new AppError(reason.message, 400)
	if (!request)
		throw new AppError(
			'placements must place at least 2 different players, each with a whole place from 1',
			400,
		)
	const staff = {
		playerId: (req.player as { playerId: string }).playerId,
		role,
	}
	const matchId = String(req.params.matchId)
	const outcome = await matchEditorFor(async (tx, match, changes) => {
		await recordStaffAction(tx, {
			staff,
			action: request.kind === 'void' ? 'match_void' : 'match_result',
			reason: reason.reason,
			detail: {
				matchId,
				previous: match.resultPlacements,
				next: request.kind === 'void' ? null : request.placements,
				ratingChanges: changes,
			},
		})
	})({ runId: matchId, matchmade: true }, request)
	send(res, outcome)
}

router.post('/matches/:matchId/result', async (req, res, next) => {
	try {
		const placements = parsePlacements(
			(req.body as { placements?: unknown } | undefined)?.placements,
		)
		await edit(req, res, placements ? { kind: 'result', placements } : null)
	} catch (err) {
		next(err)
	}
})

router.post('/matches/:matchId/void', async (req, res, next) => {
	try {
		await edit(req, res, { kind: 'void' })
	} catch (err) {
		next(err)
	}
})

export default router
