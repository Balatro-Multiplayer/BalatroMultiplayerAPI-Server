import { Router } from 'express'
import {
	clearRankedConfig,
	createCustomMod,
	createProfile,
	deleteCustomMod,
	deleteProfile,
	getProfileById,
	getPublicModById,
	listProfiles,
	removeProfileEntry,
	setRankedConfig,
	updateProfile,
	upsertProfileEntry,
} from '../../infrastructure/gateways/mods.gateway.js'
import { findPlayerById } from '../../infrastructure/gateways/player.gateway.js'
import { AppError } from '../../shared/utils/errors.js'
import { syncModRegistry } from '../mods/mods-sync.service.js'

// Ranked mod catalog admin surface: manual per-mod ranked-allowlist overrides
// and named "ranked mod profiles" (admin-curated allowed/blocked mod lists,
// requested so admins can compose ranked eligibility on the site). Info-only
// for now -- nothing cross-checks a client's actual installed mods against a
// profile at queue time yet (see the design plan's ranked-mod-enforcement
// note, deliberately deferred); this is the data the launcher/website read.
//
// Mutations are admin-only (not moderator), matching config.route.ts's
// precedent: this has the same self-inflicted-blast-radius shape as platform
// config. Reads stay at the router-level webAdmin gate (admin OR moderator).
const router = Router()

async function requireAdmin(req: import('express').Request) {
	const actingPlayer = await findPlayerById(req.player!.playerId)
	if (!actingPlayer?.privileges.includes('admin')) {
		throw new AppError('Only admins can edit the ranked mod catalog', 403)
	}
}

// Manually kicks off the same BETModIndex sync + prepared-archive hashing pass
// that otherwise only runs at server startup and on the hourly interval (see
// mods-sync.service.ts) -- e.g. to confirm a mod's hash updated right after a
// new release, without waiting for the next tick or restarting the server.
// syncModRegistry() itself dedupes concurrent calls (an in-flight run is
// shared, not duplicated), so this is safe to hit even if the hourly job is
// mid-run. Admin-only: this downloads and hashes every mod's archive, a
// heavier blast radius than the per-mod toggle above.
router.post('/mods/sync', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const summary = await syncModRegistry()
		res.json({ ok: true, ...summary })
	} catch (err) {
		next(err)
	}
})

// Ranked config (allowedInRanked + an optional pinned ranked version) is
// entirely admin-owned -- see mods.gateway.ts's setRankedConfig doc comment.
// At least one field must be present; either can be sent alone to update
// just that one.
router.put('/mods/:modId', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const { allowedInRanked, rankedVersion } = req.body as {
			allowedInRanked?: unknown
			rankedVersion?: unknown
		}
		if (allowedInRanked !== undefined && typeof allowedInRanked !== 'boolean') {
			throw new AppError('allowedInRanked must be a boolean', 400)
		}
		if (
			rankedVersion !== undefined &&
			rankedVersion !== null &&
			typeof rankedVersion !== 'string'
		) {
			throw new AppError('rankedVersion must be a string or null', 400)
		}
		if (allowedInRanked === undefined && rankedVersion === undefined) {
			throw new AppError('allowedInRanked or rankedVersion is required', 400)
		}
		const ok = await setRankedConfig(req.params.modId, {
			allowedInRanked,
			rankedVersion,
		})
		if (!ok) throw new AppError('Mod not found', 404)
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

// Clears this mod's ranked config back to the defaults (not allowed, no
// version pin).
router.delete('/mods/:modId/ranked', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const ok = await clearRankedConfig(req.params.modId)
		if (!ok) throw new AppError('Mod not found', 404)
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

// Creates a mod entry with no base-index counterpart at all (an id BETModIndex
// will never publish) -- e.g. a partner mod not listed upstream. Folded into
// the same hashing pass as index-synced mods (see mods-sync.service.ts).
router.post('/mods', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const body = req.body as Record<string, unknown>
		const { id, title, author } = body
		if (typeof id !== 'string' || !id) throw new AppError('id is required', 400)
		if (typeof title !== 'string' || !title)
			throw new AppError('title is required', 400)
		if (typeof author !== 'string' || !author)
			throw new AppError('author is required', 400)

		const mod = await createCustomMod({
			id,
			title,
			author,
			categories: Array.isArray(body.categories)
				? (body.categories as string[])
				: undefined,
			requiresSteamodded:
				typeof body.requiresSteamodded === 'boolean'
					? body.requiresSteamodded
					: undefined,
			requiresTalisman:
				typeof body.requiresTalisman === 'boolean'
					? body.requiresTalisman
					: undefined,
			repoUrl: typeof body.repoUrl === 'string' ? body.repoUrl : null,
			thumbnailUrl:
				typeof body.thumbnailUrl === 'string' ? body.thumbnailUrl : null,
			description:
				typeof body.description === 'string' ? body.description : null,
			latestVersion:
				typeof body.latestVersion === 'string' ? body.latestVersion : null,
			latestDownloadUrl:
				typeof body.latestDownloadUrl === 'string'
					? body.latestDownloadUrl
					: null,
		})
		if (!mod) throw new AppError(`A mod with id '${id}' already exists`, 409)
		res.status(201).json(mod)
	} catch (err) {
		next(err)
	}
})

// Only a custom mod (no base-index counterpart) can be deleted here -- a
// synced mod would just reappear on the next sync, so deleting it isn't
// meaningful.
router.delete('/mods/:modId', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const mod = await getPublicModById(req.params.modId)
		if (!mod) throw new AppError('Mod not found', 404)
		if (!mod.isCustom) {
			throw new AppError(
				'Only a custom mod can be deleted -- a synced mod would just reappear on the next sync',
				400,
			)
		}
		await deleteCustomMod(req.params.modId)
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

router.get('/mods/profiles', async (_req, res, next) => {
	try {
		res.json(await listProfiles())
	} catch (err) {
		next(err)
	}
})

router.get('/mods/profiles/:id', async (req, res, next) => {
	try {
		const profile = await getProfileById(req.params.id)
		if (!profile) throw new AppError('Profile not found', 404)
		res.json(profile)
	} catch (err) {
		next(err)
	}
})

router.post('/mods/profiles', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const { name, slug, description } = req.body as {
			name?: unknown
			slug?: unknown
			description?: unknown
		}
		if (typeof name !== 'string' || !name)
			throw new AppError('name is required', 400)
		if (typeof slug !== 'string' || !slug)
			throw new AppError('slug is required', 400)

		const profile = await createProfile({
			name,
			slug,
			description: typeof description === 'string' ? description : null,
			createdBy: req.player!.playerId,
		})
		res.status(201).json(profile)
	} catch (err) {
		next(err)
	}
})

router.put('/mods/profiles/:id', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const { name, slug, description } = req.body as {
			name?: unknown
			slug?: unknown
			description?: unknown
		}
		if (typeof name !== 'string' || !name)
			throw new AppError('name is required', 400)
		if (typeof slug !== 'string' || !slug)
			throw new AppError('slug is required', 400)

		const profile = await updateProfile(req.params.id, {
			name,
			slug,
			description: typeof description === 'string' ? description : null,
		})
		if (!profile) throw new AppError('Profile not found', 404)
		res.json(profile)
	} catch (err) {
		next(err)
	}
})

router.delete('/mods/profiles/:id', async (req, res, next) => {
	try {
		await requireAdmin(req)
		await deleteProfile(req.params.id)
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

router.put('/mods/profiles/:id/entries/:modId', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const { versionConstraint, allowed } = req.body as {
			versionConstraint?: unknown
			allowed?: unknown
		}
		const entry = await upsertProfileEntry({
			profileId: req.params.id,
			modId: req.params.modId,
			versionConstraint:
				typeof versionConstraint === 'string' ? versionConstraint : 'any',
			allowed: typeof allowed === 'boolean' ? allowed : true,
		})
		res.json(entry)
	} catch (err) {
		next(err)
	}
})

router.delete('/mods/profiles/:id/entries/:modId', async (req, res, next) => {
	try {
		await requireAdmin(req)
		await removeProfileEntry(req.params.id, req.params.modId)
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

export default router
