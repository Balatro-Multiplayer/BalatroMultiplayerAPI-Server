export type {
	JwtPayload,
	LobbyEvent,
	SoloQueueEntry,
	GroupQueueEntry,
	QueueEntry,
	Match,
	MatchmakingEvent,
	QueueOpts,
	PlacementEntry,
	Privilege,
	BanType,
	MatchStatus,
} from '@bmp/types'

export type LobbyType = 'public' | 'private'

export interface StoredLobbyState {
	hostId: string
	metadata: Record<string, unknown>
	maxPlayers: number
	playerInfos: Record<string, { displayName: string; preferredJoker: string }>
}

export interface SteamAuthResponse {
	response: {
		params: {
			result: 'OK' | string
			steamid: string
			ownersteamid: string
			vacbanned: boolean
			publisherbanned: boolean
		}
	}
}

export interface DiscordTokenResponse {
	access_token: string
	token_type: string
	expires_in: number
	refresh_token: string
	scope: string
}

export interface DiscordUser {
	id: string
	username: string
	discriminator: string
	global_name: string | null
	avatar: string | null
}

export interface EmqxAuthRequest {
	clientid: string
	username: string
	password: string
	peerhost: string
}

export interface EmqxAuthzRequest {
	clientid: string
	username: string
	topic: string
	action: 'publish' | 'subscribe'
	peerhost: string
}

export interface CreateLobbyBody {
	modId: string
}

export interface SetMetadataBody {
	metadata: Record<string, unknown>
}
