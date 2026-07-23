import { randomUUID } from 'node:crypto'
import type { Privilege } from '../shared/types/index.js'

export class PlayerSession {
	public readonly playerId: string
	public steamName: string
	public steamIdHash?: string
	public discordIdHash?: string
	public discordUsername?: string
	public useDiscordName: boolean
	public preferredJoker: string
	public privileges: Privilege[]
	public tosAcceptedVersion: number
	public lobbyCode?: string
	public readonly connectedAt: Date

	public chatEnabled: boolean
	public chatBlocked: boolean
	public mutedPlayerIds: string[]

	constructor(
		steamName: string,
		opts?: {
			id?: string
			steamIdHash?: string
			discordIdHash?: string
			discordUsername?: string
			useDiscordName?: boolean
			preferredJoker?: string
			privileges?: Privilege[]
			tosAcceptedVersion?: number
			chatEnabled?: boolean
			chatBlocked?: boolean
			mutedPlayerIds?: string[]
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
		this.chatEnabled = opts?.chatEnabled ?? false
		this.chatBlocked = opts?.chatBlocked ?? false
		this.mutedPlayerIds = opts?.mutedPlayerIds ?? []
		this.connectedAt = new Date()
	}

	getDisplayName(): string {
		if (this.useDiscordName && this.discordUsername) {
			return this.discordUsername
		}
		return this.steamName
	}
}
