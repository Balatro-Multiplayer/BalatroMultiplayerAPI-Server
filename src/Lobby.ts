import type Client from "./Client.js";
import type { InsaneInt } from "./InsaneInt.js";
import GameModes from "./GameMode.js";
import type {
	ActionLobbyInfo,
	ActionServerToClient,
	GameMode,
} from "./actions.js";

export const Lobbies = new Map<string, Lobby>();

const generateUniqueLobbyCode = (): string => {
	const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
	let result = "";
	for (let i = 0; i < 5; i++) {
		result += chars.charAt(Math.floor(Math.random() * chars.length));
	}
	return Lobbies.get(result) ? generateUniqueLobbyCode() : result;
};

export const getEnemy = (client: Client): [Lobby | null, Client | null] => {
	const lobby = client.lobby
	if (!lobby) return [null, null]
	if (lobby.host?.id === client.id) {
		return [lobby, lobby.guest]
	} else if (lobby.guest?.id === client.id) {
		return [lobby, lobby.host]
	}
	return [lobby, null]
}

/** How long to keep a disconnected player's slot reserved (ms) */
const RECONNECT_GRACE_PERIOD = 60000;

interface SavedGameState {
	lives: number;
	score: InsaneInt;
	handsLeft: number;
	ante: number;
	skips: number;
	furthestBlind: number;
	isReady: boolean;
	firstReady: boolean;
	isReadyLobby: boolean;
	livesBlocker: boolean;
	location: string;
	username: string;
	modHash: string;
}

interface DisconnectedSlot {
	reconnectToken: string;
	role: 'host' | 'guest';
	timer: ReturnType<typeof setTimeout>;
	savedState: SavedGameState;
}

class Lobby {
	code: string;
	host: Client | null;
	guest: Client | null;
	gameMode: GameMode;
	// biome-ignore lint/suspicious/noExplicitAny:
	options: { [key: string]: any };
	tcgBets: Map<string, number>;
    handyAllowMPExtension: Map<string, boolean>;
	firstReadyAt: number | null;
	/** Tracks disconnected players awaiting reconnection */
	disconnectedSlot: DisconnectedSlot | null = null;
	/** Whether a game is currently in progress */
	isInGame = false;

	// Attrition is the default game mode
	constructor(host: Client, gameMode: GameMode = "attrition") {
		do {
			this.code = generateUniqueLobbyCode();
		} while (Lobbies.get(this.code));
		Lobbies.set(this.code, this);

		this.host = host;
		this.guest = null;
		this.gameMode = gameMode;
		this.options = {};
		this.tcgBets = new Map();
        this.handyAllowMPExtension = new Map();
		this.firstReadyAt = null;

		host.setLobby(this);
		host.isReadyLobby = false;
		host.sendAction({
			action: "joinedLobby",
			code: this.code,
			type: this.gameMode,
			reconnectToken: host.reconnectToken,
		});
	}

	static get = (code: string) => {
		return Lobbies.get(code);
	};

	/** Voluntary leave — no grace period */
	leave = (client: Client) => {
		// Clear any pending reconnect slot for this lobby
		if (this.disconnectedSlot) {
			clearTimeout(this.disconnectedSlot.timer);
			this.disconnectedSlot = null;
		}

		if (this.host?.id === client.id) {
			this.host = this.guest;
			this.guest = null;
		} else if (this.guest?.id === client.id) {
			this.guest = null;
		}

		client.setLobby(null);
		this.isInGame = false;

		// Check if anyone is still in the lobby
		const remaining = this.host ?? this.guest;
		if (!remaining) {
			Lobbies.delete(this.code);
		} else {
			// Promote guest to host if needed
			if (!this.host && this.guest) {
				this.host = this.guest;
				this.guest = null;
			}
            this.handyAllowMPExtension.delete(client.id)

			// TODO: Refactor for more than 2 players
			// Stop game if someone leaves
			this.broadcastAction({ action: "stopGame" });
			this.resetPlayers();
			this.broadcastLobbyInfo();
		}
	};

	/** Connection lost — use grace period if game is in progress */
	disconnect = (client: Client) => {
		const isHost = this.host?.id === client.id;
		const isGuest = this.guest?.id === client.id;
		if (!isHost && !isGuest) return;

		// If no game in progress or no other player, do a regular leave
		if (!this.isInGame || (isHost && !this.guest) || (isGuest && !this.host)) {
			this.leave(client);
			return;
		}

		const role = isHost ? 'host' : 'guest';
		const enemy = isHost ? this.guest : this.host;

		// Reserve the slot with a grace period
		console.log(`Player ${client.id} disconnected from lobby ${this.code}, reserving slot for ${RECONNECT_GRACE_PERIOD / 1000}s (saving state: lives=${client.lives}, score=${client.score}, ante=${client.ante})`)

		this.disconnectedSlot = {
			reconnectToken: client.reconnectToken,
			role,
			savedState: {
				lives: client.lives,
				score: client.score,
				handsLeft: client.handsLeft,
				ante: client.ante,
				skips: client.skips,
				furthestBlind: client.furthestBlind,
				isReady: client.isReady,
				firstReady: client.firstReady,
				isReadyLobby: client.isReadyLobby,
				livesBlocker: client.livesBlocker,
				location: client.location,
				username: client.username,
				modHash: client.modHash,
			},
			timer: setTimeout(() => {
				// Grace period expired, do a full leave
				console.log(`Reconnect grace period expired for lobby ${this.code}`)
				this.disconnectedSlot = null;
				this.leave(client);
			}, RECONNECT_GRACE_PERIOD),
		};

		// Remove the client from the slot but keep the lobby alive
		if (isHost) {
			this.host = null;
		} else {
			this.guest = null;
		}
		client.setLobby(null);

		// Notify the remaining player with the grace period so they can show a countdown
		enemy?.sendAction({ action: "enemyDisconnected", timeout: RECONNECT_GRACE_PERIOD / 1000 });
	};

	/** Reconnecting client reclaims their slot */
	rejoin = (newClient: Client, reconnectToken: string): boolean => {
		if (!this.disconnectedSlot || this.disconnectedSlot.reconnectToken !== reconnectToken) {
			return false;
		}

		const { role, timer, savedState } = this.disconnectedSlot;
		clearTimeout(timer);
		this.disconnectedSlot = null;

		// Restore game state from the disconnected player onto the new client
		console.log(`Restoring state for ${role} in lobby ${this.code}: lives=${savedState.lives}, score=${savedState.score}, ante=${savedState.ante}, handsLeft=${savedState.handsLeft}, skips=${savedState.skips}, location=${savedState.location}`)
		newClient.lives = savedState.lives;
		newClient.score = savedState.score;
		newClient.handsLeft = savedState.handsLeft;
		newClient.ante = savedState.ante;
		newClient.skips = savedState.skips;
		newClient.furthestBlind = savedState.furthestBlind;
		newClient.isReady = savedState.isReady;
		newClient.firstReady = savedState.firstReady;
		newClient.isReadyLobby = savedState.isReadyLobby;
		newClient.livesBlocker = savedState.livesBlocker;
		newClient.location = savedState.location;
		newClient.username = savedState.username;
		newClient.modHash = savedState.modHash;

		// Place the new client in the correct slot
		if (role === 'host') {
			this.host = newClient;
		} else {
			this.guest = newClient;
		}

		newClient.setLobby(this);
		this.handyAllowMPExtension.set(newClient.id, false);

		// Send rejoin confirmation with new reconnect token
		newClient.sendAction({
			action: "rejoinedLobby",
			code: this.code,
			type: this.gameMode,
			reconnectToken: newClient.reconnectToken,
		});

		// Notify the other player
		const enemy = role === 'host' ? this.guest : this.host;
		enemy?.sendAction({ action: "enemyReconnected" });

		this.broadcastLobbyInfo();
		return true;
	};

	join = (client: Client) => {
		if (this.guest) {
			client.sendAction({
				action: "error",
				message: "Lobby is full or does not exist.",
			});
			return;
		}

		this.guest = client;

		client.setLobby(this);
		client.isReadyLobby = false;
        this.handyAllowMPExtension.set(client.id, false)
		client.sendAction({
			action: "joinedLobby",
			code: this.code,
			type: this.gameMode,
			reconnectToken: client.reconnectToken,
		});
		client.sendAction({ action: "lobbyOptions", gamemode: this.gameMode, ...this.options });
		this.broadcastLobbyInfo();
	};

	broadcastAction = (action: ActionServerToClient) => {
		this.host?.sendAction(action);
		this.guest?.sendAction(action);
	};

	broadcastLobbyInfo = () => {
		if (!this.host) {
			return;
		}

		const action: ActionLobbyInfo = {
			action: "lobbyInfo",
			host: this.host.username,
			hostHash: this.host.modHash,
			isHost: false,
			hostCached: this.host.isCached,
		};

		if (this.guest?.username) {
			action.guest = this.guest.username;
			action.guestHash = this.guest.modHash;
			action.guestCached = this.guest.isCached;
			action.guestReady = this.guest.isReadyLobby;
			this.guest.sendAction(action);
		}

		// Should only sent true to the host
		action.isHost = true;
		this.host.sendAction(action);

        this.broadcastAction({
            action: "handyMPExtensionLobbyEnabled",
            enabled: Array.from(this.handyAllowMPExtension.values()).every(Boolean)
        })
	};

	setPlayersLives = (lives: number) => {
		// TODO: Refactor for more than 2 players
		if (this.host) this.host.lives = lives;
		if (this.guest) this.guest.lives = lives;

		this.broadcastAction({ action: "playerInfo", lives });
	};

	// Deprecated
	sendGameInfo = (client: Client) => {
		if (this.host !== client && this.guest !== client) {
			return client.sendAction({
				action: "error",
				message: "Client not in Lobby",
			});
		}

		client.sendAction({
			action: "gameInfo",
			...GameModes[this.gameMode].getBlindFromAnte(client.ante, this.options),
		});
	};

	setOptions = (options: { [key: string]: string }) => {
		for (const key of Object.keys(options)) {
			if (options[key] === "true" || options[key] === "false") {
				this.options[key] = options[key] === "true";
			} else {
				this.options[key] = options[key];
			}
		}
		this.guest?.sendAction({ action: "lobbyOptions", gamemode: this.gameMode, ...options });
	};

	resetPlayers = () => {
		this.isInGame = false;
		if (this.host) {
			this.host.isReady = false;
			this.host.resetBlocker();
			this.host.setLocation("Blind Select");
			this.host.furthestBlind = 0;
			this.host.skips = 0;
		}
		if (this.guest) {
			this.guest.isReady = false;
			this.guest.resetBlocker();
			this.guest.setLocation("Blind Select");
			this.guest.furthestBlind = 0;
			this.guest.skips = 0;
		}
		this.tcgBets.clear();
		this.firstReadyAt = null;
	}
}

export default Lobby;
