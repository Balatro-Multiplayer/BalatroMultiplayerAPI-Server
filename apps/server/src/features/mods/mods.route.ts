import { Router } from 'express'
import {
	getPublicModById,
	listPublicMods,
} from '../../infrastructure/gateways/mods.gateway.js'

// Public, launcher/website/mod-facing endpoint. No auth -- same trust level as
// /api/releases. GET /api/mods is the compact list (id/name/allowedInRanked/
// latestVersion/thumbnail); GET /api/mods/:id adds everything else, including
// the hash the launcher verifies a downloaded mod archive against.
const router = Router()

router.get('/', async (_req, res, next) => {
	try {
		res.json(await listPublicMods())
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
