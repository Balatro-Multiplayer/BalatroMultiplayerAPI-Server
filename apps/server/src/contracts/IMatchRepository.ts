import type { Match, MatchStatus, PlacementEntry, StoredLobbyState } from '../shared/types/index.js'

export interface RatingResult {
	playerId: string
	newRating: number | null
	delta: number | null
	gamesPlayed: number
	isPlacement: boolean
}

export interface ActiveMatchRow {
	matchId: string
	lobbyCode: string
	modId: string
	gameMode: string
	players: unknown
	lobbyState: unknown
	createdAt: Date
}

export interface SeasonRow {
	id: number
	name: string
	startedAt: Date
	endsAt: Date
}

export interface IMatchRepository {
	insertMatch(
		matchId: string,
		lobbyCode: string,
		modId: string,
		gameMode: string,
		playerIds: string[],
		lobbyState: StoredLobbyState,
	): Promise<void>
	updateMatchLobbyState(lobbyCode: string, state: StoredLobbyState): Promise<void>
	loadActiveMatches(): Promise<ActiveMatchRow[]>
	updateMatchStatus(matchId: string, status: MatchStatus): Promise<void>
	applyRatingTransaction(
		matchId: string,
		match: Match,
		seasonId: number,
		placements: PlacementEntry[],
	): Promise<RatingResult[]>
	getCurrentSeason(): Promise<SeasonRow | undefined>
	getPlayerCurrentRating(playerId: string, modId: string, gameMode: string): Promise<number>
	setMatchGameStarted(matchId: string, startedAt: Date): Promise<void>
}
