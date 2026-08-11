import { Router } from 'express'
import { and, count, desc, eq } from 'drizzle-orm'
import { db } from '../../infrastructure/db/index.js'
import { matchmakingMatches } from '../../infrastructure/db/schema.js'
import { replayLogService } from '../replay-log/replay-log.service.js'

// Sparse compared to the old log-extracted "games" table — the new backend only
// records matchmaking matches (no per-card extraction). Player display names are
// pulled from the lobbyState snapshot when present.
const router = Router()

router.get('/matches', async (req, res, next) => {
	try {
		const page = Math.max(1, Number(req.query.page ?? 1))
		const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize ?? 50)))
		const offset = (page - 1) * pageSize

		const conds = []
		if (typeof req.query.modId === 'string' && req.query.modId)
			conds.push(eq(matchmakingMatches.modId, req.query.modId))
		if (typeof req.query.gameMode === 'string' && req.query.gameMode)
			conds.push(eq(matchmakingMatches.gameMode, req.query.gameMode))
		if (typeof req.query.status === 'string' && req.query.status)
			conds.push(eq(matchmakingMatches.status, req.query.status))
		const where = conds.length > 0 ? and(...conds) : undefined

		const [{ total }] = await db
			.select({ total: count() })
			.from(matchmakingMatches)
			.where(where)

		const rows = await db
			.select({
				matchId: matchmakingMatches.matchId,
				lobbyCode: matchmakingMatches.lobbyCode,
				modId: matchmakingMatches.modId,
				gameMode: matchmakingMatches.gameMode,
				status: matchmakingMatches.status,
				players: matchmakingMatches.players,
				lobbyState: matchmakingMatches.lobbyState,
				gameStartedAt: matchmakingMatches.gameStartedAt,
				createdAt: matchmakingMatches.createdAt,
			})
			.from(matchmakingMatches)
			.where(where)
			.orderBy(desc(matchmakingMatches.createdAt))
			.limit(pageSize)
			.offset(offset)

		// Exact join to this page's RLOG runs (lobbyRuns.matchmakingMatchId,
		// populated at run-creation time -- see replay-log.service.ts) so the
		// admin page can offer a "View Log" link per match, not a lobby-code
		// guess (codes get reused across unrelated lobby instances over time).
		const runIdByMatchId = await replayLogService.getRunIdsForMatchIds(
			rows.map((m) => m.matchId),
		)

		const data = rows.map((m) => {
			const ids = Array.isArray(m.players) ? (m.players as string[]) : []
			const infos =
				(m.lobbyState as { playerInfos?: Record<string, { displayName?: string }> } | null)
					?.playerInfos ?? {}
			return {
				matchId: m.matchId,
				lobbyCode: m.lobbyCode,
				modId: m.modId,
				gameMode: m.gameMode,
				status: m.status,
				gameStartedAt: m.gameStartedAt,
				createdAt: m.createdAt,
				playerNames: ids.map((id) => infos[id]?.displayName ?? id),
				runId: runIdByMatchId.get(m.matchId) ?? null,
			}
		})

		res.json({ data, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) })
	} catch (err) {
		next(err)
	}
})

export default router
