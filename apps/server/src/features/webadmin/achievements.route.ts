import { Router } from 'express'
import { AppError } from '../../shared/utils/errors.js'
import { requireAdmin } from '../../shared/utils/require-admin.js'
import { logStaffAction, requireReason } from './staff-action.js'
import { backfillAchievements } from '../achievements/achievements-backfill.service.js'

// Runs the achievement backfill again (the API also runs it at boot). Forced:
// it fills any player still unfilled, and a player already filled is never
// filled twice, so running it again changes nothing for them.
const router = Router()

router.post('/achievements/backfill', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const reason = requireReason(req)
		const result = await backfillAchievements({ force: true })
		if (!result.ok) {
			if (result.error === 'off')
				throw new AppError('Avatar achievements are switched off', 409)
			throw new AppError(
				`Nakama did not run the backfill: ${result.error}`,
				503,
			)
		}
		await logStaffAction(req, { action: 'achievements_backfill', reason, detail: result.value })
		res.json({ ok: true, ...result.value })
	} catch (err) {
		next(err)
	}
})

export default router
