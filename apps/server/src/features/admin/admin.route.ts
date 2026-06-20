import { Router } from 'express'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { env } from '../../env.js'
import { AppError } from '../../shared/utils/errors.js'
import { getConfig } from '../../state/config.js'
import { loadConfigFromDb } from '../../infrastructure/gateways/config.gateway.js'
import { mqttService } from '../../infrastructure/mqtt/mqtt.service.js'
import { db } from '../../infrastructure/db/index.js'
import { seasons } from '../../infrastructure/db/schema.js'
import {
	insertBan,
	isBanType,
	liftBan,
	listBans,
} from '../../infrastructure/gateways/ban.gateway.js'
import { findPlayerById } from '../../infrastructure/gateways/player.gateway.js'
import { kickClient } from '../../infrastructure/emqx/emqx-admin.service.js'
import { getSession } from '../../state/index.js'

const router = Router()

function requireAdmin(req: { headers: Record<string, unknown> }): void {
	if (req.headers['x-admin-secret'] !== env.ADMIN_SECRET) {
		throw new AppError('Unauthorized', 401)
	}
}

// Parse an optional expiresAt value: null/undefined = indefinite ban.
// A provided value must be a valid ISO8601 timestamp in the future.
function parseExpiresAt(value: unknown): Date | null {
	if (value === null || value === undefined) return null
	if (typeof value !== 'string') {
		throw new AppError('expiresAt must be an ISO8601 string or null', 400)
	}
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) {
		throw new AppError('expiresAt is not a valid date', 400)
	}
	if (date.getTime() <= Date.now()) {
		throw new AppError('expiresAt must be in the future', 400)
	}
	return date
}

router.post('/refresh-config', async (req, res, next) => {
	try {
		const secret = req.headers['x-admin-secret']
		if (secret !== env.ADMIN_SECRET) {
			throw new AppError('Unauthorized', 401)
		}

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
		requireAdmin(req)

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
			// End every other currently-active season…
			await tx
				.update(seasons)
				.set({ endedAt: new Date() })
				.where(and(ne(seasons.id, season), isNull(seasons.endedAt)))
			// …and (re)activate the chosen one.
			await tx.update(seasons).set({ endedAt: null }).where(eq(seasons.id, season))
		})

		console.log(`[admin] Active season set to ${season}`)
		res.json({ currentSeason: season })
	} catch (err) {
		next(err)
	}
})

// --- Bans (§22) ---

// Issue a ban. Body: { type: 'chat'|'queue'|'account', expiresAt?: ISO8601|null, reason?: string }
router.post('/players/:id/bans', async (req, res, next) => {
	try {
		requireAdmin(req)

		const playerId = req.params.id
		const { type, expiresAt, reason } = req.body as {
			type?: unknown
			expiresAt?: unknown
			reason?: unknown
		}

		if (!isBanType(type)) {
			throw new AppError("type must be 'chat', 'queue', or 'account'", 400)
		}
		if (reason !== undefined && typeof reason !== 'string') {
			throw new AppError('reason must be a string', 400)
		}
		const parsedExpiresAt = parseExpiresAt(expiresAt)

		const player = await findPlayerById(playerId)
		if (!player) throw new AppError('Player not found', 404)

		const ban = await insertBan({
			playerId,
			banType: type,
			expiresAt: parsedExpiresAt,
			issuedBy: 'admin',
			reason: typeof reason === 'string' ? reason : '',
		})

		// Account bans take effect immediately: if the player is currently
		// connected, notify and force-disconnect them. The disconnect webhook
		// then runs the normal grace-period / lobby cleanup. Offline players are
		// caught by the EMQX auth webhook on their next CONNECT.
		if (type === 'account' && getSession(playerId)) {
			await mqttService
				.publishToPlayer(playerId, 'notifications', {
					type: 'banned',
					banType: 'account',
					reason: ban.reason,
				})
				.catch((err) =>
					console.error('[admin] ban notify failed:', err),
				)
			await kickClient(playerId)
		}

		console.log(
			`[admin] Issued ${type} ban on ${playerId} (expires ${parsedExpiresAt?.toISOString() ?? 'never'})`,
		)
		res.status(201).json({ ban })
	} catch (err) {
		next(err)
	}
})

// Lift a ban early.
router.delete('/players/:id/bans/:banId', async (req, res, next) => {
	try {
		requireAdmin(req)

		const lifted = await liftBan(req.params.id, req.params.banId, 'admin')
		if (!lifted) {
			throw new AppError('No matching active ban found', 404)
		}

		console.log(`[admin] Lifted ban ${req.params.banId} on ${req.params.id}`)
		res.json({ ban: lifted })
	} catch (err) {
		next(err)
	}
})

// List all bans for a player (active, expired, and lifted).
router.get('/players/:id/bans', async (req, res, next) => {
	try {
		requireAdmin(req)

		const bans = await listBans(req.params.id)
		res.json({ bans })
	} catch (err) {
		next(err)
	}
})

export default router
