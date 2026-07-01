import { Socket, createServer } from 'node:net'
import Client from './Client.js'
import { actionHandlers, disconnectFromLobbyAction } from './actionHandlers.js'
import { Lobbies } from './Lobby.js'
import type {
	Action,
	ActionClientToServer,
	ActionCreateLobby,
	ActionEatPizza,
	ActionHandlerArgs,
	ActionJoinLobby,
	ActionLobbyOptions,
	ActionMagnet,
	ActionMagnetResponse,
	ActionPlayHand,
	ActionReceiveEndGameJokersRequest,
	ActionReceiveNemesisDeckRequest,
	ActionRemovePhantom,
	ActionSendPhantom,
	ActionServerToClient,
	ActionSetAnte,
	ActionSetLocation,
	ActionSetFurthestBlind,
	ActionSkip,
	ActionSpentLastShop,
	ActionStartAnteTimer,
	ActionPauseAnteTimer,
	ActionSyncClient,
	ActionUsername,
	ActionUtility,
	ActionVersion,
	ActionReceiveNemesisStatsRequest,
	ActionTcgServerVersion,
	ActionTcgBet,
	ActionTcgPlayerStatusRequest,
	ActionTcgEndTurn,
	ActionModdedRequest,
	ActionRejoinLobby,
    ActionHandyMPExtensionEnable,
    ActionHandyMPExtensionDisable,
} from './actions.js'
import { InsaneInt } from './InsaneInt.js'

const PORT = 8788

/** The amount of milliseconds we wait before sending the initial keepalive packet  */
const KEEP_ALIVE_INITIAL_TIMEOUT = 15000
/** The amount of milliseconds we wait after sending a new retry packet  */
const KEEP_ALIVE_RETRY_TIMEOUT = 5000
/** The amount of retries we do before we declare the socket dead */
const KEEP_ALIVE_RETRY_COUNT = 4

interface BigIntWithToJSON {
	prototype: {
		toJSON: () => string
	}
}

(BigInt as unknown as BigIntWithToJSON).prototype.toJSON = function () {
	return this.toString();
};

const scientificNotationToBigInt = (value: string): bigint => {
	const [coefficient, exponent] = value.split('e')
	const coefficientNum = BigInt(coefficient.replace('.', ''))
	const exponentNum = BigInt(exponent) - BigInt(coefficient.split('.')[1]?.length || 0)
	return coefficientNum * 10n ** exponentNum
}

// biome-ignore lint/suspicious/noExplicitAny: Object is parsed from string
const stringToJson = (str: string): any => {
	const obj: Record<string, string | number | InsaneInt | boolean> = {}
	for (const part of str.split(',')) {
		const [key, value] = part.split(':')
		if (value === 'true' || value === 'false') {
			obj[key] = value === 'true'
			continue
		}
		const numericValue = Number(value)
		let score = null
		if (key === 'score') {
			score = InsaneInt.fromString(value)
		}
		obj[key] = score === null ? (Number.isNaN(numericValue) ? value : numericValue) : score
	}
	return obj
}

/** Serializes an action for transmission to the client */
export const serializeAction = (action: Action): string => {
	const entries = Object.entries(action)
	const parts = entries
		.filter(([_key, value]) => value !== undefined && value !== null)
		.map(([key, value]) => `${key}:${value}`)
	return parts.join(',')
}

const sendActionToSocket =
	(socket: Socket) => (action: ActionServerToClient) => {
		if (!socket || socket.destroyed) {
			return
		}

		const data = JSON.stringify(action)

		const { action: actionName, ...actionArgs } = action

		if (actionName !== 'keepAlive' && actionName !== 'keepAliveAck') {
			console.log(
				`${new Date().toISOString()}: Sent action ${actionName} to client: ${JSON.stringify(actionArgs)}`,
			)
		}

		socket.write(`${data}\n`)
	}

const server = createServer((socket) => {
	socket.allowHalfOpen = false
	// Do not wait for packets to buffer, helps
	// improve latency between responses
	socket.setNoDelay()
	// Enable OS-level TCP keepalive as secondary dead connection detection
	socket.setKeepAlive(true, 10000)

	const client = new Client(socket.address(), sendActionToSocket(socket), socket.end)
	client.sendAction({ action: 'connected' })
	client.sendAction({ action: 'version' })

	// Buffer for incomplete TCP messages
	let dataBuffer = ''

	let isRetry = false
	let retryCount = 0

	const retryTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
		// Ignore if not retry
		if (!isRetry) {
			return
		}

		client.sendAction({ action: 'keepAlive' })
		retryCount++

		if (retryCount >= KEEP_ALIVE_RETRY_COUNT) {
			socket.end()
		} else {
			retryTimer.refresh()
		}
	}, KEEP_ALIVE_RETRY_TIMEOUT)

	// Once the client connects, we start a timer
	const keepAlive: ReturnType<typeof setTimeout> = setTimeout(() => {
		client.sendAction({ action: 'keepAlive' })
		isRetry = true
		retryTimer.refresh()
	}, KEEP_ALIVE_INITIAL_TIMEOUT)

	socket.on('data', (data) => {
		// Data received, reset keepAlive
		isRetry = false
		retryCount = 0
		keepAlive.refresh()

		// Buffer incoming data — TCP may split large messages across multiple events
		dataBuffer += data.toString()
		const messages = dataBuffer.split('\n')
		// Keep the last (possibly incomplete) chunk in the buffer
		dataBuffer = messages.pop() ?? ''

		for (const msg of messages) {
			if (!msg) continue
			try {
				const message: ActionClientToServer | ActionUtility = JSON.parse(msg)
				const { action, ...actionArgs } = message

				if (action !== 'keepAlive' && action !== 'keepAliveAck') {
					console.log(
						`${new Date().toISOString()}: Received action ${action} from ${client.id}: ${JSON.stringify(
							actionArgs,
						)}`,
					)
				}

				switch (action) {
					case 'setLocation':
						actionHandlers.setLocation(
							actionArgs as ActionHandlerArgs<ActionSetLocation>,
							client,
						)
						break
					case 'version':
						actionHandlers.version(
							actionArgs as ActionHandlerArgs<ActionVersion>,
							client,
						)
						break
					case 'username':
						actionHandlers.username(
							actionArgs as ActionHandlerArgs<ActionUsername>,
							client,
						)
						break
					case 'createLobby':
						actionHandlers.createLobby(
							actionArgs as ActionHandlerArgs<ActionCreateLobby>,
							client,
						)
						break
					case 'joinLobby':
						actionHandlers.joinLobby(
							actionArgs as ActionHandlerArgs<ActionJoinLobby>,
							client,
						)
						break
					case 'rejoinLobby':
						actionHandlers.rejoinLobby(
							actionArgs as ActionHandlerArgs<ActionRejoinLobby>,
							client,
						)
						break
					case 'lobbyInfo':
						actionHandlers.lobbyInfo(client)
						break
					case 'leaveLobby':
						actionHandlers.leaveLobby(client)
						break
					case 'readyLobby':
						actionHandlers.readyLobby(client)
						break
					case 'unreadyLobby':
						actionHandlers.unreadyLobby(client)
						break
					case 'startGame':
						actionHandlers.startGame(client)
						break
					case 'readyBlind':
						actionHandlers.readyBlind(client)
						break
					case 'unreadyBlind':
						actionHandlers.unreadyBlind(client)
						break
					case 'keepAlive':
						actionHandlers.keepAlive(client)
						break
					case 'playHand':
						actionHandlers.playHand(
							actionArgs as ActionHandlerArgs<ActionPlayHand>,
							client,
						)
						break
					case 'stopGame':
						actionHandlers.stopGame(client)
						break
					// Deprecated
					case 'gameInfo':
						actionHandlers.gameInfo(client)
						break
					case 'lobbyOptions':
						actionHandlers.lobbyOptions(
							actionArgs as ActionHandlerArgs<ActionLobbyOptions>,
							client,
						)
						break
					case 'newRound':
						actionHandlers.newRound(client)
						break
					case 'failRound':
						actionHandlers.failRound(client)
						break
					case 'setAnte':
						actionHandlers.setAnte(
							actionArgs as ActionHandlerArgs<ActionSetAnte>,
							client,
						)
						break
					case 'setFurthestBlind':
						actionHandlers.setFurthestBlind(
							actionArgs as ActionHandlerArgs<ActionSetFurthestBlind>,
							client,
						)
						break
					case 'skip':
						actionHandlers.skip(
							actionArgs as ActionHandlerArgs<ActionSkip>,
							client,
						)
						break
					case 'sendPhantom':
						actionHandlers.sendPhantom(
							actionArgs as ActionHandlerArgs<ActionSendPhantom>,
							client,
						)
						break
					case 'removePhantom':
						actionHandlers.removePhantom(
							actionArgs as ActionHandlerArgs<ActionRemovePhantom>,
							client,
						)
						break
					case 'asteroid':
						actionHandlers.asteroid(client)
						break
					case 'letsGoGamblingNemesis':
						actionHandlers.letsGoGamblingNemesis(client)
						break
					case 'eatPizza':
						actionHandlers.eatPizza(
							actionArgs as ActionHandlerArgs<ActionEatPizza>,
							client,
						)
						break
					case 'soldJoker':
						actionHandlers.soldJoker(client)
						break
					case 'spentLastShop':
						actionHandlers.spentLastShop(
							actionArgs as ActionHandlerArgs<ActionSpentLastShop>,
							client,
						)
						break
					case 'magnet':
						actionHandlers.magnet(client)
						break
					case 'magnetResponse':
						actionHandlers.magnetResponse(
							actionArgs as ActionHandlerArgs<ActionMagnetResponse>,
							client,
						)
						break
					case 'getEndGameJokers':
						actionHandlers.getEndGameJokers(client)
						break
					case 'receiveEndGameJokers':
						actionHandlers.receiveEndGameJokers(
							actionArgs as ActionHandlerArgs<ActionReceiveEndGameJokersRequest>,
							client,
						)
						break
					case 'getNemesisDeck':
						actionHandlers.getNemesisDeck(client)
						break
					case 'receiveNemesisDeck':
						actionHandlers.receiveNemesisDeck(
							actionArgs as ActionHandlerArgs<ActionReceiveNemesisDeckRequest>,
							client,
						)
						break
					case 'startAnteTimer':
						actionHandlers.startAnteTimer(
							actionArgs as ActionHandlerArgs<ActionStartAnteTimer>,
							client,
						)
						break
					case 'pauseAnteTimer':
						actionHandlers.pauseAnteTimer(
							actionArgs as ActionHandlerArgs<ActionPauseAnteTimer>,
							client,
						)
						break
					case 'failTimer':
						actionHandlers.failTimer(client)
						break
					case 'failPvPTimer':
						actionHandlers.failPvPTimer(client)
						break
					case 'syncClient':
						actionHandlers.syncClient(
							actionArgs as ActionHandlerArgs<ActionSyncClient>,
							client,
						)
						break
					case "endGameStatsRequested":
						actionHandlers.endGameStatsRequested(client)
						break
					case "nemesisEndGameStats":
						actionHandlers.nemesisEndGameStats(
							actionArgs as ActionHandlerArgs<ActionReceiveNemesisStatsRequest>,
							client
						)
						break
					case 'tcgServerVersion':
						actionHandlers.tcgServerVersion(
							actionArgs as ActionHandlerArgs<ActionTcgServerVersion>,
							client,
						)
						break
					case 'startTcgBetting':
						actionHandlers.startTcgBetting(client)
						break
					case 'tcgBet':
						actionHandlers.tcgBet(
							actionArgs as ActionHandlerArgs<ActionTcgBet>,
							client,
						)
						break
					case 'tcgPlayerStatus':
						actionHandlers.tcgPlayerStatus(
							actionArgs as ActionHandlerArgs<ActionTcgPlayerStatusRequest>,
							client,
						)
						break
					case 'tcgEndTurn':
						actionHandlers.tcgEndTurn(
							actionArgs as ActionHandlerArgs<ActionTcgEndTurn>,
							client,
						)
						break
					case 'moddedAction':
						actionHandlers.moddedAction(
							actionArgs as ActionHandlerArgs<ActionModdedRequest>,
							client,
						)
						break
					case 'handyMPExtensionEnable':
						actionHandlers.handyMPExtensionEnable(
							actionArgs as ActionHandlerArgs<ActionHandyMPExtensionEnable>,
							client,
						)
						break
					case 'handyMPExtensionDisable':
						actionHandlers.handyMPExtensionDisable(
							actionArgs as ActionHandlerArgs<ActionHandyMPExtensionDisable>,
							client,
						)
						break
				}
			} catch (error) {
				const failedToParseError = 'Failed to parse message'
				console.error(failedToParseError, error)
				client.sendAction({
					action: 'error',
					message: failedToParseError,
				})
			}
		}
	})

	socket.on('end', () => {
		console.log(`Client disconnected ${client.id}`)
		disconnectFromLobbyAction(client)
	})

	socket.on(
		'error',
		(
			err: Error & {
				errno: number
				code: string
				syscall: string
			},
		) => {
			if (err.code === 'ECONNRESET') {
				console.warn('TCP connection reset by peer (client).')
			} else {
				console.error('An unexpected error occurred:', err)
			}
			disconnectFromLobbyAction(client)
		},
	)
})

server.listen(PORT, '0.0.0.0', () => {
	console.log(`Server listening on port ${PORT}`)
})

// Admin server for sending messages to players
import { verify as cryptoVerify, createPublicKey } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ADMIN_PORT = 8789

// Works under both tsc-emitted ESM (npm run start) and the esbuild CJS bundle
// used by pkg. import.meta.url is undefined in CJS output; __dirname is
// undefined in ESM. typeof is the only safe way to probe an undeclared name.
const scriptDir = typeof __dirname !== 'undefined'
	? __dirname
	: dirname(fileURLToPath(import.meta.url))
const ADMIN_PUBLIC_KEY_PATH = resolve(scriptDir, '..', '.github', 'admin_public.pem')
const adminPublicKey = existsSync(ADMIN_PUBLIC_KEY_PATH)
	? createPublicKey(readFileSync(ADMIN_PUBLIC_KEY_PATH, 'utf-8'))
	: null

if (!adminPublicKey) {
	console.warn('WARNING: admin_public.pem not found, admin server will reject all requests')
}

const verifyAdminSignature = (payload: string, signature: string): boolean => {
	if (!adminPublicKey) return false
	try {
		return cryptoVerify(null, Buffer.from(payload), adminPublicKey, Buffer.from(signature, 'base64'))
	} catch {
		return false
	}
}

const sendToTargets = (
	lobby_code: string | undefined,
	is_host: boolean | undefined,
	action: any,
): { success: boolean; recipients?: number; error?: string } => {
	let recipients = 0

	if (lobby_code) {
		const lobby = Lobbies.get(lobby_code)
		if (!lobby) return { success: false, error: 'Lobby not found' }

		if (is_host === true) {
			if (lobby.host) { lobby.host.sendAction(action); recipients++ }
		} else if (is_host === false) {
			if (lobby.guest) { lobby.guest.sendAction(action); recipients++ }
		} else {
			if (lobby.host) { lobby.host.sendAction(action); recipients++ }
			if (lobby.guest) { lobby.guest.sendAction(action); recipients++ }
		}
	} else {
		for (const lobby of Lobbies.values()) {
			if (lobby.host) { lobby.host.sendAction(action); recipients++ }
			if (lobby.guest) { lobby.guest.sendAction(action); recipients++ }
		}
	}

	return { success: true, recipients }
}

const adminHandlers: Record<string, (parsed: any, socket: import('net').Socket) => void> = {
	message(parsed, socket) {
		const { message, lobby_code, is_host } = parsed
		if (!message || typeof message !== 'string') {
			socket.end(JSON.stringify({ success: false, error: 'Missing message' }) + '\n')
			return
		}
		const result = sendToTargets(lobby_code, is_host, { action: 'error', message })
		socket.end(JSON.stringify(result) + '\n')
	},

	jimboAppear(parsed, socket) {
		const { pos, text, lobby_code, is_host } = parsed
		if (typeof pos !== 'number' || pos < 1 || pos > 4) {
			socket.end(JSON.stringify({ success: false, error: 'pos must be a number 1-4' }) + '\n')
			return
		}
		if (text !== undefined && typeof text !== 'string') {
			socket.end(JSON.stringify({ success: false, error: 'text must be a string' }) + '\n')
			return
		}
		const result = sendToTargets(lobby_code, is_host, { action: 'jimboAppear', pos, text })
		socket.end(JSON.stringify(result) + '\n')
	},

	jimboTalk(parsed, socket) {
		const { text, lobby_code, is_host } = parsed
		if (!text || typeof text !== 'string') {
			socket.end(JSON.stringify({ success: false, error: 'Missing text' }) + '\n')
			return
		}
		const result = sendToTargets(lobby_code, is_host, { action: 'jimboTalk', text })
		socket.end(JSON.stringify(result) + '\n')
	},

	jimboMove(parsed, socket) {
		const { pos, lobby_code, is_host } = parsed
		if (typeof pos !== 'number' || pos < 1 || pos > 4) {
			socket.end(JSON.stringify({ success: false, error: 'pos must be a number 1-4' }) + '\n')
			return
		}
		const result = sendToTargets(lobby_code, is_host, { action: 'jimboMove', pos })
		socket.end(JSON.stringify(result) + '\n')
	},

	jimboRemove(parsed, socket) {
		const { lobby_code, is_host } = parsed
		const result = sendToTargets(lobby_code, is_host, { action: 'jimboRemove' })
		socket.end(JSON.stringify(result) + '\n')
	},

	listLobbies(_parsed, socket) {
		const lobbies: string[] = []
		for (const [code, lobby] of Lobbies.entries()) {
			const host = lobby.host?.username ?? '???'
			const guest = lobby.guest?.username
			lobbies.push(guest ? `${code} - ${host}, ${guest}` : `${code} - ${host}`)
		}
		socket.end(JSON.stringify({ success: true, count: lobbies.length, lobbies }) + '\n')
	},
}

const adminServer = createServer((socket) => {
	socket.on('data', (data) => {
		const messages = data.toString().split('\n')
		for (const msg of messages) {
			if (!msg) continue
			try {
				const envelope = JSON.parse(msg)
				const { payload, signature } = envelope

				if (!payload || !signature) {
					socket.end(JSON.stringify({ success: false, error: 'Missing payload or signature' }) + '\n')
					return
				}

				if (!verifyAdminSignature(payload, signature)) {
					socket.end(JSON.stringify({ success: false, error: 'Invalid signature' }) + '\n')
					return
				}

				const parsed = JSON.parse(payload)
				const command = parsed.command ?? 'message'
				const handler = adminHandlers[command]
				if (!handler) {
					socket.end(JSON.stringify({ success: false, error: `Unknown command: ${command}` }) + '\n')
					return
				}
				handler(parsed, socket)
			} catch (error) {
				socket.end(JSON.stringify({ success: false, error: 'Invalid JSON' }) + '\n')
			}
		}
	})
})

adminServer.listen(ADMIN_PORT, '127.0.0.1', () => {
	console.log(`Admin server listening on 127.0.0.1:${ADMIN_PORT}`)
})
