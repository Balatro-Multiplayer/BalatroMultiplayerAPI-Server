import { NOTICE_VERSION } from '@bmp/types'
import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { env } from '../../env.js'
import {
	findPlayerById,
	updateChatStatus,
} from '../../infrastructure/gateways/player.gateway.js'
import {
	avatarsFor,
	setNakamaAvatar,
} from '../../infrastructure/nakama/avatar-sync.js'
import { listAppealsOf } from '../../infrastructure/gateways/appeal.gateway.js'
import { listBans } from '../../infrastructure/gateways/ban.gateway.js'
import { listWarnings } from '../../infrastructure/gateways/warning.gateway.js'
import { networkBanIdsAt } from '../../infrastructure/nakama/moderation-sync.js'
import {
	editNakamaProfile,
	linkNakamaDiscord,
} from '../../infrastructure/nakama/profile-sync.js'
import { authenticate } from '../../middleware/authenticate.js'
import { AppError } from '../../shared/utils/errors.js'
import { isOwner } from '../../shared/utils/require-owner.js'
import { effectivePrivileges } from '../../shared/utils/staff-role.js'
import { getSession, removeSession } from '../../state/index.js'
import type { PlayerSession } from '../../state/index.js'
import type { SubmitRefusal } from '../appeals/appeals.service.js'
import { appealService } from '../appeals/appeals.deps.js'
import { appealStateOf, buildPunishmentList } from '../punishments/player-punishments.js'
import { discordLinkService } from '../nakama/discord-link.js'
import type { AuthService } from './auth.service.js'
import { getDiscordAuthUrl, validateDiscordCode } from './discord.js'
import { signTosPendingToken, verifyTosPendingToken } from './jwt.js'
import { generateLinkState, verifyLinkState } from './link-state.js'
import {
	getSteamOpenIdUrl,
	getSteamPlayerName,
	validateSteamOpenIdResponse,
} from './steam.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function appealRefusalHttp(refusal: SubmitRefusal): { status: number; body: Record<string, unknown> } {
	switch (refusal.code) {
		case 'invalid_message':
			return { status: 400, body: { error: refusal.message, code: refusal.code } }
		case 'not_found':
			return { status: 404, body: { error: 'Punishment not found', code: refusal.code } }
		case 'not_blocked':
			return { status: 409, body: { error: 'No network ban blocks you', code: refusal.code } }
		case 'already_lifted':
			return { status: 409, body: { error: 'That punishment is already lifted', code: refusal.code } }
		case 'open':
			return { status: 409, body: { error: 'You already have an open appeal', code: refusal.code } }
		case 'granted':
			return { status: 409, body: { error: 'That appeal was granted', code: refusal.code } }
		case 'cooling_down':
			return {
				status: 409,
				body: { error: 'You can appeal again later', code: refusal.code, availableAt: refusal.availableAt.toISOString() },
			}
	}
}

function playerPayload(session: PlayerSession) {
	return {
		id: session.playerId,
		steamName: session.steamName,
		displayName: session.getDisplayName(),
		useDiscordName: session.useDiscordName,
		preferredJoker: session.preferredJoker,
		discordLinked: session.discordIdHash != null,
		discordUsername: session.discordUsername ?? null,
		privileges: effectivePrivileges(session.playerId, session.privileges),
		isOwner: isOwner(session.playerId),
		chatEnabled: session.chatEnabled,
		chatBlocked: session.chatBlocked,
	}
}

function tosGate(
	session: PlayerSession,
): { tosRequired: true; tosUpdate: boolean; token: string } | null {
	if (env.NOTICE_REQUIRED && session.tosAcceptedVersion < NOTICE_VERSION) {
		return {
			tosRequired: true,
			tosUpdate: session.tosAcceptedVersion > 0,
			token: signTosPendingToken(session.playerId),
		}
	}
	return null
}

function linkPage(title: string, text: string, colour: string): string {
	return `<!DOCTYPE html>
<html><head><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0}
.card{text-align:center;padding:2rem;border-radius:12px;background:#16213e;box-shadow:0 4px 20px rgba(0,0,0,0.3)}
h1{color:${colour};margin-bottom:0.5rem}p{color:#a0a0b0}</style>
</head><body><div class="card"><h1>${title}</h1><p>${text}</p></div></body></html>`
}

// The callback's answer to a link started in game.
const LINK_PAGES = {
	linked: linkPage(
		'Discord Linked!',
		'You can close this tab and return to the game.',
		'#5865f2',
	),
	linked_elsewhere: linkPage(
		'Already Linked',
		'This Discord account is already linked to another player. Unlink it there first.',
		'#ed4245',
	),
	unavailable: linkPage(
		'Link Failed',
		'The game server could not be reached. Please try again later.',
		'#ed4245',
	),
}

export function createAuthRouter(service: AuthService): Router {
	const router = Router()

	const authRateLimiter = rateLimit({
		windowMs: 60 * 1000,
		limit: 100, // generous backstop only: no guessable secrets on this router (Steam/Discord-signed or high-entropy token); covers per-page /me fan-out
		standardHeaders: 'draft-7',
		legacyHeaders: false,
		message: { error: 'Too many auth requests, please try again later' },
		skip: () => env.NODE_ENV !== 'production',
	})

	router.use(authRateLimiter)

	router.get('/steam/web', (req, res) => {
		const callbackUrl = `${env.WEB_BASE_URL.replace(/\/$/, '')}/api/proxy/auth/steam/web/callback`
		res.redirect(getSteamOpenIdUrl(callbackUrl))
	})

	router.get('/steam/web/callback', async (req, res, next) => {
		try {
			const query = Object.fromEntries(
				Object.entries(req.query).map(([k, v]) => [k, String(v)]),
			)
			const openIdResult = await validateSteamOpenIdResponse(query)
			if (!openIdResult.ok) {
				throw new AppError('Steam OpenID validation failed', 401)
			}
			const steamName = await getSteamPlayerName(openIdResult.value)
			const { session, token } = await service.authenticateWithSteam(
				openIdResult.value,
				steamName,
			)

			const gate = tosGate(session)
			if (gate) {
				res.redirect(
					`${env.WEB_BASE_URL}/auth/tos?token=${encodeURIComponent(gate.token)}`,
				)
				return
			}

			res.redirect(
				`${env.WEB_BASE_URL}/auth/callback?token=${encodeURIComponent(token)}`,
			)
		} catch (err) {
			next(err)
		}
	})

	router.get('/me', authenticate, async (req, res, next) => {
		try {
			const jwt = req.player!
			const dbPlayer = await findPlayerById(jwt.playerId)
			res.json({
				id: jwt.playerId,
				steamName: jwt.steamName,
				displayName: jwt.displayName ?? jwt.steamName,
				useDiscordName: jwt.useDiscordName ?? false,
				preferredJoker: jwt.preferredJoker ?? null,
				discordLinked: jwt.discordIdHash != null,
				discordUsername: jwt.discordUsername ?? null,
				privileges: effectivePrivileges(
					jwt.playerId,
					dbPlayer?.privileges ?? [],
				),
				isOwner: isOwner(jwt.playerId),
			})
		} catch (err) {
			next(err)
		}
	})

	// The account page's punishment list, with each punishment's appeal. It works
	// for a banned account (plain `authenticate`), and shows a network ban that
	// the player's address is under, without naming the account that caused it.
	router.get('/punishments', authenticate, async (req, res, next) => {
		try {
			const playerId = req.player!.playerId
			const [bans, warnings, networkBanIds, appeals] = await Promise.all([
				listBans(playerId),
				listWarnings(playerId, 200),
				networkBanIdsAt(req.ip ?? ''),
				listAppealsOf(playerId),
			])
			const now = new Date()
			const networkBanned = networkBanIds.length > 0
			res.json({
				punishments: buildPunishmentList(bans, warnings, now, appeals),
				networkBanned,
				networkAppeal: networkBanned
					? appealStateOf(
							appeals.filter((a) => a.targetKind === 'network_ban'),
							now,
						)
					: null,
			})
		} catch (err) {
			next(err)
		}
	})

	// A player appeals one punishment, or (no punishmentId) the network ban that
	// blocks them. Works for a banned account.
	router.post('/appeals', authenticate, async (req, res, next) => {
		try {
			const { punishmentId, message } = (req.body ?? {}) as { punishmentId?: unknown; message?: unknown }
			if (typeof message !== 'string') throw new AppError('message must be text', 400)
			if (punishmentId !== undefined && punishmentId !== null && (typeof punishmentId !== 'string' || !UUID.test(punishmentId))) {
				res.status(404).json({ error: 'Punishment not found', code: 'not_found' })
				return
			}
			const playerId = req.player!.playerId
			const result = await appealService.submit({
				playerId,
				punishmentId: typeof punishmentId === 'string' ? punishmentId : null,
				message,
				networkBanIds: typeof punishmentId === 'string' ? [] : await networkBanIdsAt(req.ip ?? ''),
			})
			if (!result.ok) {
				const { status, body } = appealRefusalHttp(result.refusal)
				res.status(status).json(body)
				return
			}
			res.status(201).json({
				appeal: appealStateOf([result.value], new Date()).appeal,
			})
		} catch (err) {
			next(err)
		}
	})

	router.post('/logout', (_req, res) => {
		res.json({ ok: true })
	})

	router.post('/accept-tos', async (req, res, next) => {
		try {
			const authHeader = req.headers.authorization
			const pendingToken = authHeader?.startsWith('Bearer ')
				? authHeader.slice(7)
				: null
			if (!pendingToken) throw new AppError('Missing pending token', 401)

			const playerId = verifyTosPendingToken(pendingToken)
			if (!playerId) throw new AppError('Invalid or expired ToS token', 401)

			const chatEligible =
				typeof req.body?.chatEligible === 'boolean'
					? req.body.chatEligible
					: undefined
			const { session, token } = await service.acceptTos(playerId, chatEligible)

			res.json({
				token,
				player: playerPayload(session),
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
			const discordResult = await validateDiscordCode(code)
			if (!discordResult.ok) {
				throw new AppError(
					discordResult.error === 'token_exchange_failed'
						? 'Discord token exchange failed'
						: 'Discord user fetch failed',
					502,
				)
			}
			const { discordId, discordName } = discordResult.value

			if (state) {
				const linked = verifyLinkState(state)
				if (linked?.nakamaUserId) {
					const outcome = await discordLinkService.linkNakamaDiscord(
						linked.nakamaUserId,
						discordId,
						discordName,
					)
					res.status(
						outcome === 'linked'
							? 200
							: outcome === 'linked_elsewhere'
								? 409
								: 502,
					)
					res.setHeader('Content-Type', 'text/html')
					res.send(LINK_PAGES[outcome])
					return
				}
				if (linked) {
					const { session, token } = await service.linkDiscordToPlayer(
						linked.playerId,
						discordId,
						discordName,
					)
					if (session.discordIdHash)
						await linkNakamaDiscord(
							linked.playerId,
							session.discordIdHash,
							discordName,
						)

					if (linked.source === 'web') {
						res.redirect(
							`${env.WEB_BASE_URL}/auth/callback?token=${encodeURIComponent(token)}`,
						)
						return
					}

					res.setHeader('Content-Type', 'text/html')
					res.send(LINK_PAGES.linked)
					return
				}
			}

			const { session, token } = await service.authenticateWithDiscord(
				discordId,
				discordName,
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
		const source = req.query.source as string | undefined
		const state = generateLinkState(req.player!.playerId, source)
		const url = getDiscordAuthUrl(state)
		res.json({ url })
	})

	router.post('/unlink/discord', authenticate, async (req, res, next) => {
		try {
			const { session, token } = await service.unlinkDiscordFromPlayer(
				req.player!.playerId,
			)
			await editNakamaProfile(req.player!.playerId, { discord: null })

			res.json({
				token,
				player: playerPayload(session),
			})
		} catch (err) {
			next(err)
		}
	})

	router.post(
		'/preferences/display-name',
		authenticate,
		async (req, res, next) => {
			try {
				const { useDiscordName } = req.body
				if (typeof useDiscordName !== 'boolean') {
					throw new AppError('Missing or invalid useDiscordName (boolean)', 400)
				}

				const { session, token } = await service.setUseDiscordName(
					req.player!.playerId,
					useDiscordName,
				)
				await editNakamaProfile(req.player!.playerId, { useDiscordName })

				res.json({
					token,
					player: playerPayload(session),
				})
			} catch (err) {
				next(err)
			}
		},
	)

	router.post('/chat/enable', authenticate, async (req, res, next) => {
		try {
			const session = getSession(req.player!.playerId)
			if (!session) throw new AppError('Session not found', 401)

			if (session.chatBlocked)
				throw new AppError('Chat access is permanently restricted', 403)
			if (session.chatEnabled) {
				res.json({ player: playerPayload(session) })
				return
			}

			await updateChatStatus(session.playerId, true, false)
			session.chatEnabled = true
			session.chatBlocked = false

			res.json({ player: playerPayload(session) })
		} catch (err) {
			next(err)
		}
	})

	// §5.2 avatar picker (website): every avatar with whether the player may
	// pick it and its goal, from Nakama (nakama/src/achievements/rpc.ts).
	router.get('/jokers', authenticate, async (req, res, next) => {
		try {
			const catalog = await avatarsFor(req.player!.playerId)
			if (!catalog.ok) throw new AppError('Avatars are unavailable right now', 503)
			res.json(catalog.value)
		} catch (err) {
			next(err)
		}
	})

	// Nakama first (it refuses a joker the player may not pick), then Postgres.
	router.post('/preferences/joker', authenticate, async (req, res, next) => {
		try {
			const { preferredJoker } = req.body
			if (!preferredJoker || typeof preferredJoker !== 'string') {
				throw new AppError('Missing or invalid preferredJoker (string)', 400)
			}

			const set = await setNakamaAvatar(req.player!.playerId, preferredJoker)
			if (!set.ok) {
				throw set.error === 'refused'
					? new AppError('Invalid joker ID', 400)
					: new AppError('Avatars are unavailable right now', 503)
			}
			const { session, token } = await service.setPreferredJoker(
				req.player!.playerId,
				preferredJoker,
			)

			res.json({
				token,
				player: playerPayload(session),
			})
		} catch (err) {
			next(err)
		}
	})

	router.delete('/account', authenticate, async (req, res, next) => {
		try {
			const playerId = req.player!.playerId

			await service.deleteAccount(playerId)
			removeSession(playerId)

			res.json({ ok: true })
		} catch (err) {
			next(err)
		}
	})

	return router
}
