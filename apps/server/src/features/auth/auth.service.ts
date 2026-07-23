import {
	createSession,
	findByProvider,
	getSession,
	linkProvider,
	unlinkProvider,
	PlayerSession,
} from '../../state/index.js'
import { isValidJoker } from '../../shared/constants/jokers.js'
import { AppError } from '../../shared/utils/errors.js'
import { hashProviderId } from '../../shared/utils/hash.js'
import { getConfig } from '../../state/config.js'
import type { IPlayerRepository, PlayerRecord } from '../../contracts/IPlayerRepository.js'
import type { IGracePeriodService } from '../../contracts/IGracePeriodService.js'
import { pseudonymizeChatLogsForPlayer } from '../../infrastructure/gateways/history.gateway.js'
import { pseudonymizeRunLogsForPlayer } from '../../infrastructure/gateways/replay-log.gateway.js'
import { signJwt } from './jwt.js'

type Provider = 'steam' | 'discord'
type SessionInit = NonNullable<Parameters<typeof createSession>[1]>
type SessionAndToken = { session: PlayerSession; token: string }

interface AuthServiceDeps {
	playerRepository: IPlayerRepository
	gracePeriodService: Pick<IGracePeriodService, 'cancelGracePeriod'>
}

export type AuthService = ReturnType<typeof createAuthService>

export function authenticateAsTemp(steamName: string) {
	const session = createSession(steamName)
	const token = signJwt({
		playerId: session.playerId,
		steamName: session.steamName,
		isTemp: true,
	})
	return { session, token }
}

function signSessionJwt(session: PlayerSession): string {
	return signJwt({
		playerId: session.playerId,
		steamName: session.steamName,
		displayName: session.getDisplayName(),
		useDiscordName: session.useDiscordName,
		preferredJoker: session.preferredJoker,
		discordIdHash: session.discordIdHash,
		discordUsername: session.discordUsername,
		lobbyCode: session.lobbyCode,
	})
}

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

export function createAuthService(deps: AuthServiceDeps) {
	const { playerRepository, gracePeriodService } = deps

	async function ensureSession(playerId: string): Promise<PlayerSession> {
		const existing = getSession(playerId)
		if (existing) return existing
		const dbPlayer = await playerRepository.findPlayerById(playerId)
		if (!dbPlayer) throw new AppError('Player not found', 404)
		return createSession(dbPlayer.steamName, dbPlayerToSessionInit(dbPlayer))
	}

	async function refreshSteamSessionOnReauth(
		session: PlayerSession,
		steamName: string,
	): Promise<SessionAndToken> {
		await gracePeriodService.cancelGracePeriod(session.playerId)
		session.steamName = steamName
		await playerRepository.updateSteamName(session.playerId, steamName)
		return sessionAndToken(session)
	}

	async function restoreSessionFromDbPlayer(
		dbPlayer: PlayerRecord,
		steamName: string,
	): Promise<SessionAndToken> {
		const session = createSession(steamName, dbPlayerToSessionInit(dbPlayer))
		await playerRepository.updateSteamName(dbPlayer.id, steamName)
		// A previously-deleted account is reactivated by simply signing back in
		// with the same Steam identity (steamIdHash survives deletion for exactly
		// this reason) -- a no-op if the account was never deleted.
		if (dbPlayer.deletedAt) await playerRepository.reactivateIfDeleted(dbPlayer.id)
		return sessionAndToken(session)
	}

	function createBrandNewSteamSession(
		steamName: string,
		steamIdHash: string,
	): SessionAndToken {
		const session = createSession(steamName, { steamIdHash })
		return sessionAndToken(session)
	}

	async function authenticateWithSteam(
		steamId: string,
		steamName: string,
	): Promise<SessionAndToken> {
		const steamIdHash = hashProviderId(steamId)

		const existing = findByProvider('steam', steamIdHash)
		if (existing) return refreshSteamSessionOnReauth(existing, steamName)

		const dbPlayer = await playerRepository.findPlayerBySteamIdHash(steamIdHash)
		if (dbPlayer) return restoreSessionFromDbPlayer(dbPlayer, steamName)

		return createBrandNewSteamSession(steamName, steamIdHash)
	}

	async function refreshDiscordSessionOnReauth(
		session: PlayerSession,
		discordName: string,
	): Promise<SessionAndToken> {
		await gracePeriodService.cancelGracePeriod(session.playerId)
		session.steamName = discordName
		session.discordUsername = discordName
		await playerRepository.updateSteamName(session.playerId, discordName)
		await playerRepository.updateDiscordUsername(session.playerId, discordName)
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
		await playerRepository.updateSteamName(dbPlayer.id, discordName)
		await playerRepository.updateDiscordUsername(dbPlayer.id, discordName)
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
		await playerRepository.createPlayer({
			id: session.playerId,
			steamName: discordName,
			discordIdHash,
		})
		return sessionAndToken(session)
	}

	async function authenticateWithDiscord(
		discordId: string,
		discordName: string,
	): Promise<SessionAndToken> {
		const discordIdHash = hashProviderId(discordId)

		const existing = findByProvider('discord', discordIdHash)
		if (existing) return refreshDiscordSessionOnReauth(existing, discordName)

		const dbPlayer = await playerRepository.findPlayerByDiscordIdHash(discordIdHash)
		if (dbPlayer) return restoreDiscordSessionFromDb(dbPlayer, discordName)

		return createBrandNewDiscordSession(discordName, discordIdHash)
	}

	async function refreshExistingSessionByPlayerId(
		session: PlayerSession,
		steamName: string,
	): Promise<SessionAndToken> {
		await gracePeriodService.cancelGracePeriod(session.playerId)
		session.steamName = steamName
		await playerRepository.updateSteamName(session.playerId, steamName)
		return sessionAndToken(session)
	}

	async function authenticateWithPlayerId(
		playerId: string,
		steamName: string,
	): Promise<SessionAndToken> {
		const existing = getSession(playerId)
		if (existing) return refreshExistingSessionByPlayerId(existing, steamName)

		const dbPlayer = await playerRepository.findPlayerById(playerId)
		if (!dbPlayer) throw new AppError('Player not found', 401)

		return restoreSessionFromDbPlayer(dbPlayer, steamName)
	}

	async function findImpersonationTarget(opts: {
		playerId?: string
		steamId?: string
		discordId?: string
		steamName?: string
	}): Promise<PlayerRecord | null> {
		if (opts.playerId) return playerRepository.findPlayerById(opts.playerId)
		if (opts.steamId)
			return playerRepository.findPlayerBySteamIdHash(hashProviderId(opts.steamId))
		if (opts.discordId)
			return playerRepository.findPlayerByDiscordIdHash(hashProviderId(opts.discordId))
		if (opts.steamName) return playerRepository.findPlayerBySteamName(opts.steamName)
		return null
	}

	async function impersonatePlayer(opts: {
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

	async function linkSteamToPlayer(playerId: string, steamId: string) {
		const session = await ensureSession(playerId)
		const steamIdHash = hashProviderId(steamId)
		ensureProviderNotLinkedElsewhere('steam', steamIdHash, playerId)

		linkProvider(session, 'steam', steamIdHash)
		await playerRepository.linkSteam(playerId, steamIdHash)
		return sessionAndToken(session)
	}

	async function linkDiscordToPlayer(
		playerId: string,
		discordId: string,
		discordUsername?: string,
	) {
		const session = await ensureSession(playerId)
		const discordIdHash = hashProviderId(discordId)
		ensureProviderNotLinkedElsewhere('discord', discordIdHash, playerId)

		linkProvider(session, 'discord', discordIdHash)
		if (discordUsername) session.discordUsername = discordUsername
		await playerRepository.linkDiscord(playerId, discordIdHash, discordUsername)
		return sessionAndToken(session)
	}

	async function unlinkDiscordFromPlayer(playerId: string) {
		const session = await ensureSession(playerId)

		unlinkProvider(session, 'discord')
		session.useDiscordName = false
		await playerRepository.unlinkDiscord(playerId)
		return sessionAndToken(session)
	}

	async function setUseDiscordName(playerId: string, value: boolean) {
		const session = await ensureSession(playerId)

		if (value && !session.discordIdHash) {
			throw new AppError('Discord account not linked', 400)
		}

		session.useDiscordName = value
		await playerRepository.updateUseDiscordName(playerId, value)
		return sessionAndToken(session)
	}

	async function setPreferredJoker(playerId: string, value: string) {
		const session = await ensureSession(playerId)

		if (!isValidJoker(value, session.privileges)) {
			throw new AppError('Invalid joker ID', 400)
		}

		session.preferredJoker = value
		await playerRepository.updatePreferredJoker(playerId, value)
		return sessionAndToken(session)
	}

	async function ensurePlayerExistsInDb(session: PlayerSession): Promise<void> {
		const dbPlayer = await playerRepository.findPlayerById(session.playerId)
		if (dbPlayer) return
		await playerRepository.createPlayer({
			id: session.playerId,
			steamName: session.steamName,
			steamIdHash: session.steamIdHash,
		})
	}

	async function acceptTos(playerId: string, chatEligible?: boolean) {
		const { tosVersion } = getConfig()

		const session = getSession(playerId)
		if (!session) throw new AppError('Session not found', 401)

		await ensurePlayerExistsInDb(session)
		await playerRepository.updateTosAcceptedVersion(playerId, tosVersion)
		session.tosAcceptedVersion = tosVersion

		if (chatEligible !== undefined) {
			await playerRepository.updateChatStatus(playerId, chatEligible, !chatEligible)
			session.chatEnabled = chatEligible
			session.chatBlocked = !chatEligible
		}

		return sessionAndToken(session)
	}

	// Soft-delete only -- never hard-deletes the players row. Hard-deleting
	// would cascade or orphan playerBans, letting a banned player self-serve
	// wipe their own ban by deleting their account. PII is cleared immediately;
	// steamIdHash is kept until purgeExpiredDeletedPlayerHashes later clears it,
	// once 12 months have passed and no ban is active (see that function's
	// comment for why that's not an evasion loophole).
	async function deleteAccount(playerId: string): Promise<void> {
		await playerRepository.softDeletePlayer(playerId)
		await pseudonymizeChatLogsForPlayer(playerId)
		await pseudonymizeRunLogsForPlayer(playerId)
	}

	return {
		authenticateWithSteam,
		authenticateWithDiscord,
		authenticateWithPlayerId,
		impersonatePlayer,
		linkSteamToPlayer,
		linkDiscordToPlayer,
		unlinkDiscordFromPlayer,
		setUseDiscordName,
		setPreferredJoker,
		acceptTos,
		deleteAccount,
	}
}
