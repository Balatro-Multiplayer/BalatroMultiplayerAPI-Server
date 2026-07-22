// Game-config endpoints, mounted at /api/config. Read-only, authenticated.

import { Router } from 'express'
import { authenticate } from '../../middleware/authenticate.js'
import { getWeeklyCocktail } from './weekly-cocktail.js'

const router = Router()

router.use(authenticate)

router.get('/weekly-cocktail', (_req, res) => {
	res.status(200).json(getWeeklyCocktail())
})

export default router
