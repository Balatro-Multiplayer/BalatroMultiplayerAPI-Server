import { Router } from 'express'
import {
	findBanEvasionMatches,
	getHardwareIdCoverage,
} from '../../infrastructure/gateways/launcher-integrity.gateway.js'

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

// "ID types captured, per platform" summary on the same page - a separate
// call rather than folding into the response above, since it's
// conceptually distinct (global collection coverage vs. specific
// suspected-alt matches) and only needs recomputing on page load, not on
// every match-list refresh.
router.get('/hardware-id-coverage', async (_req, res, next) => {
	try {
		const coverage = await getHardwareIdCoverage()
		res.json(coverage)
	} catch (err) {
		next(err)
	}
})

export default router
