import { randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { env } from '../env.js'
import {
	createSession,
	findByProvider,
	getSession,
	linkProvider,
	unlinkProvider,
	PlayerSession,
} from '../state/index.js'
import type {
	DiscordTokenResponse,
	DiscordUser,
	JwtPayload,
	SteamAuthResponse,
} from '../types/index.js'
import { isValidJoker } from '../constants/jokers.js'
import { AppError } from '../utils/errors.js'
import { hashProviderId } from '../utils/hash.js'
import { cancelGracePeriod } from './grace-period.service.js'
import * as playerDb from './player.service.js'
import type { PlayerRecord } from './player.service.js'
import { getConfig } from '../state/config.js'

type Provider = 'steam' | 'discord'
type SessionInit = NonNullable<Parameters<typeof createSession>[1]>
type SessionAndToken = { session: PlayerSession; token: string }

// --- Helpers ---

function sessionAndToken(session: PlayerSession): SessionAndToken {
	return { session, token: signSessionJwt(session) }
}

function dbPlayerToSessionInit(
	dbPlayer: PlayerRecord,
	overrides: Partial<SessionInit> = {},
): SessionInit {
	return {
		id: dbPlayer.id,
		steamIdHash: dbPlayer.steamIdHash ?? undefined,
		discordIdHash: dbPlayer.discordIdHash ?? undefined,
		discordUsername: dbPlayer.discordUsername ?? undefined,
		useDiscordName: dbPlayer.useDiscordName,
		preferredJoker: dbPlayer.preferredJoker,
		privileges: dbPlayer.privileges,
		tosAcceptedVersion: dbPlayer.tosAcceptedVersion,
		chatEnabled: dbPlayer.chatEnabled,
		chatBlocked: dbPlayer.chatBlocked,
		...overrides,
	}
}

function requirePlayerSession(playerId: string): PlayerSession {
	const session = getSession(playerId)
	if (!session) throw new AppError('Player session not found', 401)
	return session
}

function ensureProviderNotLinkedElsewhere(
	provider: Provider,
	idHash: string,
	playerId: string,
): void {
	const existing = findByProvider(provider, idHash)
	if (existing && existing.playerId !== playerId) {
		const label = provider === 'steam' ? 'Steam' : 'Discord'
		throw new AppError(`${label} account already linked to another player`, 409)
	}
}

// --- Steam ---

function buildSteamAuthUrl(ticket: string): string {
	const url = new URL(
		'https://api.steampowered.com/ISteamUserAuth/AuthenticateUserTicket/v1/',
	)
	url.searchParams.set('key', env.STEAM_WEB_API_KEY)
	url.searchParams.set('appid', env.STEAM_APP_ID)
	url.searchParams.set('ticket', ticket)
	return url.toString()
}

function extractSteamIdFromAuthResponse(data: SteamAuthResponse): string {
	if (!data.response?.params || data.response.params.result !== 'OK') {
		throw new AppError('Invalid Steam ticket', 401)
	}
	return data.response.params.steamid
}

export async function validateSteamTicket(
	ticket: string,
): Promise<{ steamId: string }> {
	const response = await fetch(buildSteamAuthUrl(ticket))
	if (!response.ok) {
		throw new AppError('Steam API request failed', 502)
	}
	const data = (await response.json()) as SteamAuthResponse
	return { steamId: extractSteamIdFromAuthResponse(data) }
}

async function refreshSteamSessionOnReauth(
	session: PlayerSession,
	steamName: string,
): Promise<SessionAndToken> {
	await cancelGracePeriod(session.playerId)
	session.steamName = steamName
	await playerDb.updateSteamName(session.playerId, steamName)
	return sessionAndToken(session)
}

async function restoreSessionFromDbPlayer(
	dbPlayer: PlayerRecord,
	steamName: string,
): Promise<SessionAndToken> {
	const session = createSession(steamName, dbPlayerToSessionInit(dbPlayer))
	await playerDb.updateSteamName(dbPlayer.id, steamName)
	return sessionAndToken(session)
}

function createBrandNewSteamSession(
	steamName: string,
	steamIdHash: string,
): SessionAndToken {
	const session = createSession(steamName, { steamIdHash })
	return sessionAndToken(session)
}

export async function authenticateWithSteam(
	steamId: string,
	steamName: string,
): Promise<SessionAndToken> {
	const steamIdHash = hashProviderId(steamId)

	const existing = findByProvider('steam', steamIdHash)
	if (existing) return refreshSteamSessionOnReauth(existing, steamName)

	const dbPlayer = await playerDb.findPlayerBySteamIdHash(steamIdHash)
	if (dbPlayer) return restoreSessionFromDbPlayer(dbPlayer, steamName)

	return createBrandNewSteamSession(steamName, steamIdHash)
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

async function exchangeDiscordCodeForToken(
	code: string,
): Promise<DiscordTokenResponse> {
	const res = await fetch('https://discord.com/api/oauth2/token', {
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
	if (!res.ok) throw new AppError('Discord token exchange failed', 502)
	return (await res.json()) as DiscordTokenResponse
}

async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
	const res = await fetch('https://discord.com/api/users/@me', {
		headers: { Authorization: `Bearer ${accessToken}` },
	})
	if (!res.ok) throw new AppError('Discord user fetch failed', 502)
	return (await res.json()) as DiscordUser
}

function pickDiscordDisplayName(user: DiscordUser): string {
	return user.global_name ?? user.username
}

export async function validateDiscordCode(
	code: string,
): Promise<{ discordId: string; discordName: string }> {
	const tokenData = await exchangeDiscordCodeForToken(code)
	const user = await fetchDiscordUser(tokenData.access_token)
	return { discordId: user.id, discordName: pickDiscordDisplayName(user) }
}

async function refreshDiscordSessionOnReauth(
	session: PlayerSession,
	discordName: string,
): Promise<SessionAndToken> {
	await cancelGracePeriod(session.playerId)
	session.steamName = discordName
	session.discordUsername = discordName
	await playerDb.updateSteamName(session.playerId, discordName)
	await playerDb.updateDiscordUsername(session.playerId, discordName)
	return sessionAndToken(session)
}

async function restoreDiscordSessionFromDb(
	dbPlayer: PlayerRecord,
	discordName: string,
): Promise<SessionAndToken> {
	const session = createSession(
		discordName,
		dbPlayerToSessionInit(dbPlayer, { discordUsername: discordName }),
	)
	await playerDb.updateSteamName(dbPlayer.id, discordName)
	await playerDb.updateDiscordUsername(dbPlayer.id, discordName)
	return sessionAndToken(session)
}

async function createBrandNewDiscordSession(
	discordName: string,
	discordIdHash: string,
): Promise<SessionAndToken> {
	const session = createSession(discordName, {
		discordIdHash,
		discordUsername: discordName,
	})
	await playerDb.createPlayer({
		id: session.playerId,
		steamName: discordName,
		discordIdHash,
	})
	return sessionAndToken(session)
}

export async function authenticateWithDiscord(
	discordId: string,
	discordName: string,
): Promise<SessionAndToken> {
	const discordIdHash = hashProviderId(discordId)

	const existing = findByProvider('discord', discordIdHash)
	if (existing) return refreshDiscordSessionOnReauth(existing, discordName)

	const dbPlayer = await playerDb.findPlayerByDiscordIdHash(discordIdHash)
	if (dbPlayer) return restoreDiscordSessionFromDb(dbPlayer, discordName)

	return createBrandNewDiscordSession(discordName, discordIdHash)
}

// --- Refresh token auth (player ID based) ---

async function refreshExistingSessionByPlayerId(
	session: PlayerSession,
	steamName: string,
): Promise<SessionAndToken> {
	await cancelGracePeriod(session.playerId)
	session.steamName = steamName
	await playerDb.updateSteamName(session.playerId, steamName)
	return sessionAndToken(session)
}

export async function authenticateWithPlayerId(
	playerId: string,
	steamName: string,
): Promise<SessionAndToken> {
	const existing = getSession(playerId)
	if (existing) return refreshExistingSessionByPlayerId(existing, steamName)

	const dbPlayer = await playerDb.findPlayerById(playerId)
	if (!dbPlayer) throw new AppError('Player not found', 401)

	return restoreSessionFromDbPlayer(dbPlayer, steamName)
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

async function findImpersonationTarget(opts: {
	playerId?: string
	steamId?: string
	discordId?: string
	steamName?: string
}): Promise<PlayerRecord | null> {
	if (opts.playerId) return playerDb.findPlayerById(opts.playerId)
	if (opts.steamId)
		return playerDb.findPlayerBySteamIdHash(hashProviderId(opts.steamId))
	if (opts.discordId)
		return playerDb.findPlayerByDiscordIdHash(hashProviderId(opts.discordId))
	if (opts.steamName) return playerDb.findPlayerBySteamName(opts.steamName)
	return null
}

export async function impersonatePlayer(opts: {
	playerId?: string
	steamId?: string
	discordId?: string
	steamName?: string
}): Promise<SessionAndToken> {
	const dbPlayer = await findImpersonationTarget(opts)
	if (!dbPlayer) throw new AppError('Player not found', 404)

	const session = createSession(
		dbPlayer.steamName,
		dbPlayerToSessionInit(dbPlayer),
	)
	return sessionAndToken(session)
}

// --- Linking ---

export async function linkSteamToPlayer(playerId: string, steamId: string) {
	const session = requirePlayerSession(playerId)
	const steamIdHash = hashProviderId(steamId)
	ensureProviderNotLinkedElsewhere('steam', steamIdHash, playerId)

	linkProvider(session, 'steam', steamIdHash)
	await playerDb.linkSteam(playerId, steamIdHash)
	return sessionAndToken(session)
}

export async function linkDiscordToPlayer(
	playerId: string,
	discordId: string,
	discordUsername?: string,
) {
	const session = requirePlayerSession(playerId)
	const discordIdHash = hashProviderId(discordId)
	ensureProviderNotLinkedElsewhere('discord', discordIdHash, playerId)

	linkProvider(session, 'discord', discordIdHash)
	if (discordUsername) session.discordUsername = discordUsername
	await playerDb.linkDiscord(playerId, discordIdHash, discordUsername)
	return sessionAndToken(session)
}

export async function unlinkDiscordFromPlayer(playerId: string) {
	const session = requirePlayerSession(playerId)

	unlinkProvider(session, 'discord')
	session.useDiscordName = false
	await playerDb.unlinkDiscord(playerId)
	return sessionAndToken(session)
}

export async function setUseDiscordName(playerId: string, value: boolean) {
	const session = requirePlayerSession(playerId)

	if (value && !session.discordIdHash) {
		throw new AppError('Discord account not linked', 400)
	}

	session.useDiscordName = value
	await playerDb.updateUseDiscordName(playerId, value)
	return sessionAndToken(session)
}

export async function setPreferredJoker(playerId: string, value: string) {
	const session = requirePlayerSession(playerId)

	if (!isValidJoker(value, session.privileges)) {
		throw new AppError('Invalid joker ID', 400)
	}

	session.preferredJoker = value
	await playerDb.updatePreferredJoker(playerId, value)
	return sessionAndToken(session)
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

// --- ToS version gate ---

export function signTosPendingToken(playerId: string): string {
	return jwt.sign({ playerId, purpose: 'tos-accept' }, env.JWT_SECRET, {
		expiresIn: '10m',
	})
}

export function verifyTosPendingToken(token: string): string | null {
	try {
		const decoded = jwt.verify(token, env.JWT_SECRET) as {
			playerId: string
			purpose: string
		}
		if (decoded.purpose !== 'tos-accept') return null
		return decoded.playerId
	} catch {
		return null
	}
}

async function ensurePlayerExistsInDb(session: PlayerSession): Promise<void> {
	const dbPlayer = await playerDb.findPlayerById(session.playerId)
	if (dbPlayer) return
	await playerDb.createPlayer({
		id: session.playerId,
		steamName: session.steamName,
		steamIdHash: session.steamIdHash,
	})
}

export async function acceptTos(playerId: string) {
	const { tosVersion } = getConfig()

	const session = getSession(playerId)
	if (!session) throw new AppError('Session not found', 401)

	await ensurePlayerExistsInDb(session)
	await playerDb.updateTosAcceptedVersion(playerId, tosVersion)
	session.tosAcceptedVersion = tosVersion
	return sessionAndToken(session)
}

// --- Discord link CSRF protection ---

const LINK_STATE_TTL = 5 * 60 * 1000

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

function decodeLinkStateJwt(
	state: string,
): { nonce: string; purpose: string } | null {
	try {
		return jwt.verify(state, env.JWT_SECRET) as {
			nonce: string
			purpose: string
		}
	} catch {
		return null
	}
}

function consumeLinkStateNonce(
	nonce: string,
): { playerId: string; expiresAt: number } | null {
	const entry = linkStateNonces.get(nonce)
	if (!entry) return null
	linkStateNonces.delete(nonce)
	return entry
}

function isLinkStateNonceFresh(entry: { expiresAt: number }): boolean {
	return Date.now() <= entry.expiresAt
}

export function verifyLinkState(state: string): string | null {
	const decoded = decodeLinkStateJwt(state)
	if (!decoded || decoded.purpose !== 'discord-link') return null

	const entry = consumeLinkStateNonce(decoded.nonce)
	if (!entry) return null
	if (!isLinkStateNonceFresh(entry)) return null

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
