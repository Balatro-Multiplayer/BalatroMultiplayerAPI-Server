// Draft endpoints, mounted at /api/matches:
//   POST /:matchId/draft-pool -> issue (or re-fetch) the server-generated pool
// Opt-in: a mod that never calls this keeps a fully client-side draft, no server state.

import { Router } from 'express'
import { authenticate } from '../../middleware/authenticate.js'
import { matches } from '../../state/matchmaking.js'
import { getDraftPolicy } from './draft-policy.js'
import { InMemoryDraftRepository } from './draft.repository.js'
import { parseMatchIdParam } from './draft.request.js'
import { makeDraftService } from './draft.service.js'

const service = makeDraftService({
	repo: new InMemoryDraftRepository(),
	getMatch: (matchId) => {
		const match = matches.get(matchId)
		if (!match) return undefined
		return {
			matchId: match.matchId,
			modId: match.modId,
			gameMode: match.gameMode,
			playerIds: match.playerIds,
		}
	},
	getPolicy: getDraftPolicy,
})

const router = Router()

router.use(authenticate)

router.post('/:matchId/draft-pool', async (req, res, next) => {
	try {
		const matchId = parseMatchIdParam(req.params)
		const result = await service.issueDraftPool(matchId, req.player!.playerId)
		res.status(200).json(result)
	} catch (err) {
		next(err)
	}
})

export default router
