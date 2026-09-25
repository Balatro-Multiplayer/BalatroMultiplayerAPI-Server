import { Router } from 'express'
import {
	getPublicModById,
	listPublicMods,
	setRankedVersion,
} from '../../infrastructure/gateways/mods.gateway.js'
import { findPlayerById } from '../../infrastructure/gateways/player.gateway.js'
import { AppError } from '../../shared/utils/errors.js'
import { syncModRegistry } from '../mods/mods-sync.service.js'
import { fetchThunderstorePackageVersions } from '../mods/thunderstore-mod-index.service.js'

// Ranked mod catalog admin surface: sync Thunderstore-sourced mods on demand,
// and manage the one admin-owned field, rankedVersion (see schema.ts's own
// doc comment -- a mod is ranked-allowed iff it's non-null).
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

// Mirrors the public GET /api/mods (see features/mods/mods.route.ts) -- no
// separate hidden/featured concept left to gate on, so the admin and public
// views are identical data now.
router.get('/mods', async (_req, res, next) => {
	try {
		res.json(await listPublicMods())
	} catch (err) {
		next(err)
	}
})

// Manually kicks off the same Thunderstore sync that otherwise only runs at
// server startup and on the hourly interval (see mods-sync.service.ts).
// syncModRegistry() itself dedupes concurrent calls (an in-flight run is
// shared, not duplicated), so this is safe to hit even if the hourly job is
// mid-run.
router.post('/mods/sync', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const summary = await syncModRegistry()
		res.json({ ok: true, ...summary })
	} catch (err) {
		next(err)
	}
})

// Live-proxies this mod's version list straight from Thunderstore -- what
// the ranked-mods admin UI's version picker offers, and what the PUT handler
// below validates a submitted rankedVersion against.
router.get('/mods/:id/versions', async (req, res, next) => {
	try {
		await requireAdmin(req)
		res.json(await fetchThunderstorePackageVersions(req.params.id))
	} catch (err) {
		next(err)
	}
})

// rankedVersion is the sole ranked-eligibility signal (see schema.ts's own
// doc comment) -- null un-ranks the mod, any other value ranks it and pins
// it to exactly that version. A non-null value is validated against
// Thunderstore's own current version list before being handed to the
// gateway, which independently re-resolves and hashes that same version's
// real downloaded/extracted content -- see mods.gateway.ts's
// setRankedVersion doc comment.
router.put('/mods/:modId', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const { rankedVersion } = req.body as { rankedVersion?: unknown }
		if (rankedVersion !== null && typeof rankedVersion !== 'string') {
			throw new AppError('rankedVersion must be a string or null', 400)
		}

		if (rankedVersion !== null) {
			const versions = await fetchThunderstorePackageVersions(req.params.modId)
			if (!versions.some((v) => v.version === rankedVersion)) {
				throw new AppError('That version is not currently on Thunderstore', 400)
			}
		}

		const result = await setRankedVersion(req.params.modId, rankedVersion)
		if (!result.ok) {
			if (result.reason === 'not-found') {
				throw new AppError('Mod not found', 404)
			}
			throw new AppError(
				"Couldn't compute a hash for this version -- check the server logs (mod-version-hash) for why the download/extraction failed, then try again",
				400,
			)
		}
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

// Mirrors the public GET /api/mods/:id. Registered after the more specific
// /mods/:id/versions path above so that path isn't swallowed by this
// wildcard (both share the GET method).
router.get('/mods/:modId', async (req, res, next) => {
	try {
		const mod = await getPublicModById(req.params.modId)
		if (!mod) throw new AppError('Mod not found', 404)
		res.json(mod)
	} catch (err) {
		next(err)
	}
})

export default router
