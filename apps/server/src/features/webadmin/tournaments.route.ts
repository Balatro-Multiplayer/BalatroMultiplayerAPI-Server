import { Router } from 'express'
import {
	type TournamentListStatus,
	closeNakamaTournament,
	getNakamaTournament,
	listNakamaTournaments,
} from '../../infrastructure/nakama/tournament-sync.js'
import { AppError } from '../../shared/utils/errors.js'
import { MAX_PAGE, queryInt } from '../../shared/utils/query-int.js'

// The webadmin Tournaments page: every tournament (private ones and drafts
// too), one tournament's details, and closing one with a reason the players
// see. Admins and moderators (webadmin.route.ts).

const ID_PATTERN = /^[0-9a-f-]{36}$/
// Nakama keeps the first 200 characters of the reason (closeByModerator).
const REASON_MAX = 200
const STATUSES: TournamentListStatus[] = ['active', 'over', 'all']

const router = Router()

const unavailable = () => new AppError('The game server is not reachable', 503)

router.get('/tournaments', async (req, res, next) => {
	try {
		const page = queryInt(req.query.page, 1, 1, MAX_PAGE)
		const limit = queryInt(req.query.limit, 50, 1, 100)
		const status = STATUSES.find((s) => s === req.query.status) ?? 'active'
		const search =
			typeof req.query.search === 'string'
				? req.query.search.trim().slice(0, 100)
				: ''

		const result = await listNakamaTournaments(status, search)
		if (!result.ok) throw unavailable()
		const all = result.value
		const offset = (page - 1) * limit
		res.json({
			tournaments: all.slice(offset, offset + limit),
			total: all.length,
			page,
			limit,
		})
	} catch (err) {
		next(err)
	}
})

router.get('/tournaments/:id', async (req, res, next) => {
	try {
		if (!ID_PATTERN.test(req.params.id))
			throw new AppError('Tournament not found', 404)
		const result = await getNakamaTournament(req.params.id)
		if (!result.ok)
			throw result.error === 'not_found'
				? new AppError('Tournament not found', 404)
				: unavailable()
		res.json({ tournament: result.value })
	} catch (err) {
		next(err)
	}
})

router.post('/tournaments/:id/close', async (req, res, next) => {
	try {
		if (!ID_PATTERN.test(req.params.id))
			throw new AppError('Tournament not found', 404)
		const { reason } = req.body as { reason?: unknown }
		if (typeof reason !== 'string' || reason.trim() === '')
			throw new AppError('A reason is required', 400)
		if (reason.length > REASON_MAX)
			throw new AppError(
				`The reason can be at most ${REASON_MAX} characters`,
				400,
			)

		const result = await closeNakamaTournament(req.params.id, reason.trim())
		if (!result.ok) {
			if (result.error === 'not_found')
				throw new AppError('Tournament not found', 404)
			if (result.error === 'refused')
				throw new AppError('This tournament has already ended', 409)
			throw unavailable()
		}

		console.log(
			`[webadmin] ${req.player?.playerId} closed tournament ${req.params.id}: ${JSON.stringify(reason.trim())}`,
		)
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

export default router
