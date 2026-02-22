import mqtt from 'mqtt'
import { env } from '../env.js'
import type { LobbyEvent } from '../types/index.js'

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

	async cleanupLobbyTopics(lobbyCode: string): Promise<void> {
		const retainedTopics = [`lobby/${lobbyCode}/metadata`]

		for (const topic of retainedTopics) {
			await this.publish(topic, '', { qos: 1, retain: true })
		}
	}

	async cleanupPlayerState(
		lobbyCode: string,
		playerId: string,
	): Promise<void> {
		const topic = `lobby/${lobbyCode}/players/${playerId}/state`
		await this.publish(topic, '', { qos: 1, retain: true })
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
