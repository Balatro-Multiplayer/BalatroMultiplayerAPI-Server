export interface JwtPayload {
	playerId: string
	steamName: string
	displayName?: string
	useDiscordName?: boolean
	preferredJoker?: string | null
	discordIdHash?: string | null
	discordUsername?: string | null
	lobbyCode?: string
	isTemp?: boolean
	purpose?: string
}

export interface LobbyEvent {
	type:
		| 'player_joined'
		| 'player_left'
		| 'player_kicked'
		| 'lobby_closed'
		| 'host_changed'
		| 'metadata_changed'
		| 'player_disconnected'
		| 'player_reconnected'
	lobbyCode: string
	playerId?: string
	displayName?: string
	data?: Record<string, unknown>
	timestamp: string
}

export interface SoloQueueEntry {
	type: 'solo'
	playerId: string
	modId: string
	gameMode: string
	minPlayers: number
	maxPlayers: number
	rating: number
	queuedAt: Date
}

export interface GroupQueueEntry {
	type: 'group'
	lobbyCode: string
	hostPlayerId: string
	playerIds: string[]
	modId: string
	gameMode: string
	minPlayers: number
	maxPlayers: number
	avgRating: number
	queuedAt: Date
}

export type QueueEntry = SoloQueueEntry | GroupQueueEntry

export interface Match {
	matchId: string
	lobbyCode: string
	modId: string
	gameMode: string
	playerIds: string[]
	createdAt: Date
	// Set when the host signals the run has begun; basis for server-measured timing.
	gameStartedAt?: Date
}

export type MatchmakingEvent =
	| {
			type: 'match_found'
			matchId: string
			lobbyCode: string
			modId: string
			gameMode: string
			players: string[]
			timestamp: string
	  }
	| {
			type: 'match_reconnect'
			matchId: string
			lobbyCode: string
			modId: string
			gameMode: string
			timestamp: string
	  }
	| {
			type: 'match_resolved'
			matchId: string
			ratings: Array<{
				playerId: string
				newRating: number | null
				delta: number | null
				gamesPlayed: number
				isPlacement: boolean
			}>
			timestamp: string
	  }
	| {
			// Pushed when a post-queue-join ranked_readiness challenge (see
			// ChallengeKind below) is refused, fails, or comes back reporting
			// the launcher and/or its Ranked-legal mods aren't current - the
			// server has already dequeued the player by the time this
			// arrives. 'launcher_outdated' takes priority over
			// 'mods_outdated' when both are true, since updating BET also
			// resolves stale mods on the next launch.
			type: 'queue_cancelled'
			modId: string
			gameMode: string
			reason: 'launcher_outdated' | 'mods_outdated'
	  }

export interface QueueOpts {
	modId: string
	gameMode: string
	minPlayers: number
	maxPlayers: number
}

export interface PlacementEntry {
	playerId: string
	place: number
	teamId?: string
	performance?: number
	// Optional secondary metric for this player (e.g. PvP final score). Interpreted per the
	// mod's metrics.config entry; ignored for server-measured boards (e.g. speedrun time).
	metric?: number
}

export type Privilege = 'admin' | 'moderator' | 'tester' | (string & {})
export type BanType = 'chat' | 'queue' | 'account'
// 'voided' means a resolved match's rating effect has been reversed (e.g. it
// was wrongly auto-forfeited by a reconnect race, see void-match.ts) --
// resultPlacements/resultReportedBy/resultReportedAt are left intact as a
// historical record of what was originally reported, only the status (and
// the ratings it fed into) change.
export type MatchStatus = 'active' | 'resolved' | 'voided'
export type ReportType = 'cheating' | 'chat_abuse' | 'griefing' | 'inappropriate_username' | 'other'
export type ReportStatus = 'open' | 'resolved'

// --- Launcher integrity challenge/response (see registerPrivate below) ---

// 'ranked_readiness' is issued right after a Ranked queue join (see
// matchmaking.service.ts::joinQueue), not at connect time or on the
// periodic interval like the other two - it answers "is the launcher and
// every active Ranked-legal mod still current *right now*", forcing a
// fresh check on the launcher side rather than trusting anything cached
// from earlier in the session. See RANKED_READINESS_SPEC.md in
// features/launcher-integrity/ for its response shape, which differs
// from login/periodic's (a signed {launcherCurrent, modsCurrent}
// verdict, not a bare signature).
export type ChallengeKind = 'login' | 'periodic' | 'ranked_readiness'

export interface ChallengeIssuance {
	nonce: string
	// Free-form hint for which algorithm/version issued this challenge -- opaque
	// to the public server, meaningful only to the private ChallengeStrategy
	// implementation and whatever launcher build answers it.
	algorithm?: string
	expiresAt: string
}

// Implemented only by the private bet-launcher-integrity-private package,
// injected via registerPrivate's RegisterPrivateDeps.setChallengeStrategy. The
// public server never embeds real verification logic -- see
// apps/server/src/features/launcher-integrity/launcher-integrity.service.ts.
export interface ChallengeStrategy {
	issue(playerId: string, kind: ChallengeKind): Promise<ChallengeIssuance>
	verify(
		playerId: string,
		issuance: ChallengeIssuance,
		response: unknown,
	): Promise<boolean>
}

export interface RegisterPrivateDeps {
	setChallengeStrategy: (strategy: ChallengeStrategy) => void
}

export type LauncherIntegrityFailureReason =
	| 'wrong_response'
	| 'timeout'
	| 'refused'
