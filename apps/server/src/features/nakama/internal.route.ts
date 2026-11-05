import { timingSafeEqual } from 'node:crypto'
import { Router, type NextFunction, type Request, type Response } from 'express'
import { env } from '../../env.js'
import * as banGateway from '../../infrastructure/gateways/ban.gateway.js'
import * as muteGateway from '../../infrastructure/gateways/mute.gateway.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import * as reportGateway from '../../infrastructure/gateways/report.gateway.js'
import { AppError } from '../../shared/utils/errors.js'
import { getDiscordAuthUrl } from '../auth/discord.js'
import { generateLinkState } from '../auth/link-state.js'
import { discordLinkService } from './discord-link.js'
import { isWebPagePath, webLoginLinks } from './web-login-link.js'
import type { DiscordLinkService } from './discord-link.service.js'
import type { LauncherIntegrityService } from '../launcher-integrity/launcher-integrity.service.js'
import { nakamaIntegrityService } from './integrity.js'
import { createPlayerSyncService, type PlayerSyncService } from './player-sync.service.js'
import { createReportRelayService, parseNakamaReport, type ReportRelayService } from './report-relay.service.js'

// Routes only Nakama calls (nakama/src/express.ts), guarded by the shared
// INTERNAL_API_KEY. With no key configured every request is refused.
export function requireInternalKey(req: Request, res: Response, next: NextFunction) {
	const sent = req.headers['x-bmp-internal-key']
	if (!env.INTERNAL_API_KEY || typeof sent !== 'string') {
		res.status(401).json({ error: 'Missing internal key' })
		return
	}
	const expected = Buffer.from(env.INTERNAL_API_KEY)
	const actual = Buffer.from(sent)
	if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
		res.status(403).json({ error: 'Bad internal key' })
		return
	}
	next()
}

const STEAM_ID_HASH = /^[0-9a-f]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_RESOLVE = 500

function defaultSyncService(): PlayerSyncService {
	return createPlayerSyncService({ players: playerGateway, bans: banGateway, mutes: muteGateway })
}

function defaultReportService(): ReportRelayService {
	return createReportRelayService({ players: playerGateway, reports: reportGateway })
}

export function createInternalNakamaRouter(
	sync: PlayerSyncService = defaultSyncService(),
	reportRelay: ReportRelayService = defaultReportService(),
	discordLink: DiscordLinkService = discordLinkService,
	integrity: LauncherIntegrityService = nakamaIntegrityService,
) {
	const router = Router()
	router.use(requireInternalKey)

	router.post('/ping', (_req, res) => {
		res.json({ ok: true })
	})

	// {steamIdHash, nakamaUserId, steamName} -> PlayerSync. Called once per
	// Nakama account, at its first session_init. Nakama sends the hash its
	// account is named by; the raw Steam id never leaves Nakama's login.
	router.post('/player-sync', async (req, res, next) => {
		try {
			const { steamIdHash, nakamaUserId, steamName } = req.body ?? {}
			if (typeof steamIdHash !== 'string' || !STEAM_ID_HASH.test(steamIdHash)) throw new AppError('Bad steamIdHash', 400)
			if (typeof nakamaUserId !== 'string' || !UUID.test(nakamaUserId)) throw new AppError('Bad nakamaUserId', 400)
			const name = typeof steamName === 'string' ? steamName.slice(0, 64) : ''
			res.json(await sync.syncPlayer({ steamIdHash, nakamaUserId, steamName: name }))
		} catch (err) {
			next(err)
		}
	})

	// {playerIds} -> {resolved: {[playerId]: nakamaUserId}}: legacy mutes of
	// players who have since logged in to Nakama.
	router.post('/resolve-players', async (req, res, next) => {
		try {
			const ids = req.body?.playerIds
			if (!Array.isArray(ids) || ids.length > MAX_RESOLVE || !ids.every((id) => typeof id === 'string'))
				throw new AppError('Bad playerIds', 400)
			const found = await playerGateway.findNakamaUserIds(ids)
			res.json({ resolved: Object.fromEntries(found) })
		} catch (err) {
			next(err)
		}
	})

	// {nakamaUserId} -> {url}: the Discord authorize URL for an in-game link.
	// Its state names the Nakama user; /api/auth/discord/callback finishes it.
	router.post('/discord/link-url', (req, res, next) => {
		try {
			const nakamaUserId = req.body?.nakamaUserId
			if (typeof nakamaUserId !== 'string' || !UUID.test(nakamaUserId)) throw new AppError('Bad nakamaUserId', 400)
			res.json({ url: getDiscordAuthUrl(generateLinkState('', 'game', nakamaUserId)) })
		} catch (err) {
			next(err)
		}
	})

	// {nakamaUserId, path} -> {url}: a one-time link that logs the player in to
	// the website and opens path (a page of the site, never an outside address).
	router.post('/web-login/link', (req, res, next) => {
		try {
			const nakamaUserId = nakamaUserIdOf(req.body)
			const path = req.body?.path
			if (!isWebPagePath(path)) throw new AppError('Bad path', 400)
			const code = webLoginLinks.mint(nakamaUserId, path)
			res.json({ url: `${env.WEB_BASE_URL.replace(/\/$/, '')}/auth/link?code=${code}` })
		} catch (err) {
			next(err)
		}
	})

	// {nakamaUserId} -> {ok}: the player unlinked Discord on Nakama.
	router.post('/discord/unlinked', async (req, res, next) => {
		try {
			const nakamaUserId = req.body?.nakamaUserId
			if (typeof nakamaUserId !== 'string' || !UUID.test(nakamaUserId)) throw new AppError('Bad nakamaUserId', 400)
			await discordLink.unlinkNakamaDiscord(nakamaUserId)
			res.json({ ok: true })
		} catch (err) {
			next(err)
		}
	})

	// NakamaReport -> {ok, reportId}: a report filed in a Nakama lobby.
	router.post('/reports', async (req, res, next) => {
		try {
			const report = parseNakamaReport(req.body)
			if (typeof report === 'string') throw new AppError(report, 400)
			res.json({ ok: true, reportId: await reportRelay.fileReport(report) })
		} catch (err) {
			next(err)
		}
	})

	// Launcher integrity for Nakama players (./integrity.ts). Each answers 202
	// at once and does the work afterwards: its verdict reaches Nakama
	// through admin_integrity_set, which must not wait on Nakama's own call
	// here to return.
	const background = (what: string, work: Promise<void>) =>
		work.catch((err) => console.error(`[launcher-integrity] ${what} failed:`, err))

	// {nakamaUserId}: the player's socket is open; start challenging it.
	router.post('/integrity/session-start', (req, res, next) => {
		try {
			const userId = nakamaUserIdOf(req.body)
			void background('Session start', integrity.handleClientConnected(userId))
			res.status(202).json({ ok: true })
		} catch (err) {
			next(err)
		}
	})

	// {nakamaUserId, challengeId, response?, refused?}: the launcher's answer.
	router.post('/integrity/answer', (req, res, next) => {
		try {
			const userId = nakamaUserIdOf(req.body)
			const { challengeId, response, refused } = req.body
			void background('Challenge answer', integrity.handleChallengeResponse(userId, { challengeId, response, refused }))
			res.status(202).json({ ok: true })
		} catch (err) {
			next(err)
		}
	})

	// {nakamaUserId}: a ranked ticket was let in; check the launcher and mods
	// are current (a failure cancels the queue through admin_queue_cancel).
	router.post('/integrity/ranked-readiness', (req, res, next) => {
		try {
			const userId = nakamaUserIdOf(req.body)
			if (integrity.isEnabled()) void background('Ranked readiness', integrity.issueRankedReadinessChallenge(userId))
			res.status(202).json({ ok: true })
		} catch (err) {
			next(err)
		}
	})

	return router
}

function nakamaUserIdOf(body: unknown): string {
	const nakamaUserId = (body as { nakamaUserId?: unknown } | undefined)?.nakamaUserId
	if (typeof nakamaUserId !== 'string' || !UUID.test(nakamaUserId)) throw new AppError('Bad nakamaUserId', 400)
	return nakamaUserId
}
