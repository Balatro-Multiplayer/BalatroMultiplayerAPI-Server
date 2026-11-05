import { randomUUID } from 'node:crypto'
import { NOTICE_VERSION } from '@bmp/types'
import type { INakamaAccounts } from '../../contracts/INakamaAccounts.js'
import type {
	IPlayerRepository,
	PlayerRecord,
} from '../../contracts/IPlayerRepository.js'
import type { IRetentionRepository } from '../../contracts/IRetentionRepository.js'
import { AppError } from '../../shared/utils/errors.js'
import { hashProviderId } from '../../shared/utils/hash.js'
import {
	type PlayerSession,
	createSession,
	findByProvider,
	getSession,
	linkProvider,
	unlinkProvider,
} from '../../state/index.js'
import { inOpenUse } from '../retention/limits.js'
import { signJwt } from './jwt.js'

type Provider = 'steam' | 'discord'
type SessionInit = NonNullable<Parameters<typeof createSession>[1]>
type SessionAndToken = { session: PlayerSession; token: string }

interface AuthServiceDeps {
	playerRepository: IPlayerRepository
	nakamaAccounts: INakamaAccounts
	retention: Pick<IRetentionRepository, 'runLinks'>
}

export type AuthService = ReturnType<typeof createAuthService>

function signSessionJwt(session: PlayerSession): string {
	return signJwt({
		playerId: session.playerId,
		steamName: session.steamName,
		displayName: session.getDisplayName(),
		useDiscordName: session.useDiscordName,
		preferredJoker: session.preferredJoker,
		discordIdHash: session.discordIdHash,
		discordUsername: session.discordUsername,
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
	const { playerRepository } = deps

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
		if (dbPlayer.deletedAt)
			await playerRepository.reactivateIfDeleted(dbPlayer.id)
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

		const dbPlayer =
			await playerRepository.findPlayerByDiscordIdHash(discordIdHash)
		if (dbPlayer) return restoreDiscordSessionFromDb(dbPlayer, discordName)

		return createBrandNewDiscordSession(discordName, discordIdHash)
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

	// The route has Nakama validate the joker first (infrastructure/nakama/avatar-sync.ts).
	async function setPreferredJoker(playerId: string, value: string) {
		const session = await ensureSession(playerId)

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
		const session = getSession(playerId)
		if (!session) throw new AppError('Session not found', 401)

		await ensurePlayerExistsInDb(session)
		const acceptedAt = new Date()
		await playerRepository.recordNoticeAcceptance(
			playerId,
			NOTICE_VERSION,
			acceptedAt,
		)
		session.tosAcceptedVersion = NOTICE_VERSION

		if (chatEligible !== undefined) {
			await playerRepository.updateChatStatus(
				playerId,
				chatEligible,
				!chatEligible,
			)
			session.chatEnabled = chatEligible
			session.chatBlocked = !chatEligible
		}

		// The game reads its own Nakama profile: without this it asks again.
		// Best effort, as the other profile edits; Postgres has it already.
		await deps.nakamaAccounts.acceptNotice(playerId, {
			version: NOTICE_VERSION,
			acceptedAt: acceptedAt.getTime(),
			chatEligible,
		})

		return sessionAndToken(session)
	}

	// Account deletion (Notice decision 17), in Nakama first, then in
	// Postgres: the player's own data goes, their side of shared games takes
	// the standard deleted-player id, and moderation data (bans, reports,
	// evidence) stays under a random anonymous id, so deleting an account
	// never wipes a ban. A run's logs are evidence while an open report or ban
	// uses the run. If Nakama can't delete the account nothing changes, and
	// the player can try again.
	async function deleteAccount(playerId: string): Promise<void> {
		const anonymousId = randomUUID()
		const facts = await playerRepository.deletionFacts(playerId)
		const links =
			facts.runIds.length > 0
				? await deps.retention.runLinks(facts.runIds)
				: new Map()
		const now = new Date()
		const keptRunIds = facts.runIds.filter((runId) =>
			inOpenUse(links.get(runId) ?? [], now),
		)
		const nakama = await deps.nakamaAccounts.delete(playerId, anonymousId, {
			keptRunIds,
			keepSteamIdHash: facts.hasBanRecord,
		})
		if (!nakama.ok)
			throw new AppError(
				'Account deletion is unavailable right now, try again later',
				503,
			)
		await playerRepository.anonymizePlayer(playerId, anonymousId, keptRunIds)
	}

	// A session for the player behind a Nakama account, who proved who they
	// are in game (a one-time web login link). Null when no live account has it.
	async function authenticateNakamaUser(
		nakamaUserId: string,
	): Promise<SessionAndToken | null> {
		const dbPlayer = await playerRepository.findPlayerByNakamaUserId(nakamaUserId)
		if (!dbPlayer || dbPlayer.deletedAt) return null
		const session =
			getSession(dbPlayer.id) ??
			createSession(dbPlayer.steamName, dbPlayerToSessionInit(dbPlayer))
		return sessionAndToken(session)
	}

	return {
		authenticateWithSteam,
		authenticateNakamaUser,
		authenticateWithDiscord,
		linkDiscordToPlayer,
		unlinkDiscordFromPlayer,
		setUseDiscordName,
		setPreferredJoker,
		acceptTos,
		deleteAccount,
	}
}
