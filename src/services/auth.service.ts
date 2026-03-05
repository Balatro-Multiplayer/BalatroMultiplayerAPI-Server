import { randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { env } from '../env.js'
import {
	createSession,
	findByProvider,
	getSession,
	linkProvider,
	unlinkProvider,
} from '../state/index.js'
import type {
	DiscordTokenResponse,
	DiscordUser,
	JwtPayload,
	SteamAuthResponse,
} from '../types/index.js'
import { isValidJoker } from '../constants/jokers.js'
import { AppError } from '../utils/errors.js'
import { cancelGracePeriod } from './grace-period.service.js'
import * as playerDb from './player.service.js'

// --- Steam ---

export async function validateSteamTicket(
	ticket: string,
): Promise<{ steamId: string }> {
	const url = new URL(
		'https://api.steampowered.com/ISteamUserAuth/AuthenticateUserTicket/v1/',
	)
	url.searchParams.set('key', env.STEAM_WEB_API_KEY)
	url.searchParams.set('appid', env.STEAM_APP_ID)
	url.searchParams.set('ticket', ticket)

	const response = await fetch(url.toString())
	if (!response.ok) {
		throw new AppError('Steam API request failed', 502)
	}

	const data = (await response.json()) as SteamAuthResponse
	if (!data.response?.params || data.response.params.result !== 'OK') {
		throw new AppError('Invalid Steam ticket', 401)
	}

	return { steamId: data.response.params.steamid }
}

export async function authenticateWithSteam(
	steamId: string,
	steamName: string,
) {
	let session = findByProvider('steam', steamId)
	if (session) {
		if (env.NODE_ENV !== 'production') {
			return authenticateAsTemp(steamName)
		}
		await cancelGracePeriod(session.playerId)
		session.steamName = steamName
		await playerDb.updateSteamName(session.playerId, steamName)
		return { session, token: signSessionJwt(session) }
	}
	const dbPlayer = await playerDb.findPlayerBySteamId(steamId)
	if (dbPlayer) {
		session = createSession(steamName, {
			id: dbPlayer.id,
			steamId: dbPlayer.steamId ?? undefined,
			discordId: dbPlayer.discordId ?? undefined,
			discordUsername: dbPlayer.discordUsername ?? undefined,
			useDiscordName: dbPlayer.useDiscordName,
			preferredJoker: dbPlayer.preferredJoker,
			privileges: dbPlayer.privileges,
		})
		await playerDb.updateSteamName(dbPlayer.id, steamName)
		return { session, token: signSessionJwt(session) }
	}

	session = createSession(steamName, { steamId })
	await playerDb.createPlayer({ id: session.playerId, steamName, steamId })

	return { session, token: signSessionJwt(session) }
}

// --- Discord ---

export function getDiscordAuthUrl(state?: string): string {
	const params = new URLSearchParams({
		client_id: env.DISCORD_CLIENT_ID,
		redirect_uri: env.DISCORD_REDIRECT_URI,
		response_type: 'code',
		scope: 'identify',
	})
	if (state) params.set('state', state)
	return `https://discord.com/api/oauth2/authorize?${params.toString()}`
}

export async function validateDiscordCode(
	code: string,
): Promise<{ discordId: string; discordName: string }> {
	const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: env.DISCORD_CLIENT_ID,
			client_secret: env.DISCORD_CLIENT_SECRET,
			grant_type: 'authorization_code',
			code,
			redirect_uri: env.DISCORD_REDIRECT_URI,
		}),
	})

	if (!tokenRes.ok) {
		throw new AppError('Discord token exchange failed', 502)
	}

	const tokenData = (await tokenRes.json()) as DiscordTokenResponse

	const userRes = await fetch('https://discord.com/api/users/@me', {
		headers: { Authorization: `Bearer ${tokenData.access_token}` },
	})

	if (!userRes.ok) {
		throw new AppError('Discord user fetch failed', 502)
	}

	const user = (await userRes.json()) as DiscordUser

	return {
		discordId: user.id,
		discordName: user.global_name ?? user.username,
	}
}

export async function authenticateWithDiscord(
	discordId: string,
	discordName: string,
) {
	let session = findByProvider('discord', discordId)
	if (session) {
		await cancelGracePeriod(session.playerId)
		session.steamName = discordName
		session.discordUsername = discordName
		await playerDb.updateSteamName(session.playerId, discordName)
		await playerDb.updateDiscordUsername(session.playerId, discordName)
		return { session, token: signSessionJwt(session) }
	}

	const dbPlayer = await playerDb.findPlayerByDiscordId(discordId)
	if (dbPlayer) {
		session = createSession(discordName, {
			id: dbPlayer.id,
			steamId: dbPlayer.steamId ?? undefined,
			discordId: dbPlayer.discordId ?? undefined,
			discordUsername: discordName,
			useDiscordName: dbPlayer.useDiscordName,
			preferredJoker: dbPlayer.preferredJoker,
			privileges: dbPlayer.privileges,
		})
		await playerDb.updateSteamName(dbPlayer.id, discordName)
		await playerDb.updateDiscordUsername(dbPlayer.id, discordName)
		return { session, token: signSessionJwt(session) }
	}

	session = createSession(discordName, { discordId, discordUsername: discordName })
	await playerDb.createPlayer({ id: session.playerId, steamName: discordName, discordId })

	return { session, token: signSessionJwt(session) }
}

// --- Refresh token auth (player ID based) ---

export async function authenticateWithPlayerId(
	playerId: string,
	steamName: string,
) {
	let session = getSession(playerId)
	if (session) {
		await cancelGracePeriod(session.playerId)
		session.steamName = steamName
		await playerDb.updateSteamName(session.playerId, steamName)
		return { session, token: signSessionJwt(session) }
	}

	const dbPlayer = await playerDb.findPlayerById(playerId)
	if (!dbPlayer) {
		throw new AppError('Player not found', 401)
	}

	session = createSession(steamName, {
		id: dbPlayer.id,
		steamId: dbPlayer.steamId ?? undefined,
		discordId: dbPlayer.discordId ?? undefined,
		discordUsername: dbPlayer.discordUsername ?? undefined,
		useDiscordName: dbPlayer.useDiscordName,
		preferredJoker: dbPlayer.preferredJoker,
		privileges: dbPlayer.privileges,
	})
	await playerDb.updateSteamName(dbPlayer.id, steamName)
	return { session, token: signSessionJwt(session) }
}

// --- Dev-mode temporary account ---

export function authenticateAsTemp(steamName: string) {
	const session = createSession(steamName)
	const token = signJwt({
		playerId: session.playerId,
		steamName: session.steamName,
		isTemp: true,
	})
	return { session, token }
}

// --- Dev-mode impersonation ---

export async function impersonatePlayer(opts: {
	playerId?: string
	steamId?: string
	discordId?: string
	steamName?: string
}) {
	let dbPlayer = opts.playerId
		? await playerDb.findPlayerById(opts.playerId)
		: opts.steamId
			? await playerDb.findPlayerBySteamId(opts.steamId)
			: opts.discordId
				? await playerDb.findPlayerByDiscordId(opts.discordId)
				: opts.steamName
					? await playerDb.findPlayerBySteamName(opts.steamName)
					: null

	if (!dbPlayer) {
		throw new AppError('Player not found', 404)
	}

	const session = createSession(dbPlayer.steamName, {
		id: dbPlayer.id,
		steamId: dbPlayer.steamId ?? undefined,
		discordId: dbPlayer.discordId ?? undefined,
		discordUsername: dbPlayer.discordUsername ?? undefined,
		useDiscordName: dbPlayer.useDiscordName,
		preferredJoker: dbPlayer.preferredJoker,
		privileges: dbPlayer.privileges,
	})

	return { session, token: signSessionJwt(session) }
}

// --- Linking ---

export async function linkSteamToPlayer(playerId: string, steamId: string) {
	const session = getSession(playerId)
	if (!session) {
		throw new AppError('Player session not found', 401)
	}

	const existing = findByProvider('steam', steamId)
	if (existing && existing.playerId !== playerId) {
		throw new AppError('Steam account already linked to another player', 409)
	}

	linkProvider(session, 'steam', steamId)
	await playerDb.linkSteam(playerId, steamId)

	return { session, token: signSessionJwt(session) }
}

export async function linkDiscordToPlayer(playerId: string, discordId: string, discordUsername?: string) {
	const session = getSession(playerId)
	if (!session) {
		throw new AppError('Player session not found', 401)
	}

	const existing = findByProvider('discord', discordId)
	if (existing && existing.playerId !== playerId) {
		throw new AppError('Discord account already linked to another player', 409)
	}

	linkProvider(session, 'discord', discordId)
	if (discordUsername) session.discordUsername = discordUsername
	await playerDb.linkDiscord(playerId, discordId, discordUsername)

	return { session, token: signSessionJwt(session) }
}

export async function unlinkDiscordFromPlayer(playerId: string) {
	const session = getSession(playerId)
	if (!session) {
		throw new AppError('Player session not found', 401)
	}

	unlinkProvider(session, 'discord')
	session.useDiscordName = false
	await playerDb.unlinkDiscord(playerId)

	return { session, token: signSessionJwt(session) }
}

export async function setUseDiscordName(playerId: string, value: boolean) {
	const session = getSession(playerId)
	if (!session) {
		throw new AppError('Player session not found', 401)
	}

	if (value && !session.discordId) {
		throw new AppError('Discord account not linked', 400)
	}

	session.useDiscordName = value
	await playerDb.updateUseDiscordName(playerId, value)

	return { session, token: signSessionJwt(session) }
}

export async function setPreferredJoker(playerId: string, value: string) {
	const session = getSession(playerId)
	if (!session) {
		throw new AppError('Player session not found', 401)
	}

	if (!isValidJoker(value, session.privileges)) {
		throw new AppError('Invalid joker ID', 400)
	}

	session.preferredJoker = value
	await playerDb.updatePreferredJoker(playerId, value)

	return { session, token: signSessionJwt(session) }
}

// --- JWT ---

export function signJwt(payload: JwtPayload): string {
	return jwt.sign(payload, env.JWT_SECRET, {
		expiresIn: env.JWT_EXPIRES_IN as `${number}${'s' | 'm' | 'h' | 'd'}`,
	})
}

export function verifyJwt(token: string): JwtPayload | null {
	try {
		return jwt.verify(token, env.JWT_SECRET) as JwtPayload
	} catch {
		return null
	}
}

// --- Discord link CSRF protection ---

const LINK_STATE_TTL = 5 * 60 * 1000 // 5 minutes

// nonce → { playerId, expiresAt }
export const linkStateNonces = new Map<
	string,
	{ playerId: string; expiresAt: number }
>()

export function generateLinkState(playerId: string): string {
	const nonce = randomBytes(32).toString('hex')
	linkStateNonces.set(nonce, {
		playerId,
		expiresAt: Date.now() + LINK_STATE_TTL,
	})
	return jwt.sign({ nonce, purpose: 'discord-link' }, env.JWT_SECRET, {
		expiresIn: '5m',
	})
}

export function verifyLinkState(state: string): string | null {
	let decoded: { nonce: string; purpose: string }
	try {
		decoded = jwt.verify(state, env.JWT_SECRET) as {
			nonce: string
			purpose: string
		}
	} catch {
		return null
	}

	if (decoded.purpose !== 'discord-link') return null

	const entry = linkStateNonces.get(decoded.nonce)
	if (!entry) return null

	// Consume nonce (one-time use)
	linkStateNonces.delete(decoded.nonce)

	if (Date.now() > entry.expiresAt) return null

	return entry.playerId
}

// --- Helpers ---

function signSessionJwt(session: {
	playerId: string
	steamName: string
	lobbyCode?: string
}): string {
	return signJwt({
		playerId: session.playerId,
		steamName: session.steamName,
		lobbyCode: session.lobbyCode,
	})
}
