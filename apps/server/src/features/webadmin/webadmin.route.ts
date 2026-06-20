import { Router } from 'express'
import type { Request, Response, NextFunction } from 'express'
import { and, asc, desc, eq, gt, ilike, isNull, ne, or, sql, count } from 'drizzle-orm'
import { db } from '../../infrastructure/db/index.js'
import { chatLogs, playerBans, players, reports, reportedLobbyMessages, seasons } from '../../infrastructure/db/schema.js'
import { authenticate } from '../../middleware/authenticate.js'
import { findPlayerById } from '../../infrastructure/gateways/player.gateway.js'
import { insertBan, isBanType, liftBan, listBans } from '../../infrastructure/gateways/ban.gateway.js'
import { AppError } from '../../shared/utils/errors.js'
import { getSession } from '../../state/index.js'
import { kickClient } from '../../infrastructure/emqx/emqx-admin.service.js'
import { mqttService } from '../../infrastructure/mqtt/mqtt.service.js'

const router = Router()

const VALID_PRIVILEGES = ['admin', 'moderator', 'trusted', 'developer'] as const

function webAdmin(req: Request, res: Response, next: NextFunction) {
	authenticate(req, res, async () => {
		try {
			const player = await findPlayerById(req.player!.playerId)
			if (!player?.privileges.includes('admin')) {
				res.status(403).json({ error: 'Forbidden' })
				return
			}
			next()
		} catch (err) {
			next(err)
		}
	})
}

router.use(webAdmin)

function parseExpiresAt(value: unknown): Date | null {
	if (value === null || value === undefined) return null
	if (typeof value !== 'string') throw new AppError('expiresAt must be an ISO8601 string or null', 400)
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) throw new AppError('expiresAt is not a valid date', 400)
	if (date.getTime() <= Date.now()) throw new AppError('expiresAt must be in the future', 400)
	return date
}

// Active ban condition
const activeBanCond = () =>
	and(isNull(playerBans.liftedAt), or(isNull(playerBans.expiresAt), gt(playerBans.expiresAt, sql`now()`)))

/* ── Players ── */

router.get('/players', async (req, res, next) => {
	try {
		const page = Math.max(1, Number(req.query.page ?? 1))
		const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)))
		const offset = (page - 1) * limit
		const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''

		const baseWhere = search ? ilike(players.steamName, `%${search}%`) : undefined

		const [{ total }] = await db
			.select({ total: count() })
			.from(players)
			.where(baseWhere)

		const rows = await db
			.select({
				id: players.id,
				steamName: players.steamName,
				discordUsername: players.discordUsername,
				privileges: players.privileges,
				chatEnabled: players.chatEnabled,
				chatBlocked: players.chatBlocked,
				tosAcceptedVersion: players.tosAcceptedVersion,
				createdAt: players.createdAt,
				updatedAt: players.updatedAt,
				activeBans: sql<number>`cast(count(${playerBans.id}) filter (where ${activeBanCond()}) as int)`,
			})
			.from(players)
			.leftJoin(playerBans, eq(playerBans.playerId, players.id))
			.where(baseWhere)
			.groupBy(players.id)
			.orderBy(desc(players.createdAt))
			.limit(limit)
			.offset(offset)

		res.json({ players: rows, total, page, limit, pages: Math.ceil(total / limit) })
	} catch (err) {
		next(err)
	}
})

router.get('/players/:id', async (req, res, next) => {
	try {
		const player = await findPlayerById(req.params.id)
		if (!player) throw new AppError('Player not found', 404)
		const bans = await listBans(req.params.id)
		res.json({ player, bans })
	} catch (err) {
		next(err)
	}
})

router.patch('/players/:id/privileges', async (req, res, next) => {
	try {
		const { privileges } = req.body as { privileges?: unknown }
		if (!Array.isArray(privileges) || !privileges.every((p) => typeof p === 'string')) {
			throw new AppError('privileges must be an array of strings', 400)
		}
		const invalid = privileges.filter((p) => !(VALID_PRIVILEGES as readonly string[]).includes(p))
		if (invalid.length > 0) throw new AppError(`Unknown privileges: ${invalid.join(', ')}`, 400)

		const [updated] = await db
			.update(players)
			.set({ privileges, updatedAt: new Date() })
			.where(eq(players.id, req.params.id))
			.returning({ id: players.id, privileges: players.privileges })

		if (!updated) throw new AppError('Player not found', 404)
		console.log(`[webadmin] ${req.player!.playerId} updated privileges for ${req.params.id}: ${JSON.stringify(privileges)}`)
		res.json(updated)
	} catch (err) {
		next(err)
	}
})

router.post('/players/:id/bans', async (req, res, next) => {
	try {
		const playerId = req.params.id
		const { type, expiresAt, reason } = req.body as { type?: unknown; expiresAt?: unknown; reason?: unknown }

		if (!isBanType(type)) throw new AppError("type must be 'chat', 'queue', or 'account'", 400)
		if (reason !== undefined && typeof reason !== 'string') throw new AppError('reason must be a string', 400)

		const player = await findPlayerById(playerId)
		if (!player) throw new AppError('Player not found', 404)

		const issuedBy = `admin:${req.player!.playerId}`
		const ban = await insertBan({
			playerId,
			banType: type,
			expiresAt: parseExpiresAt(expiresAt),
			issuedBy,
			reason: typeof reason === 'string' ? reason : '',
		})

		if (type === 'account' && getSession(playerId)) {
			await mqttService.publishToPlayer(playerId, 'notifications', {
				type: 'banned', banType: 'account', reason: ban.reason,
			}).catch((e) => console.error('[webadmin] ban notify failed:', e))
			await kickClient(playerId)
		}

		console.log(`[webadmin] ${req.player!.playerId} issued ${type} ban on ${playerId}`)
		res.status(201).json({ ban })
	} catch (err) {
		next(err)
	}
})

router.delete('/players/:id/bans/:banId', async (req, res, next) => {
	try {
		const lifted = await liftBan(req.params.id, req.params.banId, `admin:${req.player!.playerId}`)
		if (!lifted) throw new AppError('No matching active ban found', 404)
		console.log(`[webadmin] ${req.player!.playerId} lifted ban ${req.params.banId} on ${req.params.id}`)
		res.json({ ban: lifted })
	} catch (err) {
		next(err)
	}
})

/* ── Chat logs ── */

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

/* ── Reports ── */

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

		// Fetch reported lobby messages for each report
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

/* ── Seasons ── */
// Season model: the active season is the row with ended_at IS NULL (see
// getCurrentSeason). Exactly one season is active at a time.

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

// Start a new season and make it the active one (ends any currently-active season).
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

// Make an existing season the active one (ends every other active season).
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

// End a season (sets ended_at). No-op if already ended.
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
