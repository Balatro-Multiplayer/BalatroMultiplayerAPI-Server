import type { LobbyEvent } from '../shared/types/index.js'
import type { ModConfig } from '../state/config.js'

export interface IMessageBus {
	publishEvent(lobbyCode: string, event: LobbyEvent): Promise<void>
	publishMetadata(lobbyCode: string, metadata: Record<string, unknown>): Promise<void>
	publishPlayerInfo(
		lobbyCode: string,
		playerId: string,
		info: { displayName: string; preferredJoker: string },
	): Promise<void>
	publishToPlayer(
		playerId: string,
		subtopic: string,
		payload: Record<string, unknown>,
	): Promise<void>
	clearPlayerInfo(lobbyCode: string, playerId: string): Promise<void>
	cleanupLobbyTopics(lobbyCode: string, playerIds?: string[]): Promise<void>
	cleanupPlayerState(lobbyCode: string, playerId: string): Promise<void>
	publishChatMessage(
		lobbyCode: string,
		playerId: string,
		displayName: string,
		message: string,
	): Promise<void>
	publishModUpdate(mods: ModConfig[]): Promise<void>
}
