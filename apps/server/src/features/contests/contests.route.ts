import { Router } from 'express'
import { authenticateActive } from '../../middleware/authenticate-active.js'
import { AppError } from '../../shared/utils/errors.js'
import type { ContestPageRefusal, ContestPageResult, ContestPageService } from './contest-page.service.js'

const REFUSALS: Readonly<Record<ContestPageRefusal, { status: number; message: string }>> = {
	not_found: { status: 404, message: 'Contest not found' },
	decided: { status: 409, message: 'Staff already decided this match' },
	already_withdrawn: { status: 409, message: 'This Contest was already withdrawn' },
	invalid_input: { status: 400, message: 'Invalid reason or detail (detail is at most 2000 characters)' },
	match_running: { status: 409, message: 'The match is not over yet. Withdraw once it has ended.' },
	forfeit_failed: { status: 502, message: 'The forfeit could not be recorded. Try again.' },
}

function valueOf<T>(result: ContestPageResult<T>): T {
	if (result.ok) return result.value
	const { status, message } = REFUSALS[result.refusal]
	throw new AppError(message, status)
}

const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// The contester's own Contest page (ADR 0011): the Contest is found by the
// match and the logged-in player, so nobody else's is reachable. There is no
// list and no plain read: the page opens once, and a later open only says
// "Submitted".
export function createContestsRouter(service: ContestPageService): Router {
	const router = Router()
	router.use(authenticateActive)

	const runIdOf = (raw: string): string => {
		if (!RUN_ID.test(raw)) throw new AppError('Invalid match id', 400)
		return raw
	}

	router.post('/:runId/open', async (req, res, next) => {
		try {
			res.json({ page: valueOf(await service.open(runIdOf(req.params.runId), req.player!.playerId)) })
		} catch (err) {
			next(err)
		}
	})

	router.patch('/:runId', async (req, res, next) => {
		try {
			valueOf(await service.save(runIdOf(req.params.runId), req.player!.playerId, req.body?.reason, req.body?.detail))
			res.json({ ok: true })
		} catch (err) {
			next(err)
		}
	})

	router.post('/:runId/withdraw', async (req, res, next) => {
		try {
			valueOf(await service.withdraw(runIdOf(req.params.runId), req.player!.playerId))
			res.json({ ok: true })
		} catch (err) {
			next(err)
		}
	})

	return router
}
