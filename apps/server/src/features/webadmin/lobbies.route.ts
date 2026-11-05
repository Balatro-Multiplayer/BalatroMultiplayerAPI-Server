import { Router } from 'express'
import {
	closeNakamaLobby,
	getNakamaLobby,
	kickFromNakamaLobby,
	listNakamaLobbies,
} from '../../infrastructure/nakama/moderation-sync.js'
import { findPlayerIdsByNakamaUserIds } from '../../infrastructure/gateways/player.gateway.js'
import { getActiveRunIdForLobbyCode } from '../../infrastructure/gateways/replay-log.gateway.js'
import { AppError } from '../../shared/utils/errors.js'
import { MAX_PAGE, queryInt } from '../../shared/utils/query-int.js'
import { logStaffAction, requireReason } from './staff-action.js'

const router = Router()

router.get('/lobbies', async (req, res, next) => {
	try {
		const page = queryInt(req.query.page, 1, 1, MAX_PAGE)
		const limit = queryInt(req.query.limit, 50, 1, 100)
		const search =
			typeof req.query.search === 'string'
				? req.query.search.trim().toLowerCase()
				: ''

		const all = (await listNakamaLobbies())
			.filter((lobby) => !search || lobby.code.toLowerCase().includes(search))
			.map((lobby) => ({
				source: 'nakama' as const,
				code: lobby.code,
				modId: lobby.modId,
				type: lobby.type,
				hostId: null,
				hostName: null,
				started: lobby.started,
				mode: lobby.mode,
				playerCount: lobby.size,
				maxPlayers: lobby.max,
				createdAt: null,
				isReported: false,
			}))
		const total = all.length
		const offset = (page - 1) * limit
		const pageItems = all.slice(offset, offset + limit)

		res.json({ lobbies: pageItems, total, page, limit })
	} catch (err) {
		next(err)
	}
})

router.get('/lobbies/:code', async (req, res, next) => {
	try {
		const nakama = await getNakamaLobby(req.params.code)
		if (nakama) {
			const [playerIds, runId] = await Promise.all([
				findPlayerIdsByNakamaUserIds(nakama.players.map((p) => p.id)),
				nakama.started ? getActiveRunIdForLobbyCode(nakama.code) : null,
			])
			res.json({
				lobby: {
					source: 'nakama',
					code: nakama.code,
					modId: nakama.modId,
					type: null,
					hostId: nakama.hostId,
					maxPlayers: nakama.maxPlayers,
					playerCount: nakama.players.length,
					metadata: nakama.metadata,
					createdAt: new Date(nakama.createdAt).toISOString(),
					isReported: false,
					started: nakama.started,
					runId,
				},
				// playerId is the site player (for the player page and for kick
				// logs); null when the Nakama user has no player row.
				players: nakama.players.map((p) => ({
					...p,
					playerId: playerIds.get(p.id) ?? null,
				})),
			})
			return
		}
		throw new AppError('Lobby not found', 404)
	} catch (err) {
		next(err)
	}
})

router.post('/lobbies/:code/kick/:playerId', async (req, res, next) => {
	try {
		const staffReason = requireReason(req)
		const reason = `admin:${req.player!.playerId}`
		if (
			!(await kickFromNakamaLobby(req.params.code, req.params.playerId, reason))
		) {
			throw new AppError('Lobby or player not found', 404)
		}
		await logStaffAction(req, {
			action: 'lobby_kick',
			reason: staffReason,
			targetPlayerId: req.params.playerId,
			detail: { code: req.params.code },
		})

		console.log(
			`[webadmin] ${req.player!.playerId} kicked ${req.params.playerId} from lobby ${req.params.code}`,
		)
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

router.post('/lobbies/:code/close', async (req, res, next) => {
	try {
		const reason = requireReason(req)
		if (!(await closeNakamaLobby(req.params.code)))
			throw new AppError('Lobby not found', 404)
		await logStaffAction(req, {
			action: 'lobby_close',
			reason,
			detail: { code: req.params.code },
		})

		console.log(
			`[webadmin] ${req.player!.playerId} closed lobby ${req.params.code}`,
		)
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

export default router
