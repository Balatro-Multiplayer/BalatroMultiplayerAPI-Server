import type Client from "./Client.js";
import GameModes from "./GameMode.js";
import { InsaneInt } from "./InsaneInt.js";
import Lobby, { getEnemy } from "./Lobby.js";
import type {
	ActionCreateLobby,
	ActionEatPizza,
	ActionHandlerArgs,
	ActionHandlers,
	ActionJoinLobby,
	ActionMagnet,
	ActionMagnetResponse,
	ActionPlayHand,
	ActionReceiveEndGameJokersRequest,
	ActionReceiveNemesisDeckRequest,
	ActionReceiveNemesisStatsRequest,
	ActionRemovePhantom,
	ActionSendPhantom,
	ActionSetAnte,
	ActionSetLocation,
	ActionSetFurthestBlind,
	ActionSkip,
	ActionSpentLastShop,
	ActionStartAnteTimer,
	ActionPauseAnteTimer,
	ActionSyncClient,
	ActionUsername,
	ActionVersion,
	ActionTcgServerVersion,
	ActionTcgBet,
	ActionTcgPlayerStatusRequest,
	ActionTcgEndTurn,
    ActionHandyMPExtensionEnable,
    ActionHandyMPExtensionDisable,
} from "./actions.js";
import { generateSeed } from "./utils.js";

/** Current TCG server version - clients must match this to use TCG features */
const TCG_SERVER_VERSION = 1;

const usernameAction = (
	{ username, modHash }: ActionHandlerArgs<ActionUsername>,
	client: Client,
) => {
	client.setUsername(username);
	client.setModHash(modHash);
};

const createLobbyAction = (
	{ gameMode }: ActionHandlerArgs<ActionCreateLobby>,
	client: Client,
) => {
	/** Also sets the client lobby to this newly created one */
	new Lobby(client, gameMode);
};

const joinLobbyAction = (
	{ code }: ActionHandlerArgs<ActionJoinLobby>,
	client: Client,
) => {
	const newLobby = Lobby.get(code);
	if (!newLobby) {
		client.sendAction({
			action: "error",
			message: "Lobby does not exist.",
		});
		return;
	}
	newLobby.join(client);
};

const leaveLobbyAction = (client: Client) => {
	client.lobby?.leave(client);
};

const lobbyInfoAction = (client: Client) => {
	client.lobby?.broadcastLobbyInfo();
};

const readyLobbyAction = (client: Client) => {
	client.isReadyLobby = true;
	client.lobby?.broadcastLobbyInfo();
};

const unreadyLobbyAction = (client: Client) => {
	client.isReadyLobby = false;
	client.lobby?.broadcastLobbyInfo();
};

const keepAliveAction = (client: Client) => {
	// Send an ack back to the received keepAlive
	client.sendAction({ action: "keepAliveAck" });
};

const startGameAction = (client: Client) => {
	const lobby = client.lobby;

	// Only allow the host to start the game
	if (!lobby || lobby.host?.id !== client.id) {
		return;
	}

	// Only start the game if guest is ready
	// TODO: Uncomment this when Client ready is released in the mod
	// if (!lobby.guest?.isReadyLobby) {
	// 	return;
	// }

	const lives = lobby.options.starting_lives
		? Number.parseInt(lobby.options.starting_lives)
		: GameModes[lobby.gameMode].startingLives;

	lobby.broadcastAction({
		action: "startGame",
		deck: "c_multiplayer_1",
		seed: lobby.options.different_seeds ? undefined : generateSeed(),
	});

	// Reset players' lives
	lobby.setPlayersLives(lives);

	// Unready guest for next game
	if (lobby.guest) {
		lobby.guest.isReadyLobby = false;
	}
};

const readyBlindAction = (client: Client) => {
	client.isReady = true;

	const [lobby, enemy] = getEnemy(client);

	if (!client.firstReady && !enemy?.isReady && !enemy?.firstReady) {
		client.firstReady = true;
		client.sendAction({ action: "speedrun" });
	}

	// TODO: Refactor for more than two players
	if (client.lobby?.host?.isReady && client.lobby.guest?.isReady) {
		// Reset ready status for next blind
		client.lobby.host.isReady = false;
		client.lobby.guest.isReady = false;

		// Reset scores for next blind
		client.lobby.host.score = new InsaneInt(0, 0, 0);
		client.lobby.guest.score = new InsaneInt(0, 0, 0);

		// Reset hands left for next blind
		client.lobby.host.handsLeft = 4;
		client.lobby.guest.handsLeft = 4;

		client.lobby.broadcastAction({ action: "startBlind" });
	}
};

const unreadyBlindAction = (client: Client) => {
	client.isReady = false;
};

const playHandAction = (
	{ handsLeft, score }: ActionHandlerArgs<ActionPlayHand>,
	client: Client,
) => {
	const [lobby, enemy] = getEnemy(client);

	if (
		lobby === null ||
		enemy === null ||
		lobby.host === null ||
		lobby.guest === null
	) {
		stopGameAction(client);
		return;
	}

	client.score = InsaneInt.fromString(String(score));

	client.handsLeft =
		typeof handsLeft === "number" ? handsLeft : Number(handsLeft);

	enemy.sendAction({
		action: "enemyInfo",
		handsLeft,
		score: client.score.toString(),
		skips: client.skips,
		lives: client.lives,
	});

	// This info is only sent on a boss blind, so it shouldn't
	// affect other blinds
	if (
		(lobby.guest.handsLeft === 0 &&
			lobby.guest.score.lessThan(lobby.host.score)) ||
		(lobby.host.handsLeft === 0 &&
			lobby.host.score.lessThan(lobby.guest.score)) ||
		(lobby.host.handsLeft === 0 && lobby.guest.handsLeft === 0)
	) {
		const roundWinner = lobby.guest.score.lessThan(lobby.host.score)
			? lobby.host
			: lobby.guest;
		const roundLoser =
			roundWinner.id === lobby.host.id ? lobby.guest : lobby.host;

		if (!lobby.host.score.equalTo(lobby.guest.score)) {
			roundLoser.loseLife();

			// If no lives are left, we end the game
			if (lobby.host.lives === 0 || lobby.guest.lives === 0) {
				const gameWinner =
					lobby.host.lives > lobby.guest.lives ? lobby.host : lobby.guest;
				const gameLoser =
					gameWinner.id === lobby.host.id ? lobby.guest : lobby.host;

				gameWinner?.sendAction({ action: "winGame" });
				gameLoser?.sendAction({ action: "loseGame" });
				roundWinner.firstReady = false;
				roundLoser.firstReady = false;
				return;
			}
		}

		roundWinner.firstReady = false;
		roundLoser.firstReady = false;
		roundWinner.sendAction({ action: "endPvP", lost: false });
		roundLoser.sendAction({
			action: "endPvP",
			lost: !lobby.guest.score.equalTo(lobby.host.score),
		});
	}
};

const stopGameAction = (client: Client) => {
	if (!client.lobby) {
		return;
	}
	client.lobby.broadcastAction({ action: "stopGame" });
	client.lobby.resetPlayers();
};

// Deprecated
const gameInfoAction = (client: Client) => {
	client.lobby?.sendGameInfo(client);
};

const lobbyOptionsAction = (
	options: Record<string, string>,
	client: Client,
) => {
	client.lobby?.setOptions(options);
};

const failRoundAction = (client: Client) => {
	const [lobby, enemy] = getEnemy(client);
	if (!lobby || !enemy) return;

	if (lobby.options.death_on_round_loss) {
		client.loseLife();
	}

	if (client.lives === 0) {
		if (lobby.gameMode === "survival") {
			if (enemy.lives === 0) {
				if (client.furthestBlind === enemy.furthestBlind) {
					//Survival draw behavior, both players win by default
					client.sendAction({ action: "winGame" });
					enemy.sendAction({ action: "winGame" });
				} else if (client.furthestBlind < enemy.furthestBlind) {
					client.sendAction({ action: "loseGame" });
					enemy.sendAction({ action: "winGame" });
				}
				//Otherwise do nothing
			} else {
				if (client.furthestBlind < enemy.furthestBlind) {
					client.sendAction({ action: "loseGame" });
					enemy.sendAction({ action: "winGame" });
				}
				//Otherwise do nothing
			}
		} else {
			let gameLoser = null;
			let gameWinner = null;
			if (client.id === lobby.host?.id) {
				gameLoser = lobby.host;
				gameWinner = lobby.guest;
			} else {
				gameLoser = lobby.guest;
				gameWinner = lobby.host;
			}

			gameWinner?.sendAction({ action: "winGame" });
			gameLoser?.sendAction({ action: "loseGame" });
		}
	}
};

const setAnteAction = (
	{ ante }: ActionHandlerArgs<ActionSetAnte>,
	client: Client,
) => {
	client.ante = ante;
};

// TODO: Fix this
const serverVersion = "0.2.12-MULTIPLAYER";
/** Verifies the client version and allows connection if it matches the server's */
const versionAction = (
	{ version }: ActionHandlerArgs<ActionVersion>,
	client: Client,
) => {
	const versionMatch = version.match(/^(\d+\.\d+\.\d+)/);
	if (versionMatch) {
		const clientVersion = versionMatch[1];
		const serverVersionNumber = serverVersion.split("-")[0];

		const [clientMajor, clientMinor, clientPatch] = clientVersion
			.split(".")
			.map(Number);
		const [serverMajor, serverMinor, serverPatch] = serverVersionNumber
			.split(".")
			.map(Number);

		if (
			clientMajor < serverMajor ||
			(clientMajor === serverMajor && clientMinor < serverMinor) ||
			(clientMajor === serverMajor &&
				clientMinor === serverMinor &&
				clientPatch < serverPatch)
		) {
			client.sendAction({
				action: "error",
				message: `[WARN] Server expecting version ${serverVersion}`,
			});
		}
	}
};

const setLocationAction = (
	{ location }: ActionHandlerArgs<ActionSetLocation>,
	client: Client,
) => {
	client.setLocation(location);
};

const newRoundAction = (client: Client) => {
	client.resetBlocker();
};

const setFurthestBlindAction = (
	{ furthestBlind }: ActionHandlerArgs<ActionSetFurthestBlind>,
	client: Client,
) => {
	const [lobby, enemy] = getEnemy(client);
	client.furthestBlind = furthestBlind;
	if (!lobby || !enemy) return;

	//If enemy died and client.furthestBlind is bigger, client wins
	if (
		lobby.gameMode === "survival" &&
		enemy.lives === 0 &&
		client.furthestBlind > enemy.furthestBlind
	) {
		client.sendAction({ action: "winGame" });
		enemy.sendAction({ action: "loseGame" });
	}
};

const skipAction = (
	{ skips }: ActionHandlerArgs<ActionSkip>,
	client: Client,
) => {
	const [lobby, enemy] = getEnemy(client);
	client.setSkips(skips);
	if (!lobby || !enemy) return;
	enemy.sendAction({
		action: "enemyInfo",
		handsLeft: client.handsLeft,
		score: client.score.toString(),
		skips: client.skips,
		lives: client.lives,
	});
};

const sendPhantomAction = (
	{ key }: ActionHandlerArgs<ActionSendPhantom>,
	client: Client,
) => {
	const [lobby, enemy] = getEnemy(client);
	if (!lobby || !enemy) return;
	enemy.sendAction({
		action: "sendPhantom",
		key,
	});
};

const removePhantomAction = (
	{ key }: ActionHandlerArgs<ActionRemovePhantom>,
	client: Client,
) => {
	const [lobby, enemy] = getEnemy(client);
	if (!lobby || !enemy) return;
	enemy.sendAction({
		action: "removePhantom",
		key,
	});
};

const asteroidAction = (client: Client) => {
	const [lobby, enemy] = getEnemy(client);
	if (!lobby || !enemy) return;
	enemy.sendAction({
		action: "asteroid",
	});
};

const letsGoGamblingNemesisAction = (client: Client) => {
	const [lobby, enemy] = getEnemy(client);
	if (!lobby || !enemy) return;
	enemy.sendAction({
		action: "letsGoGamblingNemesis",
	});
};

const eatPizzaAction = (
	{ whole }: ActionHandlerArgs<ActionEatPizza>,
	client: Client,
) => {
	const [lobby, enemy] = getEnemy(client);
	if (!lobby || !enemy) return;
	enemy.sendAction({
		action: "eatPizza",
		whole,
	});
};

const soldJokerAction = (client: Client) => {
	const [lobby, enemy] = getEnemy(client);
	if (!lobby || !enemy) return;
	enemy.sendAction({
		action: "soldJoker",
	});
};

const spentLastShopAction = (
	{ amount }: ActionHandlerArgs<ActionSpentLastShop>,
	client: Client,
) => {
	const [lobby, enemy] = getEnemy(client);
	if (!lobby || !enemy) return;
	enemy.sendAction({
		action: "spentLastShop",
		amount,
	});
};

const magnetAction = (client: Client) => {
	const [lobby, enemy] = getEnemy(client);
	if (!lobby || !enemy) return;
	enemy.sendAction({
		action: "magnet",
	});
};

const magnetResponseAction = (
	{ key }: ActionHandlerArgs<ActionMagnetResponse>,
	client: Client,
) => {
	const [lobby, enemy] = getEnemy(client);
	if (!lobby || !enemy) return;
	enemy.sendAction({
		action: "magnetResponse",
		key,
	});
};

const getEndGameJokersAction = (client: Client) => {
	const [lobby, enemy] = getEnemy(client);
	if (!lobby || !enemy) return;
	enemy.sendAction({
		action: "getEndGameJokers",
	});
};

const receiveEndGameJokersAction = (
	{ keys }: ActionHandlerArgs<ActionReceiveEndGameJokersRequest>,
	client: Client,
) => {
	const [lobby, enemy] = getEnemy(client);
	if (!lobby || !enemy) return;
	enemy.sendAction({
		action: "receiveEndGameJokers",
		keys,
	});
};

const getNemesisDeckAction = (client: Client) => {
	const [lobby, enemy] = getEnemy(client);
	if (!lobby || !enemy) return;
	enemy.sendAction({
		action: "getNemesisDeck",
	});
};

const receiveNemesisDeckAction = (
	{ cards }: ActionHandlerArgs<ActionReceiveNemesisDeckRequest>,
	client: Client,
) => {
	const [lobby, enemy] = getEnemy(client);
	if (!lobby || !enemy) return;
	enemy.sendAction({
		action: "receiveNemesisDeck",
		cards,
	});
};

const requestNemesisStatsActionHandler = (client: Client) => {
	const [lobby, enemy] = getEnemy(client);
	if (!lobby || !enemy) return;
	enemy.sendAction({
		action: "endGameStatsRequested",
	});
};

const receiveNemesisStatsActionHandler = (
	stats: ActionHandlerArgs<ActionReceiveNemesisStatsRequest>,
	client: Client,
) => {
	const [lobby, enemy] = getEnemy(client);
	if (!lobby || !enemy) return;
	enemy.sendAction({
		action: "nemesisEndGameStats",
		...stats,
	});
};

const startAnteTimerAction = (
	{ time }: ActionHandlerArgs<ActionStartAnteTimer>,
	client: Client,
) => {
	const [lobby, enemy] = getEnemy(client);
	if (!lobby || !enemy) return;
	enemy.sendAction({
		action: "startAnteTimer",
		time,
	});
};

const pauseAnteTimerAction = (
	{ time }: ActionHandlerArgs<ActionPauseAnteTimer>,
	client: Client,
) => {
	const [lobby, enemy] = getEnemy(client);
	if (!lobby || !enemy) return;
	enemy.sendAction({
		action: "pauseAnteTimer",
		time,
	});
};

const failTimerAction = (client: Client) => {
	const lobby = client.lobby;

	client.loseLife();

	if (!lobby) return;

	if (client.lives === 0) {
		let gameLoser = null;
		let gameWinner = null;
		if (client.id === lobby.host?.id) {
			gameLoser = lobby.host;
			gameWinner = lobby.guest;
		} else {
			gameLoser = lobby.guest;
			gameWinner = lobby.host;
		}

		gameWinner?.sendAction({ action: "winGame" });
		gameLoser?.sendAction({ action: "loseGame" });
	}
};

const syncClientAction = (
	{ isCached }: ActionHandlerArgs<ActionSyncClient>,
	client: Client,
) => {
	client.isCached = isCached;
};

// TCG Action Handlers
const tcgServerVersionAction = (
	{ version }: ActionHandlerArgs<ActionTcgServerVersion>,
	client: Client,
) => {
	// Only send tcg_compatible if the client's version is compatible (>= server version)
	if (version >= TCG_SERVER_VERSION) {
		client.sendAction({ action: "tcg_compatible" });
	}
};

const startTcgBettingAction = (client: Client) => {
	const lobby = client.lobby;

	// Only allow the host to start the TCG game
	if (!lobby || lobby.host?.id !== client.id) {
		return;
	}

	// Clear any existing bets
	lobby.tcgBets.clear();

	// Broadcast startGame with seed to both players
	lobby.broadcastAction({
		action: "startGame",
		deck: "c_multiplayer_1",
		seed: generateSeed(),
	});
};

const tcgBetAction = (
	{ bet }: ActionHandlerArgs<ActionTcgBet>,
	client: Client,
) => {
	const [lobby, enemy] = getEnemy(client);
	if (!lobby || !enemy) return;

	// Store this client's bet
	lobby.tcgBets.set(client.id, bet);

	// Check if both players have bet
	if (!lobby.host || !lobby.guest) return;
	if (!lobby.tcgBets.has(lobby.host.id) || !lobby.tcgBets.has(lobby.guest.id)) {
		return;
	}

	// Both players have bet, determine winner
	const hostBet = lobby.tcgBets.get(lobby.host.id) ?? 0;
	const guestBet = lobby.tcgBets.get(lobby.guest.id) ?? 0;

	let winner: Client;
	let loser: Client;

	if (hostBet > guestBet) {
		winner = lobby.host;
		loser = lobby.guest;
	} else if (guestBet > hostBet) {
		winner = lobby.guest;
		loser = lobby.host;
	} else {
		// Equal bets - flip a coin
		if (Math.random() < 0.5) {
			winner = lobby.host;
			loser = lobby.guest;
		} else {
			winner = lobby.guest;
			loser = lobby.host;
		}
	}

	const winnerBet = lobby.tcgBets.get(winner.id) ?? 0;

	// Winner receives their bet as damage and starts first
	winner.sendAction({
		action: "tcgStartGame",
		damage: winnerBet,
		starting: true,
	});

	// Loser receives 0 damage and doesn't start
	loser.sendAction({
		action: "tcgStartGame",
		damage: 0,
		starting: false,
	});

	// Clear bets for next round
	lobby.tcgBets.clear();
};

const tcgPlayerStatusAction = (
	args: ActionHandlerArgs<ActionTcgPlayerStatusRequest>,
	client: Client,
) => {
	const [lobby, enemy] = getEnemy(client);
	if (!lobby || !enemy) return;

	// Echo the action to the other player
	enemy.sendAction({
		action: "tcgPlayerStatus",
		...args,
	});
};

const tcgEndTurnAction = (
	args: ActionHandlerArgs<ActionTcgEndTurn>,
	client: Client,
) => {
	const [lobby, enemy] = getEnemy(client);
	if (!lobby || !enemy) return;

	// Send tcgStartTurn to the other player with the same parameters
	enemy.sendAction({
		action: "tcgStartTurn",
		...args,
	});
};

const handyMPExtensionEnable = (
    args: ActionHandlerArgs<ActionHandyMPExtensionEnable>,
    client: Client,
) => {
    if (!client.lobby) return

    client.lobby.handyAllowMPExtension.set(client.id, true)
    client.lobby.broadcastLobbyInfo()
}

const handyMPExtensionDisable = (
    args: ActionHandlerArgs<ActionHandyMPExtensionDisable>,
    client: Client,
) => {
    if (!client.lobby) return

    client.lobby.handyAllowMPExtension.set(client.id, false)
    client.lobby.broadcastLobbyInfo()
}

export const actionHandlers = {
	username: usernameAction,
	createLobby: createLobbyAction,
	joinLobby: joinLobbyAction,
	lobbyInfo: lobbyInfoAction,
	leaveLobby: leaveLobbyAction,
	readyLobby: readyLobbyAction,
	unreadyLobby: unreadyLobbyAction,
	keepAlive: keepAliveAction,
	startGame: startGameAction,
	readyBlind: readyBlindAction,
	unreadyBlind: unreadyBlindAction,
	playHand: playHandAction,
	stopGame: stopGameAction,
	gameInfo: gameInfoAction,
	lobbyOptions: lobbyOptionsAction,
	failRound: failRoundAction,
	setAnte: setAnteAction,
	version: versionAction,
	setLocation: setLocationAction,
	newRound: newRoundAction,
	setFurthestBlind: setFurthestBlindAction,
	skip: skipAction,
	sendPhantom: sendPhantomAction,
	removePhantom: removePhantomAction,
	asteroid: asteroidAction,
	letsGoGamblingNemesis: letsGoGamblingNemesisAction,
	eatPizza: eatPizzaAction,
	soldJoker: soldJokerAction,
	spentLastShop: spentLastShopAction,
	magnet: magnetAction,
	magnetResponse: magnetResponseAction,
	getEndGameJokers: getEndGameJokersAction,
	receiveEndGameJokers: receiveEndGameJokersAction,
	getNemesisDeck: getNemesisDeckAction,
	receiveNemesisDeck: receiveNemesisDeckAction,
	endGameStatsRequested: requestNemesisStatsActionHandler,
	nemesisEndGameStats: receiveNemesisStatsActionHandler,
	startAnteTimer: startAnteTimerAction,
	pauseAnteTimer: pauseAnteTimerAction,
	failTimer: failTimerAction,
	syncClient: syncClientAction,
	tcgServerVersion: tcgServerVersionAction,
	startTcgBetting: startTcgBettingAction,
	tcgBet: tcgBetAction,
	tcgPlayerStatus: tcgPlayerStatusAction,
	tcgEndTurn: tcgEndTurnAction,
    handyMPExtensionEnable: handyMPExtensionEnable,
    handyMPExtensionDisable: handyMPExtensionDisable,
} satisfies Partial<ActionHandlers>;
