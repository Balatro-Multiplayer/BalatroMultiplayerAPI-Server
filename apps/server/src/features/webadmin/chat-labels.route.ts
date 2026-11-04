import { Router } from 'express'
import { listChatLabels } from '../../infrastructure/gateways/flagged-chat.gateway.js'
import { labelsCsv } from '../service-queue/flagged-chat.js'

// The training labels flagged chat decisions saved. The admin guard is
// applied where the router is mounted (webadmin.route.ts).
const router = Router()

router.get('/chat-labels/export', async (_req, res, next) => {
	try {
		const csv = labelsCsv(await listChatLabels())
		res.setHeader('Content-Type', 'text/csv; charset=utf-8')
		res.setHeader(
			'Content-Disposition',
			'attachment; filename="chat-labels.csv"',
		)
		res.send(csv)
	} catch (err) {
		next(err)
	}
})

export default router
