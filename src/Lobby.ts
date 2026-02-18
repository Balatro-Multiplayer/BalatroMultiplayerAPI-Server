import type Client from "./Client.js";
import GameModes from "./GameMode.js";
import type {
	ActionLobbyInfo,
	ActionServerToClient,
	GameMode,
} from "./actions.js";

const Lobbies = new Map();

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

class Lobby {
	code: string;
	host: Client | null;
	guest: Client | null;
	gameMode: GameMode;
	// biome-ignore lint/suspicious/noExplicitAny:
	options: { [key: string]: any };
	tcgBets: Map<string, number>;
    handyAllowMPExtension: Map<string, boolean>;

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

		host.setLobby(this);
		host.isReadyLobby = false;
		host.sendAction({
			action: "joinedLobby",
			code: this.code,
			type: this.gameMode,
		});
	}

	static get = (code: string) => {
		return Lobbies.get(code);
	};

	leave = (client: Client) => {
		if (this.host?.id === client.id) {
			this.host = this.guest;
			this.guest = null;
		} else if (this.guest?.id === client.id) {
			this.guest = null;
		}

		client.setLobby(null);
		if (this.host === null) {
			Lobbies.delete(this.code);
		} else {
            this.handyAllowMPExtension.delete(client.id)

			// TODO: Refactor for more than 2 players
			// Stop game if someone leaves
			this.broadcastAction({ action: "stopGame" });
			this.resetPlayers();
			this.broadcastLobbyInfo();
		}
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
	}
}

export default Lobby;
