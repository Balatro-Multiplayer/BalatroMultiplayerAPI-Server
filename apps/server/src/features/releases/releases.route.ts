import { Router } from 'express'
import { listReleasesPublic } from '../../infrastructure/gateways/releases.gateway.js'

// Public, launcher-facing endpoint. GET /api/releases returns every release with
// its branch name (same shape the old site served). No auth — the launcher polls it.
const router = Router()

router.get('/', async (_req, res, next) => {
	try {
		res.json(await listReleasesPublic())
	} catch (err) {
		next(err)
	}
})

export default router
