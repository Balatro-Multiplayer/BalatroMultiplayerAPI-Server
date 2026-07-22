// Weekly-cocktail admin endpoints (draft feature, mounted under /admin so the
// public path is unchanged). Rotation applies at the next match start, no
// redeploy. Auth: shared x-admin-secret header, same as other /admin routes.
//   GET /admin/weekly-cocktail
//   PUT /admin/weekly-cocktail  { "name": "Casjb", "decks": ["b_green", ...] }

import { type Request, Router } from 'express'
import { env } from '../../env.js'
import { AppError } from '../../shared/utils/errors.js'
import { getWeeklyCocktail, setWeeklyCocktail } from './weekly-cocktail.js'

const router = Router()

// Inline (not middleware) to mirror the other /admin handlers' auth style.
function assertAdmin(req: Request): void {
	if (req.headers['x-admin-secret'] !== env.ADMIN_SECRET)
		throw new AppError('Unauthorized', 401)
}

router.get('/weekly-cocktail', (req, res, next) => {
	try {
		assertAdmin(req)
		res.json(getWeeklyCocktail())
	} catch (err) {
		next(err)
	}
})

router.put('/weekly-cocktail', async (req, res, next) => {
	try {
		assertAdmin(req)
		res.json(await setWeeklyCocktail(req.body))
	} catch (err) {
		next(err)
	}
})

export default router
