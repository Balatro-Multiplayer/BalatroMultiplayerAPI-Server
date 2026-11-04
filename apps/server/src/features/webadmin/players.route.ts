import { and, count, desc, eq, gt, ilike, isNull, or, sql } from 'drizzle-orm'
import { Router } from 'express'
import { db } from '../../infrastructure/db/index.js'
import { playerBans, players } from '../../infrastructure/db/schema.js'
import {
	isBanType,
	liftBan,
	listBans,
} from '../../infrastructure/gateways/ban.gateway.js'
import { findPlayerById } from '../../infrastructure/gateways/player.gateway.js'
import {
	liftBanInNakama,
	liftNetworkBanInNakama,
	networkBansInNakama,
} from '../../infrastructure/nakama/moderation-sync.js'
import { editNakamaProfile } from '../../infrastructure/nakama/profile-sync.js'
import { AppError } from '../../shared/utils/errors.js'
import { parseExpiresAt } from '../../shared/utils/parse-expires-at.js'
import { MAX_PAGE, queryInt } from '../../shared/utils/query-int.js'
import { requireAdmin } from '../../shared/utils/require-admin.js'
import { isOwnerId, redactPlayerFor } from '../../shared/utils/staff-role.js'
import { mayIssueBan, mayLiftBan } from '../service-queue/permissions.js'
import { staffOf } from '../service-queue/staff.js'
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
		const page = queryInt(req.query.page, 1, 1, MAX_PAGE)
		const limit = queryInt(req.query.limit, 50, 1, 100)
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
				noticeAcceptedAt: players.noticeAcceptedAt,
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

		const staff = await staffOf(req)
		res.json({
			players: rows.map((row) => redactPlayerFor(staff?.role ?? null, row)),
			total,
			page,
			limit,
			pages: Math.ceil(total / limit),
		})
	} catch (err) {
		next(err)
	}
})

router.get('/players/:id', async (req, res, next) => {
	try {
		const player = await findPlayerById(req.params.id)
		if (!player) throw new AppError('Player not found', 404)
		const bans = await listBans(req.params.id)
		const staff = await staffOf(req)
		res.json({ player: redactPlayerFor(staff?.role ?? null, player), bans })
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
		await requireAdmin(req)

		const { privileges } = req.body as { privileges?: unknown }
		if (!Array.isArray(privileges) || !privileges.every((p) => typeof p === 'string')) {
			throw new AppError('privileges must be an array of strings', 400)
		}
		const invalid = privileges.filter((p) => !PRIVILEGE_PATTERN.test(p))
		if (invalid.length > 0)
			throw new AppError(`Invalid privilege names: ${invalid.join(', ')}`, 400)
		// The owner is always an admin: no change may take that role away.
		if (isOwnerId(req.params.id) && !privileges.includes('admin'))
			throw new AppError("The owner's admin role cannot be removed", 403)

		const [updated] = await db
			.update(players)
			.set({ privileges, updatedAt: new Date() })
			.where(eq(players.id, req.params.id))
			.returning({ id: players.id, privileges: players.privileges })

		if (!updated) throw new AppError('Player not found', 404)
		await editNakamaProfile(updated.id, { privileges })
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

		const expires = parseExpiresAt(expiresAt)
		// The service queue's role table holds here too (permissions.ts): a
		// moderator's chat bans run at most 30 days and queue bans 7; longer,
		// permanent and account bans are an admin's.
		const staff = await staffOf(req)
		if (!staff || !mayIssueBan(staff.role, type, expires, new Date()))
			throw new AppError('Your role may not issue this ban', 403)

		const player = await findPlayerById(playerId)
		if (!player) throw new AppError('Player not found', 404)

		const ban = await issueBan({
			playerId,
			banType: type,
			expiresAt: expires,
			issuedBy: `${staff.role}:${req.player!.playerId}`,
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
		const staff = await staffOf(req)
		const target = (await listBans(req.params.id)).find((b) => b.id === req.params.banId)
		if (!staff || (target && !mayLiftBan(staff.role, target.banType)))
			throw new AppError('Your role may not lift this ban', 403)
		const lifted = await liftBan(req.params.id, req.params.banId, `${staff.role}:${req.player!.playerId}`)
		if (!lifted) throw new AppError('No matching active ban found', 404)
		await liftBanInNakama(req.params.id, req.params.banId).catch((e) =>
			console.error('[webadmin] Nakama ban lift failed:', e),
		)
		console.log(`[webadmin] ${req.player!.playerId} lifted ban ${req.params.banId} on ${req.params.id}`)
		res.json({ ban: lifted })
	} catch (err) {
		next(err)
	}
})

// Network bans (ADR 0005) live only in Nakama. Only admins see the ones
// that touch a player, and only an admin lifts one.
router.get('/players/:id/network-bans', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const networkBans = await networkBansInNakama(req.params.id)
		if (!networkBans.ok) throw new AppError('Nakama is unavailable', 503)
		res.json({ networkBans: networkBans.value })
	} catch (err) {
		next(err)
	}
})

router.delete('/players/:id/network-bans/:banId', async (req, res, next) => {
	try {
		const staff = await staffOf(req)
		if (!staff || !mayLiftBan(staff.role, 'account')) throw new AppError('Your role may not lift a network ban', 403)
		const outcome = await liftNetworkBanInNakama(req.params.banId)
		if (!outcome.ok && outcome.error === 'unavailable') throw new AppError('Nakama is unavailable', 503)
		if (!outcome.ok && outcome.error === 'not_found') throw new AppError('No matching network ban in force', 404)
		console.log(`[webadmin] ${req.player!.playerId} lifted network ban ${req.params.banId}`)
		res.json({ lifted: true })
	} catch (err) {
		next(err)
	}
})

export default router
