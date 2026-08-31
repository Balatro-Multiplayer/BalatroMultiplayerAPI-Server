import { Router } from 'express'
import {
	getPublicModById,
	getPublicProfileBySlug,
	listPublicMods,
	listPublicProfiles,
} from '../../infrastructure/gateways/mods.gateway.js'

// Public, launcher/website/mod-facing endpoint. No auth -- same trust level as
// /api/releases. GET /api/mods is the compact list (id/name/rankedVersion/
// sourceType/latestVersion/thumbnail -- a mod is ranked-allowed iff
// rankedVersion is non-null, see schema.ts's rankedVersion doc comment);
// GET /api/mods/:id adds everything else, including the hash the launcher
// verifies a downloaded mod archive against.
//
// /profiles and /profiles/:slug are registered before /:id so they aren't
// swallowed by the modId wildcard -- modIds are "Author@ModName", so a
// collision is unlikely in practice, but registration order makes it
// impossible regardless.
const router = Router()

router.get('/', async (_req, res, next) => {
	try {
		res.json(await listPublicMods())
	} catch (err) {
		next(err)
	}
})

router.get('/profiles', async (_req, res, next) => {
	try {
		res.json(await listPublicProfiles())
	} catch (err) {
		next(err)
	}
})

router.get('/profiles/:slug', async (req, res, next) => {
	try {
		const profile = await getPublicProfileBySlug(req.params.slug)
		if (!profile) {
			res.status(404).json({ error: 'Profile not found' })
			return
		}
		res.json(profile)
	} catch (err) {
		next(err)
	}
})

router.get('/:id', async (req, res, next) => {
	try {
		const mod = await getPublicModById(req.params.id)
		if (!mod) {
			res.status(404).json({ error: 'Mod not found' })
			return
		}
		res.json(mod)
	} catch (err) {
		next(err)
	}
})

export default router
