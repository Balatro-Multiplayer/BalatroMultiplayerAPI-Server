import { Router } from 'express'
import { findBanEvasionMatches } from '../../infrastructure/gateways/launcher-integrity.gateway.js'

// Mounted under webadmin.route.ts's router, which already gates every route
// here behind the shared admin-or-moderator `webAdmin` middleware - no
// separate access check needed in this file, same as every other route
// module registered there.
const router = Router()

router.get('/ban-evasion', async (_req, res, next) => {
	try {
		const matches = await findBanEvasionMatches()
		res.json({ matches })
	} catch (err) {
		next(err)
	}
})

export default router
