import { Router } from 'express'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { env } from '../../env.js'
import { AppError } from '../../shared/utils/errors.js'
import { getConfig } from '../../state/config.js'
import { loadConfigFromDb } from '../../infrastructure/gateways/config.gateway.js'
import { mqttService } from '../../infrastructure/mqtt/mqtt.service.js'
import { db } from '../../infrastructure/db/index.js'
import { seasons } from '../../infrastructure/db/schema.js'
import bansRouter from './bans.route.js'

const router = Router()

function requireAdmin(req: { headers: Record<string, unknown> }): void {
	if (req.headers['x-admin-secret'] !== env.ADMIN_SECRET) {
		throw new AppError('Unauthorized', 401)
	}
}

router.use((req, _res, next) => {
	try {
		requireAdmin(req)
		next()
	} catch (err) {
		next(err)
	}
})

router.post('/refresh-config', async (req, res, next) => {
	try {
		const previousMods = getConfig().mods

		const newConfig = await loadConfigFromDb()

		const changedMods = newConfig.mods.filter((newMod) => {
			const prev = previousMods.find((m) => m.modId === newMod.modId)
			return !prev || prev.version !== newMod.version
		})

		if (changedMods.length > 0) {
			await mqttService.publishModUpdate(changedMods)
			console.log(
				`[admin] Mod update broadcast: ${changedMods.map((m) => `${m.modId}@${m.version}`).join(', ')}`,
			)
		}

		res.json(newConfig)
	} catch (err) {
		next(err)
	}
})

// Make an existing season the single active one (active = ended_at IS NULL).
// The active season is the source of truth — there is no separate pointer.
router.post('/set-season', async (req, res, next) => {
	try {
		const { season } = req.body
		if (!Number.isInteger(season) || season < 0) {
			throw new AppError('season must be a non-negative integer', 400)
		}

		const existing = await db
			.select({ id: seasons.id })
			.from(seasons)
			.where(eq(seasons.id, season))
			.limit(1)
		if (!existing[0]) throw new AppError('Season not found', 404)

		await db.transaction(async (tx) => {
			await tx
				.update(seasons)
				.set({ endedAt: new Date() })
				.where(and(ne(seasons.id, season), isNull(seasons.endedAt)))
			await tx.update(seasons).set({ endedAt: null }).where(eq(seasons.id, season))
		})

		console.log(`[admin] Active season set to ${season}`)
		res.json({ currentSeason: season })
	} catch (err) {
		next(err)
	}
})

router.use(bansRouter)

export default router
