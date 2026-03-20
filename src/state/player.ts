import { randomUUID } from 'node:crypto'

export class PlayerSession {
	public readonly playerId: string
	public steamName: string
	public steamIdHash?: string
	public discordIdHash?: string
	public discordUsername?: string
	public useDiscordName: boolean
	public preferredJoker: string
	public privileges: string[]
	public tosAcceptedVersion: number
	public lobbyCode?: string
	public readonly connectedAt: Date

	constructor(
		steamName: string,
		opts?: {
			id?: string
			steamIdHash?: string
			discordIdHash?: string
			discordUsername?: string
			useDiscordName?: boolean
			preferredJoker?: string
			privileges?: string[]
			tosAcceptedVersion?: number
		},
	) {
		this.playerId = opts?.id ?? randomUUID()
		this.steamName = steamName
		this.steamIdHash = opts?.steamIdHash
		this.discordIdHash = opts?.discordIdHash
		this.discordUsername = opts?.discordUsername
		this.useDiscordName = opts?.useDiscordName ?? false
		this.preferredJoker = opts?.preferredJoker ?? 'j_joker'
		this.privileges = opts?.privileges ?? []
		this.tosAcceptedVersion = opts?.tosAcceptedVersion ?? 0
		this.connectedAt = new Date()
	}

	getDisplayName(): string {
		if (this.useDiscordName && this.discordUsername) {
			return this.discordUsername
		}
		return this.steamName
	}
}
