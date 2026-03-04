import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { authenticate } from '../middleware/authenticate.js'
import {
	authenticateAsTemp,
	authenticateWithDiscord,
	authenticateWithPlayerId,
	authenticateWithSteam,
	generateLinkState,
	getDiscordAuthUrl,
	linkDiscordToPlayer,
	linkSteamToPlayer,
	validateDiscordCode,
	validateSteamTicket,
	verifyLinkState,
} from '../services/auth.service.js'
import { issueRefreshToken, redeemRefreshToken } from '../services/refresh-token.service.js'
import { mqttService } from '../services/mqtt.service.js'
import { env } from '../env.js'
import { AppError } from '../utils/errors.js'
import { getLobby } from '../state/index.js'
import type { PlayerSession } from '../state/index.js'

function lobbyPayload(session: PlayerSession) {
	if (!session.lobbyCode) return undefined
	const lobby = getLobby(session.lobbyCode)
	if (!lobby) return undefined
	return {
		code: lobby.code,
		modId: lobby.modId,
		hostId: lobby.hostId,
		maxPlayers: lobby.maxPlayers,
		metadata: lobby.metadata,
		isHost: lobby.hostId === session.playerId,
	}
}

const router = Router()

const authRateLimiter = rateLimit({
	windowMs: 60 * 1000,
	limit: 5,
	standardHeaders: 'draft-7',
	legacyHeaders: false,
	message: { error: 'Too many auth requests, please try again later' },
	skip: () => env.NODE_ENV !== 'production',
})

router.use(authRateLimiter)

// --- Primary auth (creates or finds player) ---

router.post('/steam', async (req, res, next) => {
	try {
		const { ticket, username } = req.body

		if (!ticket || typeof ticket !== 'string') {
			throw new AppError('Missing or invalid Steam ticket', 400)
		}
		if (!username || typeof username !== 'string') {
			throw new AppError('Missing or invalid username', 400)
		}

		const { steamId } = await validateSteamTicket(ticket)
		const { session, token } = await authenticateWithSteam(steamId, username)
		const isTemp = !session.steamId
		const refreshToken = isTemp ? null : await issueRefreshToken(session.playerId)

		res.json({
			token,
			refreshToken,
			lobby: lobbyPayload(session),
			player: {
				id: session.playerId,
				username: session.username,
				steamId: session.steamId ?? null,
				discordId: session.discordId ?? null,
				discordUsername: session.discordUsername ?? null,
				lobbyCode: session.lobbyCode ?? null,
				isTemp: isTemp || undefined,
			},
		})
	} catch (err) {
		next(err)
	}
})

router.post('/dev', (req, res, next) => {
	try {
		if (env.NODE_ENV === 'production') {
			res.status(404).json({ error: 'Not found' })
			return
		}

		const { username } = req.body
		if (!username || typeof username !== 'string') {
			throw new AppError('Missing or invalid username', 400)
		}

		const { session, token } = authenticateAsTemp(username)

		res.json({
			token,
			refreshToken: null,
			player: {
				id: session.playerId,
				username: session.username,
				steamId: null,
				discordId: null,
				isTemp: true,
			},
		})
	} catch (err) {
		next(err)
	}
})

router.post('/refresh', async (req, res, next) => {
	try {
		const { refreshToken, username } = req.body

		if (!refreshToken || typeof refreshToken !== 'string') {
			throw new AppError('Missing or invalid refresh token', 400)
		}
		if (!username || typeof username !== 'string') {
			throw new AppError('Missing or invalid username', 400)
		}

		const playerId = await redeemRefreshToken(refreshToken)
		if (!playerId) {
			throw new AppError('Invalid or expired refresh token', 401)
		}

		const { session, token } = await authenticateWithPlayerId(
			playerId,
			username,
		)
		const newRefreshToken = await issueRefreshToken(session.playerId)

		res.json({
			token,
			refreshToken: newRefreshToken,
			lobby: lobbyPayload(session),
			player: {
				id: session.playerId,
				username: session.username,
				steamId: session.steamId,
				discordId: session.discordId,
				discordUsername: session.discordUsername ?? null,
				lobbyCode: session.lobbyCode ?? null,
			},
		})
	} catch (err) {
		next(err)
	}
})

router.get('/discord', (req, res) => {
	const state = req.query.state as string | undefined
	res.redirect(getDiscordAuthUrl(state))
})

router.get('/discord/callback', async (req, res, next) => {
	try {
		const code = req.query.code as string | undefined
		if (!code) {
			throw new AppError('Missing authorization code', 400)
		}

		const state = req.query.state as string | undefined
		const { discordId, username } = await validateDiscordCode(code)

		// If state is present, this is a link operation
		if (state) {
			const playerId = verifyLinkState(state)
			if (playerId) {
				await linkDiscordToPlayer(playerId, discordId, username)

				// Notify game client via MQTT
				await mqttService.publishToPlayer(playerId, 'account/discord_linked', {
					discordId,
					username,
				})

				res.setHeader('Content-Type', 'text/html')
				res.send(`<!DOCTYPE html>
<html><head><title>Discord Linked</title>
<style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0}
.card{text-align:center;padding:2rem;border-radius:12px;background:#16213e;box-shadow:0 4px 20px rgba(0,0,0,0.3)}
h1{color:#5865f2;margin-bottom:0.5rem}p{color:#a0a0b0}</style>
</head><body><div class="card"><h1>Discord Linked!</h1><p>You can close this tab and return to the game.</p></div></body></html>`)
				return
			}
		}

		// Otherwise, normal auth
		const { session, token } = await authenticateWithDiscord(discordId, username)

		res.json({
			token,
			lobby: lobbyPayload(session),
			player: {
				id: session.playerId,
				username: session.username,
				steamId: session.steamId,
				discordId: session.discordId,
				discordUsername: session.discordUsername ?? null,
				lobbyCode: session.lobbyCode ?? null,
			},
		})
	} catch (err) {
		next(err)
	}
})

// --- Linking (requires existing JWT) ---

router.post('/link/steam', authenticate, async (req, res, next) => {
	try {
		const { ticket } = req.body

		if (!ticket || typeof ticket !== 'string') {
			throw new AppError('Missing or invalid Steam ticket', 400)
		}

		const { steamId } = await validateSteamTicket(ticket)
		const { session, token } = await linkSteamToPlayer(
			req.player!.playerId,
			steamId,
		)

		res.json({
			token,
			player: {
				id: session.playerId,
				username: session.username,
				steamId: session.steamId,
				discordId: session.discordId,
			},
		})
	} catch (err) {
		next(err)
	}
})

router.post('/link/discord', authenticate, (req, res) => {
	const state = generateLinkState(req.player!.playerId)
	const url = getDiscordAuthUrl(state)
	res.json({ url })
})

export default router
