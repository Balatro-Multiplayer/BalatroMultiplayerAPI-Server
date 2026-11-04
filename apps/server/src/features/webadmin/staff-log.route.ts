import { Router } from 'express'
import { listStaffLog } from '../../infrastructure/gateways/staff-log.gateway.js'
import { isStaffAction } from '../../shared/staff-log/actions.js'
import { AppError } from '../../shared/utils/errors.js'
import { MAX_PAGE, queryInt } from '../../shared/utils/query-int.js'
import { staffOf } from '../service-queue/staff.js'

// The staff log page's data. An admin reads every entry; a moderator reads
// their own and those taken on queue items (the gateway applies the rule).
const router = Router()

function textOf(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function dateOf(value: unknown, field: string): Date | undefined {
	const text = textOf(value)
	if (!text) return undefined
	const date = new Date(text)
	if (Number.isNaN(date.getTime())) throw new AppError(`${field} is not a valid date`, 400)
	return date
}

router.get('/staff-log', async (req, res, next) => {
	try {
		const staff = await staffOf(req)
		if (!staff) throw new AppError('Forbidden', 403)
		const page = queryInt(req.query.page, 1, 1, MAX_PAGE)
		const limit = queryInt(req.query.limit, 50, 1, 100)
		const action = textOf(req.query.action)
		if (action !== undefined && !isStaffAction(action)) throw new AppError('Unknown action', 400)
		const { entries, total } = await listStaffLog(staff, {
			staff: textOf(req.query.staff),
			player: textOf(req.query.player),
			action,
			from: dateOf(req.query.from, 'from'),
			to: dateOf(req.query.to, 'to'),
			page,
			limit,
		})
		res.json({ entries, total, page, limit, pages: Math.ceil(total / limit) })
	} catch (err) {
		next(err)
	}
})

export default router
