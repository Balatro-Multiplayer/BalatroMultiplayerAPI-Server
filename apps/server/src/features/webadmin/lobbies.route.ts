import { Router } from 'express'
import { AppError } from '../../shared/utils/errors.js'
import { getLobby, lobbies } from '../../state/index.js'
import type { PlayerSession } from '../../state/player.js'

const router = Router()

function matchesSearch(
	term: string,
	code: string,
	players: PlayerSession[],
): boolean {
	if (code.toLowerCase().includes(term)) return true
	return players.some(
		(p) =>
			p.steamName.toLowerCase().includes(term) ||
			p.discordUsername?.toLowerCase().includes(term) ||
			p.getDisplayName().toLowerCase().includes(term),
	)
}

router.get('/lobbies', async (req, res, next) => {
	try {
		const page = Math.max(1, Number(req.query.page ?? 1))
		const limit = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)))
		const search =
			typeof req.query.search === 'string'
				? req.query.search.trim().toLowerCase()
				: ''

		const all = Array.from(lobbies.values())
			.filter(
				(lobby) =>
					!search ||
					matchesSearch(search, lobby.code, Array.from(lobby.players.values())),
			)
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())

		const total = all.length
		const offset = (page - 1) * limit
		const pageItems = all.slice(offset, offset + limit).map((lobby) => ({
			code: lobby.code,
			modId: lobby.modId,
			type: lobby.type,
			hostId: lobby.hostId,
			hostName: lobby.players.get(lobby.hostId)?.getDisplayName() ?? null,
			playerCount: lobby.playerCount,
			maxPlayers: lobby.maxPlayers,
			createdAt: lobby.createdAt.toISOString(),
			isReported: lobby.isReported,
		}))

		res.json({ lobbies: pageItems, total, page, limit })
	} catch (err) {
		next(err)
	}
})

router.get('/lobbies/:code', async (req, res, next) => {
	try {
		const lobby = getLobby(req.params.code)
		if (!lobby) throw new AppError('Lobby not found', 404)

		const { lobbyService } = await import('../../routes/index.js')
		const players = lobbyService.getLobbyPlayers(lobby.code)

		res.json({
			lobby: {
				code: lobby.code,
				modId: lobby.modId,
				type: lobby.type,
				hostId: lobby.hostId,
				maxPlayers: lobby.maxPlayers,
				playerCount: lobby.playerCount,
				metadata: lobby.metadata,
				createdAt: lobby.createdAt.toISOString(),
				isReported: lobby.isReported,
			},
			players,
		})
	} catch (err) {
		next(err)
	}
})

router.post('/lobbies/:code/kick/:playerId', async (req, res, next) => {
	try {
		const { lobbyService } = await import('../../routes/index.js')
		await lobbyService.adminKickPlayer(
			req.params.code,
			req.params.playerId,
			req.player!.playerId,
		)

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
		const { lobbyService } = await import('../../routes/index.js')
		await lobbyService.adminCloseLobby(req.params.code, req.player!.playerId)

		console.log(
			`[webadmin] ${req.player!.playerId} closed lobby ${req.params.code}`,
		)
		res.json({ ok: true })
	} catch (err) {
		next(err)
	}
})

export default router
