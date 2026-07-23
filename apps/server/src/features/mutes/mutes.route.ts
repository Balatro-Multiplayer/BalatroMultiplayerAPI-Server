import { Router } from 'express'
import { authenticate } from '../../middleware/authenticate.js'
import { AppError } from '../../shared/utils/errors.js'
import { getSession } from '../../state/index.js'
import { addMute, removeMute } from '../../infrastructure/gateways/mute.gateway.js'

// Self-service mutes: a player acting on their own account (authenticate-gated,
// like auth.route.ts's /preferences/* routes), not a moderator action -- unlike
// bans, there is no admin-secret gate here. Enforcement is entirely client-side
// (see the design doc's §14.4); this router only persists the relationship and
// keeps the in-memory session's mutedPlayerIds (bundled into every playerPayload)
// in sync, so a client never needs to re-fetch after mute/unmute.
export function createMutesRouter(): Router {
	const router = Router()

	router.post('/:targetId', authenticate, async (req, res, next) => {
		try {
			const session = getSession(req.player!.playerId)
			if (!session) throw new AppError('Session not found', 401)

			const targetId = req.params.targetId as string
			if (targetId === session.playerId) {
				throw new AppError('Cannot mute yourself', 400)
			}

			await addMute(session.playerId, targetId)
			if (!session.mutedPlayerIds.includes(targetId)) {
				session.mutedPlayerIds.push(targetId)
			}

			res.json({ mutedPlayerIds: session.mutedPlayerIds })
		} catch (err) {
			next(err)
		}
	})

	router.delete('/:targetId', authenticate, async (req, res, next) => {
		try {
			const session = getSession(req.player!.playerId)
			if (!session) throw new AppError('Session not found', 401)

			const targetId = req.params.targetId as string
			await removeMute(session.playerId, targetId)
			session.mutedPlayerIds = session.mutedPlayerIds.filter((id) => id !== targetId)

			res.json({ mutedPlayerIds: session.mutedPlayerIds })
		} catch (err) {
			next(err)
		}
	})

	return router
}
