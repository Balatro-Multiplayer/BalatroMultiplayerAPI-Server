import { Router } from 'express'
import { asc, count, desc, eq } from 'drizzle-orm'
import { db } from '../../infrastructure/db/index.js'
import { players, reportedLobbyMessages, reports } from '../../infrastructure/db/schema.js'

const router = Router()

router.get('/reports', async (req, res, next) => {
	try {
		const page = Math.max(1, Number(req.query.page ?? 1))
		const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)))
		const offset = (page - 1) * limit

		const [{ total }] = await db.select({ total: count() }).from(reports)

		const rows = await db
			.select()
			.from(reports)
			.orderBy(desc(reports.createdAt))
			.limit(limit)
			.offset(offset)

		const enriched = await Promise.all(
			rows.map(async (r) => {
				const messages = await db
					.select()
					.from(reportedLobbyMessages)
					.where(eq(reportedLobbyMessages.lobbyId, r.lobbyId))
					.orderBy(asc(reportedLobbyMessages.sentAt))
					.limit(50)

				const [reporter] = await db
					.select({ steamName: players.steamName })
					.from(players)
					.where(eq(players.id, r.reporterId))
					.limit(1)
					.catch(() => [])

				const [reported] = await db
					.select({ steamName: players.steamName })
					.from(players)
					.where(eq(players.id, r.reportedId))
					.limit(1)
					.catch(() => [])

				return {
					...r,
					reporterName: reporter?.steamName ?? r.reporterId,
					reportedName: reported?.steamName ?? r.reportedId,
					messages,
				}
			})
		)

		res.json({ reports: enriched, total, page, limit, pages: Math.ceil(total / limit) })
	} catch (err) {
		next(err)
	}
})

export default router
