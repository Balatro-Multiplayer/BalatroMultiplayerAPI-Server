// Server to Client
export type ActionConnected = { action: 'connected' }
export type ActionError = { action: 'error'; message: string }
export type ActionJoinedLobby = { action: 'joinedLobby'; code: string; type: GameMode }
export type ActionLobbyInfo = {
	action: 'lobbyInfo'
	host: string
	hostHash: string
	hostCached: boolean
	guest?: string
	guestHash?: string
	guestCached?: boolean
	guestReady?: boolean
	isHost: boolean
}
export type ActionStopGame = { action: 'stopGame' }
export type ActionStartGame = {
	action: 'startGame'
	deck: string
	stake?: number
	seed?: string
}
export type ActionStartBlind = { action: 'startBlind' }
export type ActionWinGame = { action: 'winGame' }
export type ActionLoseGame = { action: 'loseGame' }
export type ActionGameInfo = {
	action: 'gameInfo'
	small?: string
	big?: string
	boss?: string
}
export type ActionPlayerInfo = { action: 'playerInfo'; lives: number }
export type ActionEnemyInfo = {
	action: 'enemyInfo'
	score: string
	handsLeft: number
	skips: number
	lives: number
}
export type ActionEndPvP = { action: 'endPvP'; lost: boolean }
export type ActionLobbyOptions = { action: 'lobbyOptions', gamemode: string }
export type ActionRequestVersion = { action: 'version' }
export type ActionEnemyLocation = { action: 'enemyLocation'; location: string }
export type ActionSendPhantom = { action: 'sendPhantom', key: string }
export type ActionRemovePhantom = { action: 'removePhantom', key: string }
export type ActionSpeedrun = { action: 'speedrun' }
export type ActionAsteroid = { action: 'asteroid' }
export type ActionLetsGoGamblingNemesis = { action: 'letsGoGamblingNemesis' }
export type ActionEatPizza = { action: 'eatPizza', whole: boolean }
export type ActionSoldJoker = { action: 'soldJoker' }
export type ActionSpentLastShop = { action: 'spentLastShop', amount: number }
export type ActionMagnet = { action: 'magnet' }
export type ActionMagnetResponse = { action: 'magnetResponse', key: string }
export type ActionGetEndGameJokersRequest = { action: 'getEndGameJokers' }
export type ActionReceiveEndGameJokersRequest = { action: 'receiveEndGameJokers', keys: string }
export type ActionGetNemesisDeckRequest = { action: 'getNemesisDeck' }
export type ActionReceiveNemesisDeckRequest = { action: 'receiveNemesisDeck', cards: string }
export type ActionGetNemesisStatsRequest = { action: 'endGameStatsRequested' }
export type ActionReceiveNemesisStatsRequest = { action: 'nemesisEndGameStats', reroll_count: string, reroll_cost_total:string, vouchers:string }
export type ActionStartAnteTimer = { action: 'startAnteTimer', time: number }
export type ActionPauseAnteTimer = { action: 'pauseAnteTimer', time: number }
// Handy Actions (Server to Client)
export type ActionHandyMPExtensionLobbyEnabled = { action: 'handyMPExtensionLobbyEnabled', enabled: boolean }
// TCG Actions (Server to Client)
export type ActionTcgCompatible = { action: 'tcg_compatible' }
export type ActionTcgStartGame = { action: 'tcgStartGame', damage: number, starting: boolean }
export type ActionTcgPlayerStatus = { action: 'tcgPlayerStatus', [key: string]: unknown }
export type ActionTcgStartTurn = { action: 'tcgStartTurn', [key: string]: unknown }
// Modded Actions
export type ActionModded = { action: 'moddedAction', modId: string, modAction: string, target?: 'nemesis' | 'all', [key: string]: unknown }
export type ActionServerToClient =
	| ActionConnected
	| ActionError
	| ActionJoinedLobby
	| ActionLobbyInfo
	| ActionStopGame
	| ActionStartGame
	| ActionStartBlind
	| ActionWinGame
	| ActionLoseGame
	| ActionGameInfo
	| ActionPlayerInfo
	| ActionEnemyInfo
	| ActionEndPvP
	| ActionLobbyOptions
	| ActionRequestVersion
	| ActionUtility
	| ActionEnemyLocation
	| ActionSendPhantom
	| ActionRemovePhantom
	| ActionSpeedrun
	| ActionAsteroid
	| ActionLetsGoGamblingNemesis
	| ActionEatPizza
	| ActionSoldJoker
	| ActionSpentLastShop
	| ActionMagnet
	| ActionMagnetResponse
	| ActionGetEndGameJokersRequest
	| ActionReceiveEndGameJokersRequest
	| ActionGetNemesisDeckRequest
	| ActionReceiveNemesisDeckRequest
	| ActionGetNemesisStatsRequest
	| ActionReceiveNemesisStatsRequest
	| ActionStartAnteTimer
	| ActionPauseAnteTimer
	| ActionTcgCompatible
	| ActionTcgStartGame
	| ActionTcgPlayerStatus
	| ActionTcgStartTurn
	| ActionModded
    | ActionHandyMPExtensionLobbyEnabled
// Client to Server
export type ActionUsername = { action: 'username'; username: string; modHash: string }
export type ActionCreateLobby = { action: 'createLobby'; gameMode: GameMode }
export type ActionJoinLobby = { action: 'joinLobby'; code: string }
export type ActionLeaveLobby = { action: 'leaveLobby' }
export type ActionReadyLobby = { action: 'readyLobby' }
export type ActionUnreadyLobby = { action: 'unreadyLobby' }
export type ActionLobbyInfoRequest = { action: 'lobbyInfo' }
export type ActionStopGameRequest = { action: 'stopGame' }
export type ActionStartGameRequest = { action: 'startGame' }
export type ActionReadyBlind = { action: 'readyBlind' }
export type ActionUnreadyBlind = { action: 'unreadyBlind' }
export type ActionPlayHand = {
	action: 'playHand'
	score: string
	handsLeft: number
	hasSpeedrun: boolean
}
export type ActionGameInfoRequest = { action: 'gameInfo' }
export type ActionPlayerInfoRequest = { action: 'playerInfo' }
export type ActionEnemyInfoRequest = { action: 'enemyInfo' }
export type ActionFailRound = { action: 'failRound' }
export type ActionSetAnte = {
	action: 'setAnte'
	ante: number
}
export type ActionVersion = { action: 'version'; version: string }
export type ActionSetLocation = { action: 'setLocation'; location: string }
export type ActionNewRound = { action: 'newRound' }
export type ActionSetFurthestBlind = { action: 'setFurthestBlind', furthestBlind: number}
export type ActionSkip = { action: 'skip', skips: number }
export type ActionLetsGoGamblingNemesisRequest = { action: 'letsGoGamblingNemesis' }
export type ActionEatPizzaRequest = { action: 'eatPizza', whole: boolean }
export type ActionSoldJokerRequest = { action: 'soldJoker' }
export type ActionSpentLastShopRequest = { action: 'spentLastShop', amount: number }
export type ActionMagnetRequest = { action: 'magnet' }
export type ActionMagnetResponseRequest = { action: 'magnetResponse', key: string }
export type ActionGetEndGameJokersResponse = { action: 'getEndGameJokers' }
export type ActionReceiveEndGameJokersResponse = { action: 'receiveEndGameJokers', keys: string }
export type ActionGetNemesisDeckResponse = { action: 'getNemesisDeck' }
export type ActionReceiveNemesisDeckResponse = { action: 'receiveNemesisDeck', cards: string }
export type ActionGetNemesisStatsResponse = { action: 'endGameStatsRequested' }
export type ActionReceiveNemesisStatsResponse = { action: 'nemesisEndGameStats', reroll_count: string,reroll_cost_total:string, vouchers:string }
export type ActionStartAnteTimerRequest = { action: 'startAnteTimer', time: number }
export type ActionPauseAnteTimerRequest = { action: 'pauseAnteTimer', time: number }
export type ActionFailTimer = { action: 'failTimer' }
export type ActionSyncClient = { action: 'syncClient', isCached: boolean }
// TCG Actions (Client to Server)
export type ActionTcgServerVersion = { action: 'tcgServerVersion', version: number }
export type ActionStartTcgBetting = { action: 'startTcgBetting' }
export type ActionTcgBet = { action: 'tcgBet', bet: number }
export type ActionTcgPlayerStatusRequest = { action: 'tcgPlayerStatus', [key: string]: unknown }
export type ActionTcgEndTurn = { action: 'tcgEndTurn', [key: string]: unknown }
export type ActionModdedRequest = { action: 'moddedAction', modId: string, modAction: string, target?: 'nemesis' | 'all', [key: string]: unknown }
// Handy Actions (Client to Server)
export type ActionHandyMPExtensionEnable = { action: 'handyMPExtensionEnable', [key: string]: unknown }
export type ActionHandyMPExtensionDisable = { action: 'handyMPExtensionDisable', [key: string]: unknown }
export type ActionClientToServer =
	| ActionUsername
	| ActionCreateLobby
	| ActionJoinLobby
	| ActionLeaveLobby
	| ActionReadyLobby
	| ActionUnreadyLobby
	| ActionLobbyInfoRequest
	| ActionStopGameRequest
	| ActionStartGameRequest
	| ActionReadyBlind
	| ActionPlayHand
	| ActionGameInfoRequest
	| ActionPlayerInfoRequest
	| ActionEnemyInfoRequest
	| ActionUnreadyBlind
	| ActionLobbyOptions
	| ActionFailRound
	| ActionSetAnte
	| ActionVersion
	| ActionSetLocation
	| ActionNewRound
	| ActionSetFurthestBlind
	| ActionSkip
	| ActionSendPhantom
	| ActionRemovePhantom
	| ActionAsteroid
	| ActionLetsGoGamblingNemesisRequest
	| ActionEatPizzaRequest
	| ActionSoldJokerRequest
	| ActionSpentLastShopRequest
	| ActionMagnetRequest
	| ActionMagnetResponseRequest
	| ActionGetEndGameJokersResponse
	| ActionReceiveEndGameJokersResponse
	| ActionGetNemesisDeckResponse
	| ActionReceiveNemesisDeckResponse
	| ActionGetNemesisStatsResponse
	| ActionReceiveNemesisStatsResponse
	| ActionStartAnteTimerRequest
	| ActionPauseAnteTimerRequest
	| ActionFailTimer
	| ActionSyncClient
	| ActionTcgServerVersion
	| ActionStartTcgBetting
	| ActionTcgBet
	| ActionTcgPlayerStatusRequest
	| ActionTcgEndTurn
	| ActionModdedRequest
    | ActionHandyMPExtensionEnable
    | ActionHandyMPExtensionDisable
// Utility actions
export type ActionKeepAlive = { action: 'keepAlive' }
export type ActionKeepAliveAck = { action: 'keepAliveAck' }

export type ActionUtility = ActionKeepAlive | ActionKeepAliveAck

export type Action = ActionServerToClient | ActionClientToServer | ActionUtility

type HandledActions = ActionClientToServer | ActionUtility
export type ActionHandlers = {
	[K in HandledActions['action']]: keyof ActionHandlerArgs<
		Extract<HandledActions, { action: K }>
	> extends never
	? (
		// biome-ignore lint/suspicious/noExplicitAny: Function can receive any arguments
		...args: any[]
	) => void
	: (
		action: ActionHandlerArgs<Extract<HandledActions, { action: K }>>,
		// biome-ignore lint/suspicious/noExplicitAny: Function can receive any arguments
		...args: any[]
	) => void
}

export type ActionHandlerArgs<T extends HandledActions> = Omit<T, 'action'>

// Other types
export type GameMode = 'attrition' | 'showdown' | 'survival'
