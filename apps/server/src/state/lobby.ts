import { randomUUID } from 'node:crypto'
import { AppError } from '../shared/utils/errors.js'
import type { PlayerSession } from './player.js'

export type BufferedMessage = {
	playerId: string
	displayName: string
	message: string
	sentAt: Date
}

const MESSAGE_BUFFER_MAX = 100

export class Lobby {
	public readonly id: string = randomUUID()
	public readonly players = new Map<string, PlayerSession>()
	public metadata: Record<string, unknown> = {}
	public readonly createdAt: Date
	public readonly messageBuffer: BufferedMessage[] = []
	public isReported: boolean = false

	constructor(
		public readonly code: string,
		public readonly modId: string,
		public hostId: string,
		public readonly maxPlayers: number = 16,
		public readonly type: 'public' | 'private' = 'private',
	) {
		this.createdAt = new Date()
	}

	bufferMessage(entry: BufferedMessage): void {
		if (this.messageBuffer.length >= MESSAGE_BUFFER_MAX) {
			this.messageBuffer.shift()
		}
		this.messageBuffer.push(entry)
	}

	get isFull(): boolean {
		return this.players.size >= this.maxPlayers
	}

	addPlayer(session: PlayerSession): void {
		if (this.isFull) {
			throw new AppError('Lobby is full', 409)
		}
		this.players.set(session.playerId, session)
		session.lobbyCode = this.code
	}

	removePlayer(playerId: string): void {
		const session = this.players.get(playerId)
		if (session) {
			session.lobbyCode = undefined
		}
		this.players.delete(playerId)
	}

	hasPlayer(playerId: string): boolean {
		return this.players.has(playerId)
	}

	get playerCount(): number {
		return this.players.size
	}

	get isEmpty(): boolean {
		return this.players.size === 0
	}

	toJSON() {
		return {
			code: this.code,
			modId: this.modId,
			hostId: this.hostId,
			maxPlayers: this.maxPlayers,
			metadata: this.metadata,
			players: Array.from(this.players.values()).map((p) => ({
				id: p.playerId,
				displayName: p.getDisplayName(),
				preferredJoker: p.preferredJoker,
			})),
		}
	}
}
