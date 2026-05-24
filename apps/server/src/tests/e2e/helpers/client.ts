import { connect, type MqttClient } from 'mqtt'

export interface PlayerInfo {
	id: string
	displayName: string
	preferredJoker: string
}

export interface LobbyInfo {
	code: string
	modId: string
	hostId: string
	maxPlayers: number
	metadata: Record<string, unknown>
	isHost: boolean
	players: PlayerInfo[]
}

type MessageHandler = (payload: unknown, topic: string) => void

// Matches an MQTT topic pattern (with + and # wildcards) against a concrete topic.
function matchesTopic(pattern: string, topic: string): boolean {
	const pp = pattern.split('/')
	const tp = topic.split('/')
	for (let i = 0; i < pp.length; i++) {
		if (pp[i] === '#') return true
		if (i >= tp.length) return false
		if (pp[i] !== '+' && pp[i] !== tp[i]) return false
	}
	return pp.length === tp.length
}

/**
 * Simulates an MPAPI game client for E2E tests.
 *
 * Usage pattern for events that fire once (not retained):
 *   await client.subscribe(topic)            // wait for SUBACK
 *   const p = client.nextMessage(topic, fn)  // register one-shot handler
 *   await triggerAction()
 *   const msg = await p
 *
 * Usage pattern for retained topics:
 *   await publishRetained(topic, payload)
 *   const msg = await client.waitFor(topic)  // subscribes then gets retained msg
 */
export class GameClient {
	private _token: string | null = null
	private _playerId: string | null = null
	private _lobbyCode: string | null = null
	private _mqtt: MqttClient | null = null
	private _handlers: Map<string, MessageHandler[]> = new Map()

	constructor(
		readonly baseUrl: string,
		readonly mqttUrl: string,
	) {}

	get playerId(): string {
		if (!this._playerId) throw new Error('Not authenticated')
		return this._playerId
	}
	get token(): string {
		if (!this._token) throw new Error('Not authenticated')
		return this._token
	}
	get lobbyCode(): string | null {
		return this._lobbyCode
	}

	// Creates a dev-mode temp session (no DB player required; NODE_ENV must not be 'production').
	async impersonate(steamName: string): Promise<void> {
		const res = await fetch(`${this.baseUrl}/api/auth/dev`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ steamName }),
		})
		if (!res.ok) throw new Error(`impersonate failed: ${res.status} ${await res.text()}`)
		const data = (await res.json()) as { token: string; player: { id: string } }
		this._token = data.token
		this._playerId = data.player.id
	}

	async connectMqtt(): Promise<void> {
		return new Promise((resolve, reject) => {
			this._mqtt = connect(this.mqttUrl, {
				clientId: this._playerId!,
				username: this._playerId!,
				password: this._token!,
				clean: true,
				connectTimeout: 10_000,
			})

			this._mqtt.once('connect', () => resolve())
			this._mqtt.once('error', reject)

			this._mqtt.on('message', (topic: string, payload: Buffer) => {
				let msg: unknown
				try {
					msg = JSON.parse(payload.toString())
				} catch {
					msg = payload.toString()
				}
				for (const [pattern, handlers] of this._handlers) {
					if (matchesTopic(pattern, topic)) {
						for (const h of [...handlers]) h(msg, topic)
					}
				}
			})
		})
	}

	// Subscribe to a topic and wait for the SUBACK before returning.
	async subscribe(topic: string): Promise<void> {
		if (!this._handlers.has(topic)) {
			this._handlers.set(topic, [])
		}
		return new Promise((resolve, reject) => {
			this._mqtt!.subscribe(topic, { qos: 1 }, (err) => {
				if (err) reject(err)
				else resolve()
			})
		})
	}

	// Add a persistent message handler (does not subscribe — call subscribe() first).
	on(topic: string, handler: MessageHandler): void {
		const list = this._handlers.get(topic) ?? []
		list.push(handler)
		this._handlers.set(topic, list)
	}

	// One-shot: resolves on the next message matching predicate on an already-subscribed topic.
	nextMessage<T = unknown>(
		topic: string,
		predicate?: (msg: T, topic: string) => boolean,
		timeoutMs = 15_000,
	): Promise<T> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				reject(new Error(`nextMessage timeout (${timeoutMs}ms) on topic "${topic}"`))
			}, timeoutMs)

			const handler: MessageHandler = (msg, t) => {
				const typed = msg as T
				if (!predicate || predicate(typed, t)) {
					clearTimeout(timer)
					const list = this._handlers.get(topic) ?? []
					const idx = list.indexOf(handler)
					if (idx !== -1) list.splice(idx, 1)
					resolve(typed)
				}
			}
			const list = this._handlers.get(topic) ?? []
			list.push(handler)
			this._handlers.set(topic, list)
		})
	}

	// Convenience: subscribe (SUBACK) then wait for the first matching message.
	// Useful for retained topics or when you control when the publish happens.
	async waitFor<T = unknown>(
		topic: string,
		predicate?: (msg: T, topic: string) => boolean,
		timeoutMs = 15_000,
	): Promise<T> {
		await this.subscribe(topic)
		return this.nextMessage<T>(topic, predicate, timeoutMs)
	}

	publish(topic: string, payload: unknown, opts?: { retain?: boolean; qos?: 0 | 1 | 2 }): void {
		this._mqtt!.publish(topic, JSON.stringify(payload), {
			retain: opts?.retain ?? false,
			qos: opts?.qos ?? 1,
		})
	}

	private async http(method: string, path: string, body?: unknown): Promise<Response> {
		const opts: RequestInit = {
			method,
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${this._token!}`,
			},
		}
		if (body !== undefined) opts.body = JSON.stringify(body)
		return fetch(`${this.baseUrl}${path}`, opts)
	}

	async createLobby(modId: string, maxPlayers?: number): Promise<LobbyInfo> {
		const res = await this.http('POST', '/api/lobbies', { modId, maxPlayers })
		if (!res.ok) throw new Error(`createLobby failed: ${res.status} ${await res.text()}`)
		const data = (await res.json()) as { token: string; lobby: LobbyInfo }
		this._token = data.token
		this._lobbyCode = data.lobby.code
		return data.lobby
	}

	async joinLobby(code: string): Promise<LobbyInfo> {
		const res = await this.http('POST', `/api/lobbies/${code}/join`)
		if (!res.ok) throw new Error(`joinLobby failed: ${res.status} ${await res.text()}`)
		const data = (await res.json()) as { token: string; lobby: LobbyInfo }
		this._token = data.token
		this._lobbyCode = code
		return data.lobby
	}

	async leaveLobby(): Promise<void> {
		if (!this._lobbyCode) return
		const res = await this.http('POST', `/api/lobbies/${this._lobbyCode}/leave`)
		if (!res.ok && res.status !== 404) {
			throw new Error(`leaveLobby failed: ${res.status}`)
		}
		this._lobbyCode = null
	}

	async setMetadata(code: string, metadata: Record<string, unknown>): Promise<Record<string, unknown>> {
		const res = await this.http('PUT', `/api/lobbies/${code}/metadata`, { metadata })
		if (!res.ok) throw new Error(`setMetadata failed: ${res.status} ${await res.text()}`)
		const data = (await res.json()) as { metadata: Record<string, unknown> }
		return data.metadata
	}

	async queue(
		modId: string,
		gameMode: string,
		opts: { minPlayers?: number; maxPlayers?: number } = {},
	): Promise<{ position: number }> {
		const { minPlayers = 2, maxPlayers = 2 } = opts
		const res = await this.http('POST', '/api/matchmaking/queue', {
			modId,
			gameMode,
			minPlayers,
			maxPlayers,
		})
		if (!res.ok) throw new Error(`queue failed: ${res.status} ${await res.text()}`)
		return res.json() as Promise<{ position: number }>
	}

	async leaveQueue(modId: string, gameMode: string): Promise<void> {
		await this.http('DELETE', '/api/matchmaking/queue', { modId, gameMode })
	}

	async reportMatchResult(
		matchId: string,
		placements: Array<{ playerId: string; place: number; performance?: number }>,
	): Promise<void> {
		const res = await this.http('POST', `/api/matchmaking/matches/${matchId}/result`, { placements })
		if (!res.ok) throw new Error(`reportResult failed: ${res.status} ${await res.text()}`)
	}

	async getRating(modId: string, gameMode: string, season: number) {
		const res = await this.http(
			'GET',
			`/api/matchmaking/ratings?modId=${encodeURIComponent(modId)}&gameMode=${encodeURIComponent(gameMode)}&season=${season}`,
		)
		if (!res.ok) throw new Error(`getRating failed: ${res.status}`)
		return res.json()
	}

	async getLobbyInfo(code: string): Promise<LobbyInfo> {
		const res = await this.http('GET', `/api/lobbies/${code}`)
		if (!res.ok) throw new Error(`getLobbyInfo failed: ${res.status} ${await res.text()}`)
		const data = (await res.json()) as { lobby: LobbyInfo }
		return data.lobby
	}

	async getLeaderboard(modId: string, gameMode: string, season: number) {
		const res = await this.http(
			'GET',
			`/api/matchmaking/leaderboard?modId=${encodeURIComponent(modId)}&gameMode=${encodeURIComponent(gameMode)}&season=${season}`,
		)
		if (!res.ok) throw new Error(`getLeaderboard failed: ${res.status}`)
		return res.json()
	}

	// Simulates a player returning within the grace period.
	// Calls POST /api/auth/dev/reconnect (cancels grace period → publishes player_reconnected),
	// then re-establishes the MQTT connection with the refreshed token.
	async reconnect(): Promise<void> {
		const res = await this.http('POST', '/api/auth/dev/reconnect')
		if (!res.ok) throw new Error(`reconnect failed: ${res.status} ${await res.text()}`)
		const data = (await res.json()) as { token: string }
		this._token = data.token
		await this.connectMqtt()
	}

	async disconnect(): Promise<void> {
		if (this._mqtt) {
			await new Promise<void>((resolve) => this._mqtt!.end(false, {}, resolve))
			this._mqtt = null
		}
	}
}
