import mqtt from 'mqtt'
import { env } from '../../env.js'
import type { LobbyEvent } from '../../shared/types/index.js'
import type { ModConfig } from '../../state/config.js'

const ACTIONS_TOPIC_FILTER = 'lobby/+/players/+/actions'
const ACTIONS_TOPIC_RE = /^lobby\/([^/]+)\/players\/([^/]+)\/actions$/

const CHALLENGE_RESPONSE_TOPIC_FILTER = 'player/+/challenge-response'
const CHALLENGE_RESPONSE_TOPIC_RE = /^player\/([^/]+)\/challenge-response$/

interface ActionEnvelope {
	action: string
	from: string
	to: string
	params: Record<string, unknown>
}

class MqttService {
	private client: mqtt.MqttClient | null = null

	async connect(): Promise<void> {
		return new Promise((resolve, reject) => {
			let initialConnect = true

			this.client = mqtt.connect(env.EMQX_BROKER_URL, {
				clientId: env.EMQX_SYSTEM_CLIENT_ID,
				username: env.EMQX_SYSTEM_USERNAME,
				password: env.EMQX_SYSTEM_PASSWORD,
				clean: true,
				keepalive: 60,
				reconnectPeriod: 5000,
			})

			this.client.on('connect', () => {
				console.log('[mqtt] System client connected to EMQX')
				if (initialConnect) {
					initialConnect = false
					resolve()
				}
			})

			this.client.on('error', (err) => {
				console.error('[mqtt] System client error:', err)
				if (initialConnect) {
					initialConnect = false
					reject(err)
				}
			})

			this.client.on('reconnect', () => {
				console.log('[mqtt] System client reconnecting...')
			})

			this.client.on('offline', () => {
				console.log('[mqtt] System client offline')
			})

			this.client.on('close', () => {
				console.log('[mqtt] System client connection closed')
			})
		})
	}

	async publishEvent(lobbyCode: string, event: LobbyEvent): Promise<void> {
		const topic = `lobby/${lobbyCode}/events`
		await this.publish(topic, JSON.stringify(event), {
			qos: 1,
			retain: false,
		})
	}

	async publishMetadata(
		lobbyCode: string,
		metadata: Record<string, unknown>,
	): Promise<void> {
		const topic = `lobby/${lobbyCode}/metadata`
		await this.publish(topic, JSON.stringify(metadata), {
			qos: 1,
			retain: true,
		})
	}

	async publishToPlayer(
		playerId: string,
		subtopic: string,
		payload: Record<string, unknown>,
	): Promise<void> {
		const topic = `player/${playerId}/${subtopic}`
		await this.publish(topic, JSON.stringify(payload), {
			qos: 1,
			retain: false,
		})
	}

	async publishModUpdate(mods: ModConfig[]): Promise<void> {
		await this.publish(
			'bmp/notifications/mod-updates',
			JSON.stringify({ mods, timestamp: new Date().toISOString() }),
			{ qos: 1, retain: true },
		)
	}

	async cleanupLobbyTopics(
		lobbyCode: string,
		playerIds?: string[],
	): Promise<void> {
		const retainedTopics = [`lobby/${lobbyCode}/metadata`]

		if (playerIds) {
			for (const id of playerIds) {
				retainedTopics.push(`lobby/${lobbyCode}/players/${id}/info`)
				retainedTopics.push(`lobby/${lobbyCode}/players/${id}/state`)
			}
		}

		for (const topic of retainedTopics) {
			await this.publish(topic, '', { qos: 1, retain: true })
		}
	}

	async publishPlayerInfo(
		lobbyCode: string,
		playerId: string,
		info: { displayName: string; preferredJoker: string },
	): Promise<void> {
		const topic = `lobby/${lobbyCode}/players/${playerId}/info`
		await this.publish(topic, JSON.stringify(info), {
			qos: 1,
			retain: true,
		})
	}

	async clearPlayerInfo(lobbyCode: string, playerId: string): Promise<void> {
		const topic = `lobby/${lobbyCode}/players/${playerId}/info`
		await this.publish(topic, '', { qos: 1, retain: true })
	}

	async publishChatMessage(
		lobbyCode: string,
		playerId: string,
		displayName: string,
		message: string,
	): Promise<void> {
		const topic = `lobby/${lobbyCode}/chat/${playerId}`
		await this.publish(
			topic,
			JSON.stringify({ message, displayName, playerId }),
			{
				qos: 1,
				retain: false,
			},
		)
	}

	async cleanupPlayerState(lobbyCode: string, playerId: string): Promise<void> {
		const topic = `lobby/${lobbyCode}/players/${playerId}/state`
		await this.publish(topic, '', { qos: 1, retain: true })
	}

	// Subscribes to every player's per-lobby actions topic and invokes `handler`
	// for broadcasts/sends of the given MPAPI ActionType key. The envelope is
	// `{cid, action, from, to, params}` (see BalatroMultiplayerAPI's
	// api/action/instance.lua) -- `from` is always the topic's own playerId
	// segment, since each player publishes their own actions to their own
	// subtopic. Multiple calls (one per actionKey) share the same wildcard
	// subscription and just add another filtered listener.
	async subscribeToLobbyActions(
		actionKey: string,
		handler: (
			lobbyCode: string,
			playerId: string,
			params: Record<string, unknown>,
		) => void,
	): Promise<void> {
		if (!this.client) throw new Error('MQTT client not connected')

		await new Promise<void>((resolve, reject) => {
			this.client!.subscribe(ACTIONS_TOPIC_FILTER, { qos: 1 }, (err) => {
				if (err) reject(err)
				else resolve()
			})
		})

		this.client.on('message', (topic, payload) => {
			const match = ACTIONS_TOPIC_RE.exec(topic)
			if (!match) return

			let envelope: ActionEnvelope
			try {
				envelope = JSON.parse(payload.toString())
			} catch {
				return
			}
			if (envelope.action !== actionKey) return

			handler(match[1], match[2], envelope.params ?? {})
		})
	}

	// Subscribes to every player's own challenge-response topic (see
	// launcher-integrity.service.ts). Mirrors subscribeToLobbyActions's shape --
	// a fixed-format wildcard subscription, one `message` listener added per
	// call -- but this topic isn't lobby-scoped, since a login challenge fires
	// before the player is necessarily in any lobby at all.
	async subscribeToPlayerChallengeResponses(
		handler: (playerId: string, payload: Record<string, unknown>) => void,
	): Promise<void> {
		if (!this.client) throw new Error('MQTT client not connected')

		await new Promise<void>((resolve, reject) => {
			this.client!.subscribe(
				CHALLENGE_RESPONSE_TOPIC_FILTER,
				{ qos: 1 },
				(err) => {
					if (err) reject(err)
					else resolve()
				},
			)
		})

		this.client.on('message', (topic, payload) => {
			const match = CHALLENGE_RESPONSE_TOPIC_RE.exec(topic)
			if (!match) return

			let body: Record<string, unknown>
			try {
				body = JSON.parse(payload.toString())
			} catch {
				return
			}

			handler(match[1], body)
		})
	}

	private publish(
		topic: string,
		payload: string,
		opts: mqtt.IClientPublishOptions,
	): Promise<void> {
		return new Promise((resolve, reject) => {
			if (!this.client) {
				reject(new Error('MQTT client not connected'))
				return
			}
			this.client.publish(topic, payload, opts, (err) => {
				if (err) reject(err)
				else resolve()
			})
		})
	}

	disconnect(): Promise<void> {
		return new Promise((resolve) => {
			if (!this.client) {
				resolve()
				return
			}
			this.client.end(false, () => {
				resolve()
			})
		})
	}
}

export const mqttService = new MqttService()
