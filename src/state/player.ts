import { randomUUID } from 'node:crypto'

export class PlayerSession {
	public readonly playerId: string
	public username: string
	public steamId?: string
	public discordId?: string
	public lobbyCode?: string
	public readonly connectedAt: Date

	constructor(
		username: string,
		opts?: { id?: string; steamId?: string; discordId?: string },
	) {
		this.playerId = opts?.id ?? randomUUID()
		this.username = username
		this.steamId = opts?.steamId
		this.discordId = opts?.discordId
		this.connectedAt = new Date()
	}
}
