import type { Privilege } from '../shared/types/index.js'

export interface PlayerRecord {
	id: string
	steamIdHash: string | null
	discordIdHash: string | null
	discordUsername: string | null
	useDiscordName: boolean
	preferredJoker: string
	privileges: Privilege[]
	steamName: string
	chatEnabled: boolean
	chatBlocked: boolean
	tosAcceptedVersion: number
	deletedAt: Date | null
}

export interface IPlayerRepository {
	findPlayerBySteamIdHash(steamIdHash: string): Promise<PlayerRecord | null>
	findPlayerByDiscordIdHash(discordIdHash: string): Promise<PlayerRecord | null>
	findPlayerById(id: string): Promise<PlayerRecord | null>
	findPlayerByNakamaUserId(nakamaUserId: string): Promise<PlayerRecord | null>
	findPlayerBySteamName(steamName: string): Promise<PlayerRecord | null>
	createPlayer(data: {
		id: string
		steamName: string
		steamIdHash?: string
		discordIdHash?: string
		nakamaUserId?: string
		// A row for a deleted account (deletedAt set).
		deleted?: boolean
	}): Promise<PlayerRecord>
	linkSteam(playerId: string, steamIdHash: string): Promise<void>
	linkNakamaUser(playerId: string, nakamaUserId: string): Promise<void>
	linkDiscord(
		playerId: string,
		discordIdHash: string,
		discordUsername?: string,
	): Promise<void>
	unlinkDiscord(playerId: string): Promise<void>
	updateUseDiscordName(playerId: string, useDiscordName: boolean): Promise<void>
	updateDiscordUsername(
		playerId: string,
		discordUsername: string,
	): Promise<void>
	updatePreferredJoker(playerId: string, preferredJoker: string): Promise<void>
	updateSteamName(playerId: string, steamName: string): Promise<void>
	recordNoticeAcceptance(
		playerId: string,
		version: number,
		acceptedAt: Date,
	): Promise<void>
	updateChatStatus(
		playerId: string,
		chatEnabled: boolean,
		chatBlocked: boolean,
	): Promise<void>
	// Account deletion (gateways/player-anonymization.gateway.ts): own data
	// goes, shared games take the standard deleted-player id, moderation data
	// takes anonymousId. keptRunIds: the runs whose logs stay as evidence.
	anonymizePlayer(
		playerId: string,
		anonymousId: string,
		keptRunIds: readonly string[],
	): Promise<void>
	// The runs the player has a log in or a report on, and whether they have
	// a ban record.
	deletionFacts(
		playerId: string,
	): Promise<{ runIds: string[]; hasBanRecord: boolean }>
	reactivateIfDeleted(playerId: string): Promise<void>
}
