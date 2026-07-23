import { Router } from 'express'
import { authenticate } from '../../middleware/authenticate.js'
import { AppError } from '../../shared/utils/errors.js'
import { getReportById, setAdditionalDetail } from '../../infrastructure/gateways/report.gateway.js'

// Submitter-scoped report access (§15.5): ownership-checked against
// reporterId, not the webadmin privilege gate -- a player reading/adding to
// their OWN report, not a moderator action. Mirrors getReplay()'s
// participant-ownership pattern (replay-log.service.ts).
export function createReportsRouter(): Router {
	const router = Router()
	router.use(authenticate)

	router.get('/:id', async (req, res, next) => {
		try {
			const id = Number(req.params.id)
			if (!Number.isInteger(id)) throw new AppError('Invalid report id', 400)

			const report = await getReportById(id)
			if (!report) throw new AppError('Report not found', 404)
			if (report.reporterId !== req.player!.playerId) {
				throw new AppError('Not the reporter of this report', 403)
			}

			res.json({ report })
		} catch (err) {
			next(err)
		}
	})

	router.patch('/:id', async (req, res, next) => {
		try {
			const id = Number(req.params.id)
			if (!Number.isInteger(id)) throw new AppError('Invalid report id', 400)

			const report = await getReportById(id)
			if (!report) throw new AppError('Report not found', 404)
			if (report.reporterId !== req.player!.playerId) {
				throw new AppError('Not the reporter of this report', 403)
			}

			const { additionalDetail } = req.body
			if (typeof additionalDetail !== 'string' || additionalDetail.length > 2000) {
				throw new AppError('Invalid additionalDetail (max 2000 characters)', 400)
			}

			const updated = await setAdditionalDetail(id, additionalDetail)
			res.json({ report: updated })
		} catch (err) {
			next(err)
		}
	})

	return router
}
