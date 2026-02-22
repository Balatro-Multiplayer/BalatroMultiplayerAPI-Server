import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { authenticate } from '../middleware/authenticate.js'
import {
	authenticateWithDiscord,
	authenticateWithSteam,
	generateLinkState,
	getDiscordAuthUrl,
	linkDiscordToPlayer,
	linkSteamToPlayer,
	validateDiscordCode,
	validateSteamTicket,
	verifyLinkState,
} from '../services/auth.service.js'
import { AppError } from '../utils/errors.js'

const router = Router()

const authRateLimiter = rateLimit({
	windowMs: 60 * 1000,
	limit: 5,
	standardHeaders: 'draft-7',
	legacyHeaders: false,
	message: { error: 'Too many auth requests, please try again later' },
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
				const { session, token } = await linkDiscordToPlayer(
					playerId,
					discordId,
				)
				res.json({
					linked: true,
					token,
					player: {
						id: session.playerId,
						username: session.username,
						steamId: session.steamId,
						discordId: session.discordId,
					},
				})
				return
			}
		}

		// Otherwise, normal auth
		const { session, token } = await authenticateWithDiscord(discordId, username)

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

router.get('/link/discord', authenticate, (req, res) => {
	const state = generateLinkState(req.player!.playerId)
	res.redirect(getDiscordAuthUrl(state))
})

export default router
