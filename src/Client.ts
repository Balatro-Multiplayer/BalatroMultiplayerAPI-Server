import { type AddressInfo } from 'node:net'
import { randomBytes } from 'node:crypto'
import { v4 as uuidv4 } from 'uuid'
import type Lobby from './Lobby.js'
import type { ActionServerToClient } from './actions.js'
import { InsaneInt } from './InsaneInt.js'
import { parseConnectionId } from './abuse.js'

type SendFn = (action: ActionServerToClient) => void
type CloseConnFn = () => void

/* biome-ignore lint/complexity/noBannedTypes:
	This is how the net module does it */
type Address = AddressInfo | {}

class Client {
	// Connection info
	id: string
	// Could be useful later on to detect reconnects
	address: Address
	/** Remote peer IP (socket.remoteAddress). Used for abuse metering + bans —
	 *  unlike `address`, which is the server's own bound address. */
	remoteAddress: string
	/** Client hardware id (serversideConnectionID), parsed out of modHash once the
	 *  username action arrives. Used as a second ban key to defeat IP rotation. */
	connectionId: string | null = null
	sendAction: SendFn
	closeConnection: CloseConnFn
	/** Token used to verify identity when reconnecting to a lobby */
	reconnectToken: string

	// Game info
	username = 'Guest'
	modHash = 'NULL'
	lobby: Lobby | null = null
	isReadyLobby = false
	/** Whether player is ready for next blind */
	isReady = false
	firstReady = false
	lives = 5
	score = new InsaneInt(0, 0, 0)
	handsLeft = 4
	/** Whether this player has played a hand in the current blind. Used to
	 *  withhold the opponent's score until the player has committed a hand. */
	playedThisBlind = false
	ante = 1
	skips = 0
	furthestBlind = 0

	/** Guards against a duplicate life loss from the *same* cause firing twice
	 *  (e.g. two failRound call sites for one blind failure). Kept separate per
	 *  cause so a timer expiry and a blind/round loss can each cost a life even
	 *  when they happen within the same round. */
	roundLivesBlocker = false
	timerLivesBlocker = false

	location = 'loc_selecting'

	isCached = true

	constructor(
		address: Address,
		send: SendFn,
		closeConnection: CloseConnFn,
		remoteAddress = '',
	) {
		this.id = uuidv4()
		this.address = address
		this.remoteAddress = remoteAddress
		this.sendAction = send
		this.closeConnection = closeConnection
		this.reconnectToken = randomBytes(16).toString('hex')
	}

	setLocation = (location: string) => {
		this.location = location
		if (this.lobby) {
			if (this.lobby.host === this) {
				this.lobby.guest?.sendAction({ action: "enemyLocation", location: this.location })
			} else {
				this.lobby.host?.sendAction({ action: "enemyLocation", location: this.location })
			}
		}
	}

	setUsername = (username: string) => {
		this.username = username
		this.lobby?.broadcastLobbyInfo()
	}

	setModHash = (modHash: string) => {
		this.modHash = modHash
		// The full modHash string carries serversideConnectionID=<hwid>; capture
		// it as our second ban key.
		this.connectionId = parseConnectionId(modHash)
		this.lobby?.broadcastLobbyInfo()
	}

	setLobby = (lobby: Lobby | null) => {
		this.lobby = lobby
	}

	resetBlocker = () => {
		this.roundLivesBlocker = false
		this.timerLivesBlocker = false
	}

	/**
	 * @param cause 'round' for a blind/PvP-hand loss, 'timer' for an ante/PvP
	 * timer expiry. Each cause has its own once-per-round guard, so a timer
	 * expiry and a round loss can both cost a life in the same round.
	 */
	loseLife = (cause: 'round' | 'timer' = 'round') => {
		const alreadyLost = cause === 'timer' ? this.timerLivesBlocker : this.roundLivesBlocker
		if (alreadyLost) return

		this.lives -= 1
		if (cause === 'timer') {
			this.timerLivesBlocker = true
		} else {
			this.roundLivesBlocker = true
		}
		this.sendAction({ action: "playerInfo", lives: this.lives });
		if (this.lobby && this.lobby.host && this.lobby.guest) {
			const enemy = this.lobby.host === this ? this.lobby.guest : this.lobby.host
			enemy.sendAction({
				action: "enemyInfo",
				handsLeft: this.handsLeft,
				score: this.score.toString(),
				skips: this.skips,
				lives: this.lives,
			});
		}
	}

	setSkips = (skips: number) => {
		this.skips = skips
	}
}

export default Client
