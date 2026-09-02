import { Router } from 'express'
import { eq } from 'drizzle-orm'
import { db } from '../../infrastructure/db/index.js'
import { chatAllowlist, modVersions, serverConfig } from '../../infrastructure/db/schema.js'
import { getConfig } from '../../state/config.js'
import { loadConfigFromDb } from '../../infrastructure/gateways/config.gateway.js'
import { findPlayerById } from '../../infrastructure/gateways/player.gateway.js'
import { AppError } from '../../shared/utils/errors.js'

// §6.4: AppConfig was only ever editable via a direct DB write plus
// /admin/refresh-config (the ops-secret-gated reload, admin.route.ts) picking
// it up -- no admin-privilege-gated webpage existed. All writes here go
// through the admin-only gate (matching players.route.ts's privilege-grant
// precedent), not the router-level admin-or-moderator webAdmin gate, since
// platform config has the same self-inflicted-blast-radius shape.
//
// chatEnabled/rankedEnabled/casualQueueEnabled/lobbyCreationEnabled are now
// DB-backed columns on server_config (migration 0036) and writable via
// PATCH /config/feature-flags below. testingMode remains env-var-only
// (env.TESTING_MODE), surfaced read-only.
const router = Router()

async function requireAdmin(req: import('express').Request) {
	const actingPlayer = await findPlayerById(req.player!.playerId)
	if (!actingPlayer?.privileges.includes('admin')) {
		throw new AppError('Only admins can edit platform configuration', 403)
	}
}

router.get('/config', async (_req, res, next) => {
	try {
		const config = getConfig()
		res.json({
			tosVersion: config.tosVersion,
			mods: config.mods,
			chatAllowlist: [...config.chatAllowlist],
			chatEnabled: config.chatEnabled,
			testingMode: config.testingMode ?? false,
			rankedEnabled: config.rankedEnabled,
			casualQueueEnabled: config.casualQueueEnabled,
			lobbyCreationEnabled: config.lobbyCreationEnabled,
		})
	} catch (err) {
		next(err)
	}
})

router.patch('/config/feature-flags', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const { chatEnabled, rankedEnabled, casualQueueEnabled, lobbyCreationEnabled } = req.body as {
			chatEnabled?: unknown
			rankedEnabled?: unknown
			casualQueueEnabled?: unknown
			lobbyCreationEnabled?: unknown
		}

		const patch: Partial<{
			chatEnabled: boolean
			rankedEnabled: boolean
			casualQueueEnabled: boolean
			lobbyCreationEnabled: boolean
		}> = {}
		for (const [key, value] of Object.entries({
			chatEnabled,
			rankedEnabled,
			casualQueueEnabled,
			lobbyCreationEnabled,
		})) {
			if (value === undefined) continue
			if (typeof value !== 'boolean') {
				throw new AppError(`${key} must be a boolean`, 400)
			}
			;(patch as Record<string, boolean>)[key] = value
		}
		if (Object.keys(patch).length === 0) {
			throw new AppError('At least one flag must be provided', 400)
		}

		await db
			.update(serverConfig)
			.set({ ...patch, updatedAt: new Date() })
			.where(eq(serverConfig.id, 1))

		const config = await loadConfigFromDb()
		res.json({
			chatEnabled: config.chatEnabled,
			rankedEnabled: config.rankedEnabled,
			casualQueueEnabled: config.casualQueueEnabled,
			lobbyCreationEnabled: config.lobbyCreationEnabled,
		})
	} catch (err) {
		next(err)
	}
})

router.patch('/config/tos-version', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const { tosVersion } = req.body as { tosVersion?: unknown }
		if (typeof tosVersion !== 'number' || !Number.isInteger(tosVersion) || tosVersion < 1) {
			throw new AppError('tosVersion must be a positive integer', 400)
		}

		await db
			.insert(serverConfig)
			.values({ id: 1, tosVersion })
			.onConflictDoUpdate({ target: serverConfig.id, set: { tosVersion, updatedAt: new Date() } })

		const config = await loadConfigFromDb()
		res.json({ tosVersion: config.tosVersion })
	} catch (err) {
		next(err)
	}
})

router.put('/config/mods/:modId', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const { modId } = req.params
		const { displayName, version, downloadUrl } = req.body as {
			displayName?: unknown
			version?: unknown
			downloadUrl?: unknown
		}
		if (typeof displayName !== 'string' || !displayName) throw new AppError('displayName is required', 400)
		if (typeof version !== 'string' || !version) throw new AppError('version is required', 400)
		if (typeof downloadUrl !== 'string' || !downloadUrl) throw new AppError('downloadUrl is required', 400)

		await db
			.insert(modVersions)
			.values({ modId, displayName, version, downloadUrl })
			.onConflictDoUpdate({
				target: modVersions.modId,
				set: { displayName, version, downloadUrl, updatedAt: new Date() },
			})

		// Reuses the same reload path /admin/refresh-config uses (diffs mod
		// versions and broadcasts an MQTT update for anything changed).
		const config = await loadConfigFromDb()
		res.json({ mods: config.mods })
	} catch (err) {
		next(err)
	}
})

router.delete('/config/mods/:modId', async (req, res, next) => {
	try {
		await requireAdmin(req)
		await db.delete(modVersions).where(eq(modVersions.modId, req.params.modId))
		const config = await loadConfigFromDb()
		res.json({ mods: config.mods })
	} catch (err) {
		next(err)
	}
})

router.post('/config/chat-allowlist', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const { message } = req.body as { message?: unknown }
		if (typeof message !== 'string' || !message.trim()) {
			throw new AppError('message is required', 400)
		}
		await db.insert(chatAllowlist).values({ message: message.trim() }).onConflictDoNothing()
		const config = await loadConfigFromDb()
		res.json({ chatAllowlist: [...config.chatAllowlist] })
	} catch (err) {
		next(err)
	}
})

router.delete('/config/chat-allowlist/:message', async (req, res, next) => {
	try {
		await requireAdmin(req)
		await db.delete(chatAllowlist).where(eq(chatAllowlist.message, req.params.message))
		const config = await loadConfigFromDb()
		res.json({ chatAllowlist: [...config.chatAllowlist] })
	} catch (err) {
		next(err)
	}
})

export default router
