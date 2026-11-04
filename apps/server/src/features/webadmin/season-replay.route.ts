import { Router } from 'express'
import { getSeasonForReplay } from '../../infrastructure/gateways/rating.gateway.js'
import { AppError } from '../../shared/utils/errors.js'
import { logStaffAction, requireReason } from './staff-action.js'
import { requireOwner } from '../../shared/utils/require-owner.js'
import { activeRankedGames } from '../ratings/active-ranked-games.js'
import { seasonReplayApplyFor } from '../ratings/season-replay-apply.deps.js'
import type { ApplyRefusal } from '../ratings/season-replay-apply.service.js'
import {
	callNakama,
	replaySeason,
	runsMayBePurged,
} from '../ratings/season-replay.service.js'

// Owner-only. The dry run replays the current Season's ranked games under the
// current rating rules and returns each player's rating before and after; it
// writes nothing. The apply repeats the replay, refuses unless it matches the
// dry run's token, then replaces the Season board (season-replay-apply.service.ts).
const router = Router()

const REFUSAL_STATUS: Record<ApplyRefusal['code'], number> = {
	active_games: 409,
	stale_token: 409,
	retention_risk: 409,
	nakama: 503,
	failed: 500,
	no_backup: 404,
}

function messageOf(refusal: ApplyRefusal): string {
	switch (refusal.code) {
		case 'active_games':
			return `${refusal.count} ranked game(s) are running. Apply when none is.`
		case 'stale_token':
			return 'The replay changed since the dry run you saw. Run the dry run again.'
		case 'retention_risk':
			return 'This Season started before the run retention window, so some of its runs may be purged. The replay would miss them.'
		case 'nakama':
			return `Nakama did not take the step: ${refusal.reason}${refusal.backupId ? ` (backup ${refusal.backupId})` : ''}`
		case 'failed':
			return `${refusal.reason} (backup ${refusal.backupId})`
		case 'no_backup':
			return 'There is no such backup'
	}
}

router.post('/ratings/season-replay', async (req, res, next) => {
	try {
		await requireOwner(req)
		const season = await getSeasonForReplay()
		if (!season) throw new AppError('There is no season to replay', 409)
		const result = await replaySeason(season.startedAt)
		if (!result.ok) {
			throw new AppError(`Nakama did not run the replay: ${result.error}`, 503)
		}
		const active = await activeRankedGames(callNakama)
		if (!active.ok) {
			throw new AppError(
				`Nakama did not count the running games: ${active.error}`,
				503,
			)
		}
		res.json({
			season: { id: season.id, name: season.name, startedAt: season.startedAt },
			...result.value,
			activeRankedGames: active.value,
			retentionRisk: runsMayBePurged(season.startedAt, new Date()),
		})
	} catch (err) {
		next(err)
	}
})

router.post('/ratings/season-replay/apply', async (req, res, next) => {
	try {
		await requireOwner(req)
		const reason = requireReason(req)
		const { token } = req.body ?? {}
		if (typeof token !== 'string' || token === '')
			throw new AppError('token is required: apply the dry run you saw', 400)
		const season = await getSeasonForReplay()
		if (!season) throw new AppError('There is no season to replay', 409)
		const result = await seasonReplayApplyFor(req.player!.playerId).apply(
			season,
			token,
			req.player!.playerId,
		)
		if (!result.ok) {
			res.status(REFUSAL_STATUS[result.error.code]).json({
				error: messageOf(result.error),
				code: result.error.code,
				...(result.error.code === 'active_games'
					? { activeGames: result.error.count }
					: {}),
			})
			return
		}
		await logStaffAction(req, {
			action: 'season_replay_apply',
			reason,
			detail: { seasonId: season.id, result: result.value },
		})
		res.json(result.value)
	} catch (err) {
		next(err)
	}
})

// Puts a backup of the apply back.
router.post('/ratings/season-replay/restore', async (req, res, next) => {
	try {
		await requireOwner(req)
		const reason = requireReason(req)
		const { backupId } = req.body ?? {}
		if (typeof backupId !== 'string' || backupId === '')
			throw new AppError('backupId is required', 400)
		const result = await seasonReplayApplyFor(req.player!.playerId).restore(
			backupId,
		)
		if (!result.ok) {
			res.status(REFUSAL_STATUS[result.error.code]).json({
				error: messageOf(result.error),
				code: result.error.code,
			})
			return
		}
		await logStaffAction(req, {
			action: 'season_replay_restore',
			reason,
			detail: { backupId, result: result.value },
		})
		res.json(result.value)
	} catch (err) {
		next(err)
	}
})

export default router
