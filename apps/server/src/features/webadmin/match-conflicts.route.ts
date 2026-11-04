import { Router } from 'express'
import {
	listMatchConflicts,
} from '../../infrastructure/gateways/match-conflict.gateway.js'
import { MAX_PAGE, queryInt } from '../../shared/utils/query-int.js'

const router = Router()

router.get('/match-conflicts', async (req, res, next) => {
	try {
		const page = queryInt(req.query.page, 1, 1, MAX_PAGE)
		const limit = queryInt(req.query.limit, 50, 1, 100)
		const { conflicts, total } = await listMatchConflicts(page, limit)
		res.json({ conflicts, total, page, limit, pages: Math.ceil(total / limit) })
	} catch (err) {
		next(err)
	}
})

export default router
