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

export const getEnemies = (client: Client): [Lobby | null, Client[] | null] => {
	const lobby = client.lobby
	if (!lobby) return [null, null]
	if (lobby.host?.id === client.id) {
		return [lobby, lobby.guests]
	} else if (lobby.guests.map((guest) => guest.id).includes(client.id) && lobby.host != null) {
		var otherGuests = lobby.guests.filter((guest) => guest.id !== client.id);
		var enemies = [lobby.host]
		otherGuests.forEach((guest) => {
			enemies.push(guest)
		})

		return [lobby, enemies]
	}
	return [lobby, null]
}

class Lobby {
	code: string;
	host: Client | null;
	guests: Client[];
	gameMode: GameMode;
	// biome-ignore lint/suspicious/noExplicitAny: 
	options: { [key: string]: any };

	// Attrition is the default game mode
	constructor(host: Client, gameMode: GameMode = "attrition") {
		do {
			this.code = generateUniqueLobbyCode();
		} while (Lobbies.get(this.code));
		Lobbies.set(this.code, this);

		this.host = host;
		this.guests = [];
		this.gameMode = gameMode;
		this.options = {};

		host.setLobby(this);
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
		if (this.host?.id === client.id && this.guests.length > 0) {
			this.host = this.guests.pop() ?? null;
		} else if (this.guests.map((guest) => guest.id).includes(client.id)) {
			var index = this.guests.indexOf(client);
			this.guests.splice(index, 1);
		}

		client.setLobby(null);
		if (this.host === null) {
			Lobbies.delete(this.code);
		} else {
			// TODO: Refactor for more than 2 players
			// Stop game if someone leaves
			this.broadcastAction({ action: "stopGame" });
			this.resetPlayers();
			this.broadcastLobbyInfo();
		}
	};

	join = (client: Client) => {
		if (this.guests?.length === 4) {
			client.sendAction({
				action: "error",
				message: "Lobby is full or does not exist.",
			});
			return;
		}
		this.guests.push(client);
		client.setLobby(this);
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
		this.guests.forEach(guest => {
			guest.sendAction(action)
		});
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

		this.guests.forEach((guest) => {
			if (guest.username) {
				action.guest = guest.username;
				action.guestHash = guest.modHash;
				action.guestCached = guest.isCached;
				guest.sendAction(action);
			}
		})
		
		// Should only sent true to the host
		action.isHost = true;
		this.host.sendAction(action);
	};

	setPlayersLives = (lives: number) => {
		// TODO: Refactor for more than 2 players
		if (this.host) this.host.lives = lives;
		this.guests.forEach((guest) => {
			guest.lives = lives;
		})

		this.broadcastAction({ action: "playerInfo", lives });
	};

	// Deprecated
	sendGameInfo = (client: Client) => {
		if (this.host !== client && !this.guests.includes(client)) {
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

		this.guests.forEach((guest) => {
			guest.sendAction({ action: "lobbyOptions", gamemode: this.gameMode, ...options });
		})
	};

	resetPlayers = () => {
		if (this.host) {
			this.host.isReady = false;
			this.host.resetBlocker();
			this.host.setLocation("Blind Select");
		}
		this.guests.forEach((guest) => {
			guest.isReady = false;
			guest.resetBlocker();
			guest.setLocation("Blind Select");
		})
	}
}

export default Lobby;
