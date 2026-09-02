import { Router } from 'express'
import {
	getServiceQueueItemById,
	isServiceQueueItemType,
	listServiceQueueItems,
} from '../../infrastructure/gateways/service-queue.gateway.js'
import { AppError } from '../../shared/utils/errors.js'
import { requireAdmin } from '../../shared/utils/require-admin.js'
import { DESTRUCTIVE_ACTION_KEYS, dispatchServiceQueueAction } from './service-queue-actions.js'
import { getServiceQueueItemDetail } from './service-queue-detail.js'

const router = Router()

router.get('/service-queue', async (req, res, next) => {
	try {
		const page = Math.max(1, Number(req.query.page ?? 1))
		const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)))
		const itemType = isServiceQueueItemType(req.query.itemType) ? req.query.itemType : undefined
		const status =
			req.query.status === 'open' || req.query.status === 'resolved' ? req.query.status : undefined

		const { items, total } = await listServiceQueueItems({ page, limit, itemType, status })
		res.json({ items, total, page, limit, pages: Math.ceil(total / limit) })
	} catch (err) {
		next(err)
	}
})

router.get('/service-queue/:id', async (req, res, next) => {
	try {
		const id = Number(req.params.id)
		if (!Number.isInteger(id)) throw new AppError('Invalid id', 400)

		const item = await getServiceQueueItemById(id)
		if (!item) throw new AppError('Queue item not found', 404)

		res.json(await getServiceQueueItemDetail(item, req.player!.playerId))
	} catch (err) {
		next(err)
	}
})

router.patch('/service-queue/:id/actions/:actionKey', async (req, res, next) => {
	try {
		const id = Number(req.params.id)
		if (!Number.isInteger(id)) throw new AppError('Invalid id', 400)

		if (DESTRUCTIVE_ACTION_KEYS.has(req.params.actionKey)) {
			await requireAdmin(req)
		}

		const result = await dispatchServiceQueueAction(
			id,
			req.params.actionKey,
			req.player!.playerId,
			(req.body ?? {}) as Record<string, unknown>,
		)
		console.log(
			`[webadmin] ${req.player!.playerId} ran service-queue action '${req.params.actionKey}' on item ${id}`,
		)
		res.json(result)
	} catch (err) {
		next(err)
	}
})

export default router
