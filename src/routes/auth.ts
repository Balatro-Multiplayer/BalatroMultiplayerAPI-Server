import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { authenticate } from '../middleware/authenticate.js'
import {
	acceptTos,
	authenticateAsTemp,
	authenticateWithDiscord,
	authenticateWithPlayerId,
	authenticateWithSteam,
	impersonatePlayer,
	generateLinkState,
	getDiscordAuthUrl,
	linkDiscordToPlayer,
	linkSteamToPlayer,
	setPreferredJoker,
	setUseDiscordName,
	signTosPendingToken,
	unlinkDiscordFromPlayer,
	validateDiscordCode,
	validateSteamTicket,
	verifyLinkState,
	verifyTosPendingToken,
} from '../services/auth.service.js'
import { getConfig } from '../state/config.js'
import { issueRefreshToken, redeemRefreshToken } from '../services/refresh-token.service.js'
import { mqttService } from '../services/mqtt.service.js'
import { env } from '../env.js'
import { AppError } from '../utils/errors.js'
import { getLobby } from '../state/index.js'
import type { PlayerSession } from '../state/index.js'
import { buildPrivilegeTable } from '../constants/privileges.js'

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
		players: Array.from(lobby.players.values()).map((p) => ({
			id: p.playerId,
			displayName: p.getDisplayName(),
			preferredJoker: p.preferredJoker,
		})),
	}
}

function playerPayload(session: PlayerSession, extra?: { isTemp?: boolean }) {
	return {
		id: session.playerId,
		steamName: session.steamName,
		displayName: session.getDisplayName(),
		useDiscordName: session.useDiscordName,
		preferredJoker: session.preferredJoker,
		discordLinked: session.discordIdHash != null,
		discordUsername: session.discordUsername ?? null,
		lobbyCode: session.lobbyCode ?? null,
		privileges: buildPrivilegeTable(session.privileges),
		...(extra?.isTemp ? { isTemp: true } : {}),
	}
}

function configPayload() {
	return getConfig()
}

function tosGate(session: PlayerSession): { tosRequired: true; tosUpdate: boolean; token: string } | null {
	const { tosVersion } = getConfig()
	if (session.tosAcceptedVersion < tosVersion) {
		return { tosRequired: true, tosUpdate: session.tosAcceptedVersion > 0, token: signTosPendingToken(session.playerId) }
	}
	return null
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
		const { ticket, steamName } = req.body

		if (!ticket || typeof ticket !== 'string') {
			throw new AppError('Missing or invalid Steam ticket', 400)
		}
		if (!steamName || typeof steamName !== 'string') {
			throw new AppError('Missing or invalid steamName', 400)
		}

		const { steamId } = await validateSteamTicket(ticket)
		const { session, token } = await authenticateWithSteam(steamId, steamName)
		const isTemp = !session.steamIdHash

		const gate = isTemp ? null : tosGate(session)
		if (gate) {
			res.json(gate)
			return
		}

		const refreshToken = isTemp ? null : await issueRefreshToken(session.playerId)

		res.json({
			token,
			refreshToken,
			lobby: lobbyPayload(session),
			player: playerPayload(session, { isTemp: isTemp || undefined }),
			serverConfig: configPayload(),
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

		const { steamName } = req.body
		if (!steamName || typeof steamName !== 'string') {
			throw new AppError('Missing or invalid steamName', 400)
		}

		const { session, token } = authenticateAsTemp(steamName)

		res.json({
			token,
			refreshToken: null,
			player: playerPayload(session, { isTemp: true }),
		})
	} catch (err) {
		next(err)
	}
})

router.post('/dev/impersonate', async (req, res, next) => {
	try {
		if (env.NODE_ENV === 'production') {
			res.status(404).json({ error: 'Not found' })
			return
		}

		const { playerId, steamId, discordId, steamName } = req.body
		if (!playerId && !steamId && !discordId && !steamName) {
			throw new AppError('Provide playerId, steamId, discordId, or steamName', 400)
		}

		const { session, token } = await impersonatePlayer({ playerId, steamId, discordId, steamName })

		res.json({
			token,
			refreshToken: null,
			lobby: lobbyPayload(session),
			player: playerPayload(session),
		})
	} catch (err) {
		next(err)
	}
})

router.post('/refresh', async (req, res, next) => {
	try {
		const { refreshToken, steamName } = req.body

		if (!refreshToken || typeof refreshToken !== 'string') {
			throw new AppError('Missing or invalid refresh token', 400)
		}
		if (!steamName || typeof steamName !== 'string') {
			throw new AppError('Missing or invalid steamName', 400)
		}

		const playerId = await redeemRefreshToken(refreshToken)
		if (!playerId) {
			throw new AppError('Invalid or expired refresh token', 401)
		}

		const { session, token } = await authenticateWithPlayerId(
			playerId,
			steamName,
		)

		const gate = tosGate(session)
		if (gate) {
			const newRefreshToken = await issueRefreshToken(session.playerId)
			res.json({ ...gate, refreshToken: newRefreshToken })
			return
		}

		const newRefreshToken = await issueRefreshToken(session.playerId)

		res.json({
			token,
			refreshToken: newRefreshToken,
			lobby: lobbyPayload(session),
			player: playerPayload(session),
			serverConfig: configPayload(),
		})
	} catch (err) {
		next(err)
	}
})

router.post('/accept-tos', async (req, res, next) => {
	try {
		const authHeader = req.headers.authorization
		const pendingToken =
			authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null
		if (!pendingToken) throw new AppError('Missing pending token', 401)

		const playerId = verifyTosPendingToken(pendingToken)
		if (!playerId) throw new AppError('Invalid or expired ToS token', 401)

		const { session, token } = await acceptTos(playerId)
		const refreshToken = await issueRefreshToken(session.playerId)

		res.json({
			token,
			refreshToken,
			lobby: lobbyPayload(session),
			player: playerPayload(session),
			serverConfig: configPayload(),
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
		const { discordId, discordName } = await validateDiscordCode(code)

		// If state is present, this is a link operation
		if (state) {
			const playerId = verifyLinkState(state)
			if (playerId) {
				await linkDiscordToPlayer(playerId, discordId, discordName)

				// Notify game client via MQTT
				await mqttService.publishToPlayer(playerId, 'account/discord_linked', {
					discordName,
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
		const { session, token } = await authenticateWithDiscord(discordId, discordName)

		res.json({
			token,
			lobby: lobbyPayload(session),
			player: playerPayload(session),
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
			player: playerPayload(session),
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

router.post('/unlink/discord', authenticate, async (req, res, next) => {
	try {
		const { session, token } = await unlinkDiscordFromPlayer(req.player!.playerId)

		await mqttService.publishToPlayer(req.player!.playerId, 'account/discord_unlinked', {})

		res.json({
			token,
			player: playerPayload(session),
		})
	} catch (err) {
		next(err)
	}
})

// --- Preferences ---

router.post('/preferences/display-name', authenticate, async (req, res, next) => {
	try {
		const { useDiscordName } = req.body
		if (typeof useDiscordName !== 'boolean') {
			throw new AppError('Missing or invalid useDiscordName (boolean)', 400)
		}

		const { session, token } = await setUseDiscordName(req.player!.playerId, useDiscordName)

		await mqttService.publishToPlayer(req.player!.playerId, 'account/display_name_changed', {
			displayName: session.getDisplayName(),
			useDiscordName: session.useDiscordName,
		})

		if (session.lobbyCode) {
			await mqttService.publishPlayerInfo(session.lobbyCode, session.playerId, {
				displayName: session.getDisplayName(),
				preferredJoker: session.preferredJoker,
			})
		}

		res.json({
			token,
			player: playerPayload(session),
		})
	} catch (err) {
		next(err)
	}
})

router.post('/preferences/joker', authenticate, async (req, res, next) => {
	try {
		const { preferredJoker } = req.body
		if (!preferredJoker || typeof preferredJoker !== 'string') {
			throw new AppError('Missing or invalid preferredJoker (string)', 400)
		}

		const { session, token } = await setPreferredJoker(req.player!.playerId, preferredJoker)

		await mqttService.publishToPlayer(req.player!.playerId, 'account/preferred_joker_changed', {
			preferredJoker: session.preferredJoker,
		})

		if (session.lobbyCode) {
			await mqttService.publishPlayerInfo(session.lobbyCode, session.playerId, {
				displayName: session.getDisplayName(),
				preferredJoker: session.preferredJoker,
			})
		}

		res.json({
			token,
			player: playerPayload(session),
		})
	} catch (err) {
		next(err)
	}
})

export default router
