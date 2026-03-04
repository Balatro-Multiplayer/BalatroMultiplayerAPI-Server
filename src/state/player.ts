import { randomUUID } from 'node:crypto'

export class PlayerSession {
	public readonly playerId: string
	public username: string
	public steamId?: string
	public discordId?: string
	public discordUsername?: string
	public useDiscordName: boolean
	public preferredJoker: string
	public lobbyCode?: string
	public readonly connectedAt: Date

	constructor(
		username: string,
		opts?: {
			id?: string
			steamId?: string
			discordId?: string
			discordUsername?: string
			useDiscordName?: boolean
			preferredJoker?: string
		},
	) {
		this.playerId = opts?.id ?? randomUUID()
		this.username = username
		this.steamId = opts?.steamId
		this.discordId = opts?.discordId
		this.discordUsername = opts?.discordUsername
		this.useDiscordName = opts?.useDiscordName ?? false
		this.preferredJoker = opts?.preferredJoker ?? 'j_joker'
		this.connectedAt = new Date()
	}

	getDisplayName(): string {
		if (this.useDiscordName && this.discordUsername) {
			return this.discordUsername
		}
		return this.username
	}
}
