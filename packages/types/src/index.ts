export interface JwtPayload {
	playerId: string
	steamName: string
	lobbyCode?: string
	isTemp?: boolean
	purpose?: string
}

export interface LobbyEvent {
	type:
		| 'player_joined'
		| 'player_left'
		| 'lobby_closed'
		| 'host_changed'
		| 'metadata_changed'
		| 'player_disconnected'
		| 'player_reconnected'
	lobbyCode: string
	playerId?: string
	displayName?: string
	data?: Record<string, unknown>
	timestamp: string
}

export interface SoloQueueEntry {
	type: 'solo'
	playerId: string
	modId: string
	gameMode: string
	minPlayers: number
	maxPlayers: number
	rating: number
	queuedAt: Date
}

export interface GroupQueueEntry {
	type: 'group'
	lobbyCode: string
	hostPlayerId: string
	playerIds: string[]
	modId: string
	gameMode: string
	minPlayers: number
	maxPlayers: number
	avgRating: number
	queuedAt: Date
}

export type QueueEntry = SoloQueueEntry | GroupQueueEntry

export interface Match {
	matchId: string
	lobbyCode: string
	modId: string
	gameMode: string
	playerIds: string[]
	createdAt: Date
}

export type MatchmakingEvent =
	| {
			type: 'match_found'
			matchId: string
			lobbyCode: string
			modId: string
			gameMode: string
			players: string[]
			timestamp: string
	  }
	| {
			type: 'match_reconnect'
			matchId: string
			lobbyCode: string
			modId: string
			gameMode: string
			timestamp: string
	  }
	| {
			type: 'match_resolved'
			matchId: string
			ratings: Array<{
				playerId: string
				newRating: number | null
				delta: number | null
				gamesPlayed: number
				isPlacement: boolean
			}>
			timestamp: string
	  }

export interface QueueOpts {
	modId: string
	gameMode: string
	minPlayers: number
	maxPlayers: number
}

export interface PlacementEntry {
	playerId: string
	place: number
	teamId?: string
	performance?: number
}
