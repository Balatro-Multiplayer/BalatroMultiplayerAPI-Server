import { Router } from 'express'
import {
	dismissForfeitReconciliationFlag,
	listForfeitReconciliationFlags,
	voidForfeitReconciliationFlag,
} from '../../infrastructure/gateways/forfeit-reconciliation.gateway.js'

const router = Router()

router.get('/forfeit-reconciliation', async (req, res, next) => {
	try {
		const page = Math.max(1, Number(req.query.page ?? 1))
		const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)))
		const { flags, total } = await listForfeitReconciliationFlags(page, limit)
		res.json({ flags, total, page, limit, pages: Math.ceil(total / limit) })
	} catch (err) {
		next(err)
	}
})

router.patch('/forfeit-reconciliation/:id/void', async (req, res, next) => {
	try {
		const id = Number(req.params.id)
		if (!Number.isInteger(id)) {
			res.status(400).json({ error: 'Invalid flag id' })
			return
		}

		const { resolutionNotes } = req.body as { resolutionNotes?: unknown }
		if (resolutionNotes !== undefined && typeof resolutionNotes !== 'string') {
			res.status(400).json({ error: 'resolutionNotes must be a string' })
			return
		}

		const updated = await voidForfeitReconciliationFlag(id, resolutionNotes)
		if (!updated) {
			res.status(404).json({ error: 'Flag not found' })
			return
		}
		res.json({ flag: updated })
	} catch (err) {
		next(err)
	}
})

router.patch('/forfeit-reconciliation/:id/dismiss', async (req, res, next) => {
	try {
		const id = Number(req.params.id)
		if (!Number.isInteger(id)) {
			res.status(400).json({ error: 'Invalid flag id' })
			return
		}

		const { resolutionNotes } = req.body as { resolutionNotes?: unknown }
		if (resolutionNotes !== undefined && typeof resolutionNotes !== 'string') {
			res.status(400).json({ error: 'resolutionNotes must be a string' })
			return
		}

		const updated = await dismissForfeitReconciliationFlag(id, resolutionNotes)
		if (!updated) {
			res.status(404).json({ error: 'Flag not found' })
			return
		}
		res.json({ flag: updated })
	} catch (err) {
		next(err)
	}
})

export default router
