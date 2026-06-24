export interface IMatchmakingCoordinator {
	updateGroupQueueOnLobbyJoin(lobbyCode: string, newPlayerId: string): Promise<void>
	removeGroupQueueForLobby(lobbyCode: string): void
	syncMatchLobbyState(lobbyCode: string): Promise<void>
}
