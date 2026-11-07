import { Router } from 'express'
import { listForfeitReconciliationFlags } from '../../infrastructure/gateways/forfeit-reconciliation.gateway.js'
import { MAX_PAGE, queryInt } from '../../shared/utils/query-int.js'

const router = Router()

router.get('/forfeit-reconciliation', async (req, res, next) => {
	try {
		const page = queryInt(req.query.page, 1, 1, MAX_PAGE)
		const limit = queryInt(req.query.limit, 50, 1, 100)
		const { flags, total } = await listForfeitReconciliationFlags(page, limit)
		res.json({ flags, total, page, limit, pages: Math.ceil(total / limit) })
	} catch (err) {
		next(err)
	}
})

export default router
