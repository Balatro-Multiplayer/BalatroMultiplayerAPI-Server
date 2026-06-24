import { Router } from 'express'
import { and, count, desc, eq } from 'drizzle-orm'
import { db } from '../../infrastructure/db/index.js'
import { chatLogs } from '../../infrastructure/db/schema.js'

const router = Router()

router.get('/chat-logs', async (req, res, next) => {
	try {
		const page = Math.max(1, Number(req.query.page ?? 1))
		const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 100)))
		const offset = (page - 1) * limit
		const playerId = typeof req.query.playerId === 'string' ? req.query.playerId : undefined
		const flaggedOnly = req.query.flagged === 'true'

		const conditions = []
		if (playerId) conditions.push(eq(chatLogs.playerId, playerId))
		if (flaggedOnly) conditions.push(eq(chatLogs.flagged, true))

		const where = conditions.length > 0 ? and(...conditions) : undefined

		const [{ total }] = await db.select({ total: count() }).from(chatLogs).where(where)

		const rows = await db
			.select()
			.from(chatLogs)
			.where(where)
			.orderBy(desc(chatLogs.sentAt))
			.limit(limit)
			.offset(offset)

		res.json({ logs: rows, total, page, limit, pages: Math.ceil(total / limit) })
	} catch (err) {
		next(err)
	}
})

export default router
