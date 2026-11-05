import { Router } from 'express'
import { authenticateActive } from '../../middleware/authenticate-active.js'
import { AppError } from '../../shared/utils/errors.js'
import type { ReportPageRefusal, ReportPageResult, ReportPageService } from './report-page.service.js'

const REFUSALS: Readonly<Record<ReportPageRefusal, { status: number; message: string }>> = {
	not_found: { status: 404, message: 'Report not found' },
	forbidden: { status: 403, message: 'Not the reporter of this report' },
	decided: { status: 409, message: 'Staff already decided this report' },
	already_withdrawn: { status: 409, message: 'This report was already withdrawn' },
	invalid_detail: { status: 400, message: 'Invalid additionalDetail (max 2000 characters)' },
}

function valueOf<T>(result: ReportPageResult<T>): T {
	if (result.ok) return result.value
	const { status, message } = REFUSALS[result.refusal]
	throw new AppError(message, status)
}

// The reporter's own report page (ADR 0011): ownership-checked against
// reporterId, not the webadmin privilege gate. There is no list and no plain
// read: the page opens once, and a later open only says "Submitted".
export function createReportsRouter(service: ReportPageService): Router {
	const router = Router()
	router.use(authenticateActive)

	const idOf = (raw: string): number => {
		const id = Number(raw)
		if (!Number.isInteger(id)) throw new AppError('Invalid report id', 400)
		return id
	}

	router.post('/:id/open', async (req, res, next) => {
		try {
			res.json({ page: valueOf(await service.open(idOf(req.params.id), req.player!.playerId)) })
		} catch (err) {
			next(err)
		}
	})

	router.patch('/:id', async (req, res, next) => {
		try {
			valueOf(await service.addDetail(idOf(req.params.id), req.player!.playerId, req.body?.additionalDetail))
			res.json({ ok: true })
		} catch (err) {
			next(err)
		}
	})

	router.post('/:id/withdraw', async (req, res, next) => {
		try {
			valueOf(await service.withdraw(idOf(req.params.id), req.player!.playerId))
			res.json({ ok: true })
		} catch (err) {
			next(err)
		}
	})

	return router
}
