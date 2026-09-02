import { Router } from 'express'
import { and, count, desc, eq, gt, ilike, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../infrastructure/db/index.js'
import { playerBans, players } from '../../infrastructure/db/schema.js'
import { findPlayerById } from '../../infrastructure/gateways/player.gateway.js'
import { isBanType, liftBan, listBans } from '../../infrastructure/gateways/ban.gateway.js'
import { AppError } from '../../shared/utils/errors.js'
import { parseExpiresAt } from '../../shared/utils/parse-expires-at.js'
import { issueBan } from './ban.service.js'

// Privilege names are free-form identifiers (a lowercase letter followed by
// lowercase letters/digits/underscores). Validated by format rather than a fixed
// allow-list so new privileges (e.g. 'tester') can be granted from the admin UI
// without a code change.
const PRIVILEGE_PATTERN = /^[a-z][a-z0-9_]{0,31}$/

const activeBanCond = () =>
	and(isNull(playerBans.liftedAt), or(isNull(playerBans.expiresAt), gt(playerBans.expiresAt, sql`now()`)))

const router = Router()

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
		// Unlike every other route in this file, granting/revoking privileges is
		// admin-only, not admin-or-moderator -- the router-level webAdmin gate
		// alone would let a moderator hand themselves (or anyone) 'admin', a live
		// self-escalation bug. Matches the design doc's "only ever granted
		// directly by an admin."
		const actingPlayer = await findPlayerById(req.player!.playerId)
		if (!actingPlayer?.privileges.includes('admin')) {
			throw new AppError('Only admins can grant or revoke privileges', 403)
		}

		const { privileges } = req.body as { privileges?: unknown }
		if (!Array.isArray(privileges) || !privileges.every((p) => typeof p === 'string')) {
			throw new AppError('privileges must be an array of strings', 400)
		}
		const invalid = privileges.filter((p) => !PRIVILEGE_PATTERN.test(p))
		if (invalid.length > 0) throw new AppError(`Invalid privilege names: ${invalid.join(', ')}`, 400)

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

		const ban = await issueBan({
			playerId,
			banType: type,
			expiresAt: parseExpiresAt(expiresAt),
			issuedBy: `admin:${req.player!.playerId}`,
			reason: typeof reason === 'string' ? reason : '',
		})

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

export default router
