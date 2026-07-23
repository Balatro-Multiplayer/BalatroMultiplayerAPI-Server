import { Router } from 'express'
import { asc, count, desc, eq } from 'drizzle-orm'
import { db } from '../../infrastructure/db/index.js'
import { players, reportedLobbyMessages, reports } from '../../infrastructure/db/schema.js'
import { resolveReport } from '../../infrastructure/gateways/report.gateway.js'

const router = Router()

type ReportRow = typeof reports.$inferSelect

// Shared by the list and detail routes so per-row enrichment (reporter/
// reported display names + this lobby's flushed chat history) can't drift
// between them.
async function enrichReport(r: ReportRow, messageLimit: number) {
	const messages = await db
		.select()
		.from(reportedLobbyMessages)
		.where(eq(reportedLobbyMessages.lobbyId, r.lobbyId))
		.orderBy(asc(reportedLobbyMessages.sentAt))
		.limit(messageLimit)

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
}

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

		const enriched = await Promise.all(rows.map((r) => enrichReport(r, 50)))

		res.json({ reports: enriched, total, page, limit, pages: Math.ceil(total / limit) })
	} catch (err) {
		next(err)
	}
})

router.get('/reports/:id', async (req, res, next) => {
	try {
		const id = Number(req.params.id)
		if (!Number.isInteger(id)) {
			res.status(400).json({ error: 'Invalid report id' })
			return
		}

		const [row] = await db.select().from(reports).where(eq(reports.id, id)).limit(1)
		if (!row) {
			res.status(404).json({ error: 'Report not found' })
			return
		}

		res.json({ report: await enrichReport(row, 200) })
	} catch (err) {
		next(err)
	}
})

router.patch('/reports/:id/resolve', async (req, res, next) => {
	try {
		const id = Number(req.params.id)
		if (!Number.isInteger(id)) {
			res.status(400).json({ error: 'Invalid report id' })
			return
		}

		const updated = await resolveReport(id)
		if (!updated) {
			res.status(404).json({ error: 'Report not found' })
			return
		}

		res.json({ report: updated })
	} catch (err) {
		next(err)
	}
})

export default router
