import { Router } from 'express'
import { and, asc, eq, isNull, ne } from 'drizzle-orm'
import { db } from '../../infrastructure/db/index.js'
import { seasons } from '../../infrastructure/db/schema.js'
import { AppError } from '../../shared/utils/errors.js'

// Season model: the active season is the row with ended_at IS NULL.
// Exactly one season is active at a time.
const router = Router()

router.get('/seasons', async (_req, res, next) => {
	try {
		const rows = await db.select().from(seasons).orderBy(asc(seasons.id))
		res.json({
			seasons: rows.map((s) => ({
				id: s.id,
				name: s.name,
				startedAt: s.startedAt,
				endsAt: s.endsAt,
				endedAt: s.endedAt,
				active: s.endedAt === null,
			})),
		})
	} catch (err) {
		next(err)
	}
})

router.post('/seasons', async (req, res, next) => {
	try {
		const { name, endsAt } = req.body as { name?: unknown; endsAt?: unknown }
		if (typeof name !== 'string' || !name.trim()) {
			throw new AppError('name is required', 400)
		}
		let endsAtDate: Date
		if (endsAt === undefined || endsAt === null) {
			endsAtDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000)
		} else if (typeof endsAt === 'string') {
			endsAtDate = new Date(endsAt)
			if (Number.isNaN(endsAtDate.getTime())) {
				throw new AppError('endsAt is not a valid date', 400)
			}
		} else {
			throw new AppError('endsAt must be an ISO date string or null', 400)
		}

		const created = await db.transaction(async (tx) => {
			await tx.update(seasons).set({ endedAt: new Date() }).where(isNull(seasons.endedAt))
			const [row] = await tx
				.insert(seasons)
				.values({ name: name.trim(), startedAt: new Date(), endsAt: endsAtDate })
				.returning()
			return row!
		})

		console.log(`[webadmin] ${req.player!.playerId} started season ${created.id} (${created.name})`)
		res.status(201).json({ season: created })
	} catch (err) {
		next(err)
	}
})

router.post('/seasons/:id/activate', async (req, res, next) => {
	try {
		const id = Number(req.params.id)
		if (!Number.isInteger(id)) throw new AppError('Invalid season id', 400)

		const existing = await db
			.select({ id: seasons.id })
			.from(seasons)
			.where(eq(seasons.id, id))
			.limit(1)
		if (!existing[0]) throw new AppError('Season not found', 404)

		await db.transaction(async (tx) => {
			await tx
				.update(seasons)
				.set({ endedAt: new Date() })
				.where(and(ne(seasons.id, id), isNull(seasons.endedAt)))
			await tx.update(seasons).set({ endedAt: null }).where(eq(seasons.id, id))
		})

		console.log(`[webadmin] ${req.player!.playerId} activated season ${id}`)
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

router.post('/seasons/:id/end', async (req, res, next) => {
	try {
		const id = Number(req.params.id)
		if (!Number.isInteger(id)) throw new AppError('Invalid season id', 400)

		const [row] = await db
			.update(seasons)
			.set({ endedAt: new Date() })
			.where(and(eq(seasons.id, id), isNull(seasons.endedAt)))
			.returning()
		if (!row) throw new AppError('Season not found or already ended', 404)

		console.log(`[webadmin] ${req.player!.playerId} ended season ${id}`)
		res.json({ season: row })
	} catch (err) {
		next(err)
	}
})

export default router
