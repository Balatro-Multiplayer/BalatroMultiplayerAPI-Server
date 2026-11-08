import { Router } from 'express'
import {
	type TournamentListStatus,
	closeNakamaTournament,
	getNakamaTournament,
	getTournamentCreationRestricted,
	listNakamaTournaments,
	setTournamentCreationRestricted,
} from '../../infrastructure/nakama/tournament-sync.js'
import { AppError } from '../../shared/utils/errors.js'
import { MAX_PAGE, queryInt } from '../../shared/utils/query-int.js'
import { requireAdmin } from '../../shared/utils/require-admin.js'
import { logStaffAction, requireReason } from './staff-action.js'

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

// Whether creating a tournament needs a privilege. Before /tournaments/:id.
router.get('/tournaments/settings', async (_req, res, next) => {
	try {
		const result = await getTournamentCreationRestricted()
		if (!result.ok) throw unavailable()
		res.json({ creationRestricted: result.value })
	} catch (err) {
		next(err)
	}
})

// Admins only, like the other server switches (config.route.ts).
router.put('/tournaments/settings', async (req, res, next) => {
	try {
		await requireAdmin(req)
		const { creationRestricted } = req.body as { creationRestricted?: unknown }
		if (typeof creationRestricted !== 'boolean')
			throw new AppError('creationRestricted must be true or false', 400)
		const reason = requireReason(req)
		const before = await getTournamentCreationRestricted()
		const result = await setTournamentCreationRestricted(creationRestricted)
		if (!result.ok) throw unavailable()
		await logStaffAction(req, {
			action: 'config_change',
			reason,
			detail: {
				old: before.ok ? { tournamentCreationRestricted: before.value } : null,
				new: { tournamentCreationRestricted: creationRestricted },
			},
		})
		res.json({ creationRestricted })
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
		// Players see the reason in game, so it is shorter than the staff
		// log's usual limit.
		const reason = requireReason(req)
		if (reason.length > REASON_MAX)
			throw new AppError(
				`The reason can be at most ${REASON_MAX} characters`,
				400,
			)
		// For the staff log: which tournament, by name, as it was.
		const before = await getNakamaTournament(req.params.id)

		const result = await closeNakamaTournament(req.params.id, reason)
		if (!result.ok) {
			if (result.error === 'not_found')
				throw new AppError('Tournament not found', 404)
			if (result.error === 'refused')
				throw new AppError('This tournament has already ended', 409)
			throw unavailable()
		}

		await logStaffAction(req, {
			action: 'tournament_close',
			reason,
			detail: {
				tournamentId: req.params.id,
				name: before.ok ? before.value.name : null,
				organiser: before.ok ? before.value.organiser : null,
			},
		})

		console.log(
			`[webadmin] ${req.player?.playerId} closed tournament ${req.params.id}`,
		)
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

export default router
