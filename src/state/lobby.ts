import { AppError } from '../utils/errors.js'
import type { PlayerSession } from './player.js'

export class Lobby {
	public readonly players = new Map<string, PlayerSession>()
	public metadata: Record<string, unknown> = {}
	public readonly createdAt: Date

	constructor(
		public readonly code: string,
		public readonly modId: string,
		public hostId: string,
		public readonly maxPlayers: number = 16,
	) {
		this.createdAt = new Date()
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
