import { Router } from 'express'
import { listMatchConflicts, resolveMatchConflict } from '../../infrastructure/gateways/match-conflict.gateway.js'

const router = Router()

router.get('/match-conflicts', async (req, res, next) => {
	try {
		const page = Math.max(1, Number(req.query.page ?? 1))
		const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)))
		const { conflicts, total } = await listMatchConflicts(page, limit)
		res.json({ conflicts, total, page, limit, pages: Math.ceil(total / limit) })
	} catch (err) {
		next(err)
	}
})

router.patch('/match-conflicts/:id/resolve', async (req, res, next) => {
	try {
		const id = Number(req.params.id)
		if (!Number.isInteger(id)) {
			res.status(400).json({ error: 'Invalid conflict id' })
			return
		}

		const { resolutionNotes } = req.body as { resolutionNotes?: unknown }
		if (resolutionNotes !== undefined && typeof resolutionNotes !== 'string') {
			res.status(400).json({ error: 'resolutionNotes must be a string' })
			return
		}

		const updated = await resolveMatchConflict(id, resolutionNotes)
		if (!updated) {
			res.status(404).json({ error: 'Conflict not found' })
			return
		}
		res.json({ conflict: updated })
	} catch (err) {
		next(err)
	}
})

export default router
