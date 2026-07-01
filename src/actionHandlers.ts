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
	ActionRejoinLobby,
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
	ActionSubmitLogHashes,
	ActionStreamLogLines,
	ActionUsername,
	ActionVersion,
	ActionTcgServerVersion,
	ActionTcgBet,
	ActionTcgPlayerStatusRequest,
	ActionTcgEndTurn,
	ActionModded,
	ActionModdedRequest,
	ActionHandyMPExtensionEnable,
	ActionHandyMPExtensionDisable,
} from "./actions.js";
import { generateSeed } from "./utils.js";
import {
	deleteLiveLog,
	recordLiveLogLines,
	recordLogHashes,
} from "./logHashStore.js";

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

/** Called when a client's TCP connection drops (not voluntary) */
const disconnectFromLobbyAction = (client: Client) => {
	client.lobby?.disconnect(client);
};

const rejoinLobbyAction = (
	{ code, reconnectToken }: ActionHandlerArgs<ActionRejoinLobby>,
	client: Client,
) => {
	const lobby = Lobby.get(code);
	if (!lobby) {
		client.sendAction({
			action: "error",
			message: "Lobby no longer exists.",
		});
		return;
	}

	if (!lobby.rejoin(client, reconnectToken)) {
		client.sendAction({
			action: "error",
			message: "Could not rejoin lobby. Token invalid or slot expired.",
		});
	}
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

	// Remember the authoritative seed so end-of-game log hashes can be keyed by
	// it (null for different-seeds games, where each client uses its own).
	const seed = lobby.options.different_seeds ? undefined : generateSeed();
	lobby.seed = seed ?? null;
	// resetPlayers() clears isInGame, so it must run before we set it true below.
	lobby.resetPlayers();

	lobby.isInGame = true;
	lobby.broadcastAction({
		action: "startGame",
		deck: "c_multiplayer_1",
		seed,
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
		if (lobby) lobby.firstReadyAt = Date.now();
		client.sendAction({ action: "speedrun" });
	}

	// TODO: Refactor for more than two players
	if (client.lobby?.host?.isReady && client.lobby.guest?.isReady) {
		// Grant speedrun to second player if within 30s of the first
		if (lobby?.firstReadyAt && (Date.now() - lobby.firstReadyAt) <= 30000) {
			client.sendAction({ action: "speedrun" });
		}
		lobby!.firstReadyAt = null;

		// Reset ready status for next blind
		client.lobby.host.isReady = false;
		client.lobby.guest.isReady = false;

		// Reset scores for next blind
		client.lobby.host.score = new InsaneInt(0, 0, 0);
		client.lobby.guest.score = new InsaneInt(0, 0, 0);

		// Reset hands left for next blind
		client.lobby.host.handsLeft = 4;
		client.lobby.guest.handsLeft = 4;

		// Reset per-blind hand-played gate so opponent scores are withheld
		// again at the start of each blind
		client.lobby.host.playedThisBlind = false;
		client.lobby.guest.playedThisBlind = false;

        let firstPlayer: "host" | "guest" | undefined
        if (client.lobby.host.firstReady) firstPlayer = "host"
        if (client.lobby.guest.firstReady) firstPlayer = "guest"

		client.lobby.broadcastAction({ action: "startBlind", firstPlayer });
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
	client.handsLeft = Math.floor(client.handsLeft);

	// Lobby option, default OFF: the client only enables it for standard-layer
	// rulesets (and sends it explicitly), so gate only when it's truthy. Absent
	// (old clients / non-standard rulesets) means the original immediate relay.
	const hideScore = Boolean(lobby.options.hide_score_until_played);
	// A bootstrap play emitted at blind start reports score 0 (no hand actually
	// committed). A real hand always scores > 0, so use that to decide whether the
	// player has genuinely played this blind. Hand counts can vary in this game, so
	// handsLeft is not a reliable signal.
	const playedRealHand = client.score.greaterThan(new InsaneInt(0, 0, 0));
	const wasFirstHand = playedRealHand && !client.playedThisBlind;
	if (playedRealHand) client.playedThisBlind = true;

	// Reveal our score to the enemy immediately, unless we're withholding it
	// until they have also committed a hand this blind. This stops a player from
	// watching the opponent's score before playing their own hand.
	if (!hideScore || enemy.playedThisBlind) {
		enemy.sendAction({
			action: "enemyInfo",
			handsLeft,
			score: client.score.toString(),
			skips: client.skips,
			lives: client.lives,
		});
	}

	// When withholding, flush the enemy's current score to us on our first hand
	// of the blind (if they have already played) so we catch up to what was held.
	if (hideScore && wasFirstHand && enemy.playedThisBlind) {
		client.sendAction({
			action: "enemyInfo",
			handsLeft: enemy.handsLeft,
			score: enemy.score.toString(),
			skips: enemy.skips,
			lives: enemy.lives,
		});
	}

	// This info is only sent on a boss blind, so it shouldn't
	// affect other blinds
	if (
		(lobby.guest.handsLeft < 1 &&
			lobby.guest.score.lessThan(lobby.host.score)) ||
		(lobby.host.handsLeft < 1 &&
			lobby.host.score.lessThan(lobby.guest.score)) ||
		(lobby.host.handsLeft < 1 && lobby.guest.handsLeft < 1)
	) {
		const roundWinner = lobby.guest.score.lessThan(lobby.host.score)
			? lobby.host
			: lobby.guest;
		const roundLoser =
			roundWinner.id === lobby.host.id ? lobby.guest : lobby.host;

		if (!lobby.host.score.equalTo(lobby.guest.score)) {
			roundLoser.loseLife();

			// If no lives are left, we end the game
			if (lobby.host.lives <= 0 || lobby.guest.lives <= 0) {
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

const failPvPTimerAction = (
	client: Client,
) => {
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
	} else {
        let roundWinner: Client
        let roundLoser: Client
        if (client.id === lobby.host?.id) {
            roundWinner = lobby.guest!;
            roundLoser = lobby.host!;
        } else {
            roundWinner = lobby.host!;
            roundLoser = lobby.guest!;
        }
        roundWinner.firstReady = false;
		roundLoser.firstReady = false;
		roundWinner.sendAction({
            action: "endPvP",
            lost: false,
            pvpTimerLost: true
        });
		roundLoser.sendAction({
			action: "endPvP",
			lost: true,
            pvpTimerLost: true
		});
    }
}

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
const serverVersion = "0.3.2-MULTIPLAYER";
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

const moddedAction = (
	args: ActionHandlerArgs<ActionModdedRequest>,
	client: Client,
) => {
	const [lobby, enemy] = getEnemy(client);
	if (!lobby || !enemy) return;

	const target = args.target as string | undefined;
	const { target: _, ...rest } = args;
	const from = lobby.host?.id === client.id ? "host" : "guest";
	const message = { action: "moddedAction" as const, from, ...rest } as ActionModded;
	const relayTarget = target ?? "nemesis";

	if (relayTarget === "all") {
		lobby.broadcastAction(message);
	} else {
		enemy.sendAction(message);
	}
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

/**
 * Persist a player's end-of-game replay-log fingerprints. The relay just stores
 * them (keyed by the server seed + lobby/player context); cross-referencing a
 * presented log against these happens elsewhere. Best-effort and side-effect
 * only — it never relays anything to the other client.
 */
const submitLogHashesAction = (
	{ carbon, human, seed, log, gameId }: ActionHandlerArgs<ActionSubmitLogHashes>,
	client: Client,
) => {
	const lobby = client.lobby;
	const complete = recordLogHashes({
		lobbyCode: lobby?.code ?? null,
		serverSeed: lobby?.seed ?? null,
		claimedSeed: seed ?? null,
		gameMode: lobby?.gameMode ?? null,
		username: client.username ?? null,
		modHash: client.modHash ?? null,
		isHost: lobby?.host?.id === client.id,
		carbonHash: carbon,
		humanHash: human,
		carbonLog: log ?? null,
	});
	// The complete package supersedes the live stream — drop it. Only when the
	// full carbon block was actually stored, so an oversized/blob-less submit
	// leaves the streamed partial as the fallback record.
	if (complete && gameId) deleteLiveLog(gameId);
};

/**
 * Append a batch of streamed carbon lines for an in-progress game. Best-effort
 * and side-effect only (never relayed to the other client); rate/size limiting
 * lives in the store so abuse is dropped rather than crashing the relay.
 */
const streamLogLinesAction = (
	{ gameId, lines }: ActionHandlerArgs<ActionStreamLogLines>,
	client: Client,
) => {
	recordLiveLogLines({
		clientId: client.id,
		gameId,
		lobbyCode: client.lobby?.code ?? null,
		username: client.username ?? null,
		lines,
	});
};

export const actionHandlers = {
	username: usernameAction,
	createLobby: createLobbyAction,
	joinLobby: joinLobbyAction,
	rejoinLobby: rejoinLobbyAction,
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
	submitLogHashes: submitLogHashesAction,
	streamLogLines: streamLogLinesAction,
	tcgServerVersion: tcgServerVersionAction,
	startTcgBetting: startTcgBettingAction,
	tcgBet: tcgBetAction,
	tcgPlayerStatus: tcgPlayerStatusAction,
	tcgEndTurn: tcgEndTurnAction,
	moddedAction: moddedAction,
	handyMPExtensionEnable: handyMPExtensionEnable,
	handyMPExtensionDisable: handyMPExtensionDisable,
    failPvPTimer: failPvPTimerAction,
} satisfies Partial<ActionHandlers>;

/** Server-internal handler for connection drops (not a client action) */
export { disconnectFromLobbyAction };
