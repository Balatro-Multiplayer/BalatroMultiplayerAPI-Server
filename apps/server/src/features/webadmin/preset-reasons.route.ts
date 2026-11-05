import { Router } from 'express'
import {
	editPresetReasons,
	getPresetReasons,
} from '../../infrastructure/gateways/preset-reasons.gateway.js'
import { parseReason } from '../../shared/staff-log/actions.js'
import { AppError } from '../../shared/utils/errors.js'
import { requireAdmin } from '../../shared/utils/require-admin.js'
import { isItemType, parsePresetReasons } from '../service-queue/preset-reasons.js'

const router = Router()

// Every staff member reads the lists: the decision bar shows them as chips.
router.get('/preset-reasons', async (_req, res, next) => {
	try {
		res.json({ presetReasons: await getPresetReasons() })
	} catch (err) {
		next(err)
	}
})

// An admin replaces the list of one item type. The edit is a staff action and
// needs a note; the log keeps the lists before and after.
router.put('/config/preset-reasons/:itemType', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const { itemType } = req.params
		if (!isItemType(itemType)) throw new AppError('unknown queue item type', 404)
		const body = req.body as { reasons?: unknown; reason?: unknown }
		const parsed = parsePresetReasons(body.reasons)
		if (!parsed.ok) throw new AppError(parsed.message, 400)
		const note = parseReason(body.reason)
		if (!note.ok) throw new AppError(note.message, 400)
		const presetReasons = await editPresetReasons(
			{ playerId: req.player!.playerId, role: 'admin' },
			itemType,
			parsed.reasons,
			note.reason,
		)
		res.json({ presetReasons })
	} catch (err) {
		next(err)
	}
})

export default router
