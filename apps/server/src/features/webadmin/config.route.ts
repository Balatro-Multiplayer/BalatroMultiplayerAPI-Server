import { NOTICE_DATE, NOTICE_VERSION } from '@bmp/types'
import { eq } from 'drizzle-orm'
import { Router } from 'express'
import { db } from '../../infrastructure/db/index.js'
import {
	chatAllowlist,
	modVersions,
	serverConfig,
} from '../../infrastructure/db/schema.js'
import { recordStaffAction } from '../../infrastructure/gateways/staff-log.gateway.js'
import { getLadderSteps, setLadderSteps } from '../../infrastructure/gateways/strike.gateway.js'
import { isLadder, parseLadderSteps } from '../strikes/ladder.js'
import { parseReason } from '../../shared/staff-log/actions.js'
import { loadConfigFromDb } from '../../infrastructure/gateways/config.gateway.js'
import { AppError } from '../../shared/utils/errors.js'
import { requireAdmin } from '../../shared/utils/require-admin.js'
import { getConfig } from '../../state/config.js'

// §6.4: AppConfig was only ever editable via a direct DB write plus
// /admin/refresh-config (the ops-secret-gated reload, admin.route.ts) picking
// it up -- no admin-privilege-gated webpage existed. All writes here go
// through the admin-only gate (matching players.route.ts's privilege-grant
// precedent), not the router-level admin-or-moderator webAdmin gate, since
// platform config has the same self-inflicted-blast-radius shape.
//
// chatEnabled/rankedEnabled/casualQueueEnabled/lobbyCreationEnabled are now
// DB-backed columns on server_config (migration 0036; achievementsEnabled
// migration 0048, groupQueueEnabled migration 0050) and writable via
// PATCH /config/feature-flags below. testingMode remains env-var-only
// (env.TESTING_MODE), surfaced read-only.
const router = Router()

router.get('/config', async (_req, res, next) => {
	try {
		const config = getConfig()
		res.json({
			// Set in code (@bmp/types notice.ts), shown read-only.
			noticeVersion: NOTICE_VERSION,
			noticeDate: NOTICE_DATE,
			mods: config.mods,
			chatAllowlist: [...config.chatAllowlist],
			chatEnabled: config.chatEnabled,
			testingMode: config.testingMode ?? false,
			rankedEnabled: config.rankedEnabled,
			casualQueueEnabled: config.casualQueueEnabled,
			groupQueueEnabled: config.groupQueueEnabled,
			lobbyCreationEnabled: config.lobbyCreationEnabled,
			achievementsEnabled: config.achievementsEnabled,
			queueAllowedModIds: config.queueAllowedModIds,
			strikeLadders: await getLadderSteps(),
		})
	} catch (err) {
		next(err)
	}
})

// An admin changes the steps of a strike ladder. The edit is a staff action
// and needs a reason.
router.put('/config/strike-ladders/:ladder', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const { ladder } = req.params
		if (!isLadder(ladder)) throw new AppError("ladder must be 'chat' or 'play'", 404)
		const body = req.body as { steps?: unknown; reason?: unknown }
		const parsed = parseLadderSteps(body.steps)
		if (!parsed.ok) throw new AppError(parsed.message, 400)
		const reason = parseReason(body.reason)
		if (!reason.ok) throw new AppError(reason.message, 400)
		const before = (await getLadderSteps())[ladder]
		await db.transaction(async (tx) => {
			await setLadderSteps(tx, ladder, parsed.steps)
			await recordStaffAction(tx, {
				staff: { playerId: req.player!.playerId, role: 'admin' },
				action: 'ladder_edit',
				reason: reason.reason,
				detail: { ladder, before, after: parsed.steps },
			})
		})
		res.json({ strikeLadders: await getLadderSteps() })
	} catch (err) {
		next(err)
	}
})

router.patch('/config/feature-flags', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const {
			chatEnabled,
			rankedEnabled,
			casualQueueEnabled,
			groupQueueEnabled,
			lobbyCreationEnabled,
			achievementsEnabled,
		} = req.body as {
			chatEnabled?: unknown
			rankedEnabled?: unknown
			casualQueueEnabled?: unknown
			groupQueueEnabled?: unknown
			lobbyCreationEnabled?: unknown
			achievementsEnabled?: unknown
		}

		const patch: Partial<{
			chatEnabled: boolean
			rankedEnabled: boolean
			casualQueueEnabled: boolean
			groupQueueEnabled: boolean
			lobbyCreationEnabled: boolean
			achievementsEnabled: boolean
		}> = {}
		for (const [key, value] of Object.entries({
			chatEnabled,
			rankedEnabled,
			casualQueueEnabled,
			groupQueueEnabled,
			lobbyCreationEnabled,
			achievementsEnabled,
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
			groupQueueEnabled: config.groupQueueEnabled,
			lobbyCreationEnabled: config.lobbyCreationEnabled,
			achievementsEnabled: config.achievementsEnabled,
			queueAllowedModIds: config.queueAllowedModIds,
		})
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
		if (typeof displayName !== 'string' || !displayName)
			throw new AppError('displayName is required', 400)
		if (typeof version !== 'string' || !version)
			throw new AppError('version is required', 400)
		if (typeof downloadUrl !== 'string' || !downloadUrl)
			throw new AppError('downloadUrl is required', 400)

		await db
			.insert(modVersions)
			.values({ modId, displayName, version, downloadUrl })
			.onConflictDoUpdate({
				target: modVersions.modId,
				set: { displayName, version, downloadUrl, updatedAt: new Date() },
			})

		// Reuses the same reload path /admin/refresh-config uses (diffs mod
		// pushes the new config to Nakama).
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
		await db
			.insert(chatAllowlist)
			.values({ message: message.trim() })
			.onConflictDoNothing()
		const config = await loadConfigFromDb()
		res.json({ chatAllowlist: [...config.chatAllowlist] })
	} catch (err) {
		next(err)
	}
})

router.delete('/config/chat-allowlist/:message', async (req, res, next) => {
	try {
		await requireAdmin(req)
		await db
			.delete(chatAllowlist)
			.where(eq(chatAllowlist.message, req.params.message))
		const config = await loadConfigFromDb()
		res.json({ chatAllowlist: [...config.chatAllowlist] })
	} catch (err) {
		next(err)
	}
})

export default router
