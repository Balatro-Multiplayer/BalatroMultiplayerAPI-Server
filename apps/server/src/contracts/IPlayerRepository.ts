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
}

export interface IPlayerRepository {
	findPlayerBySteamIdHash(steamIdHash: string): Promise<PlayerRecord | null>
	findPlayerByDiscordIdHash(discordIdHash: string): Promise<PlayerRecord | null>
	findPlayerById(id: string): Promise<PlayerRecord | null>
	findPlayerBySteamName(steamName: string): Promise<PlayerRecord | null>
	createPlayer(data: {
		id: string
		steamName: string
		steamIdHash?: string
		discordIdHash?: string
	}): Promise<PlayerRecord>
	linkSteam(playerId: string, steamIdHash: string): Promise<void>
	linkDiscord(playerId: string, discordIdHash: string, discordUsername?: string): Promise<void>
	unlinkDiscord(playerId: string): Promise<void>
	updateUseDiscordName(playerId: string, useDiscordName: boolean): Promise<void>
	updateDiscordUsername(playerId: string, discordUsername: string): Promise<void>
	updatePreferredJoker(playerId: string, preferredJoker: string): Promise<void>
	updateSteamName(playerId: string, steamName: string): Promise<void>
	updateTosAcceptedVersion(playerId: string, version: number): Promise<void>
	updateChatStatus(playerId: string, chatEnabled: boolean, chatBlocked: boolean): Promise<void>
}
