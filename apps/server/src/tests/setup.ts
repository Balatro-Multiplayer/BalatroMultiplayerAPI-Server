import { beforeEach, vi } from 'vitest'
import { setConfig } from '../state/config.js'

// Set required env vars before any module imports
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET = 'test-jwt-secret'
process.env.STEAM_WEB_API_KEY = 'test-steam-key'
process.env.EMQX_SYSTEM_PASSWORD = 'test-emqx-password'
process.env.PLAYER_ID_SALT = 'test-player-id-salt'
process.env.ADMIN_SECRET = 'test-admin-secret'

// Mock the MQTT service globally — no real broker in tests
vi.mock('../services/mqtt.service.js', () => ({
	mqttService: {
		connect: vi.fn().mockResolvedValue(undefined),
		publishEvent: vi.fn().mockResolvedValue(undefined),
		publishMetadata: vi.fn().mockResolvedValue(undefined),
		publishPlayerInfo: vi.fn().mockResolvedValue(undefined),
		publishChatMessage: vi.fn().mockResolvedValue(undefined),
		publishToPlayer: vi.fn().mockResolvedValue(undefined),
		clearPlayerInfo: vi.fn().mockResolvedValue(undefined),
		cleanupLobbyTopics: vi.fn().mockResolvedValue(undefined),
		cleanupPlayerState: vi.fn().mockResolvedValue(undefined),
		disconnect: vi.fn().mockResolvedValue(undefined),
	},
}))

// Mock the refresh-token service — no real DB in tests
vi.mock('../services/refresh-token.service.js', () => ({
	issueRefreshToken: vi.fn().mockResolvedValue('mock-refresh-token'),
	redeemRefreshToken: vi.fn().mockResolvedValue(null),
	revokeAllTokens: vi.fn().mockResolvedValue(undefined),
	cleanupExpiredTokens: vi.fn().mockResolvedValue(0),
}))

// Mock the database — no real PostgreSQL in tests
vi.mock('../db/index.js', () => ({
	db: {
		insert: vi.fn().mockReturnValue({
			values: vi.fn().mockResolvedValue(undefined),
		}),
		update: vi.fn().mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockResolvedValue(undefined),
			}),
		}),
	},
	pool: {
		end: vi.fn().mockResolvedValue(undefined),
	},
}))

const mockPlayerRecord = {
	id: 'mock-id',
	steamIdHash: null,
	discordIdHash: null,
	discordUsername: null,
	useDiscordName: false,
	preferredJoker: 'j_joker',
	privileges: [] as string[],
	steamName: 'mock',
	chatEnabled: false,
	chatBlocked: false,
	tosAcceptedVersion: 0,
}

// Mock player.service — no real DB calls in tests
vi.mock('../services/player.service.js', () => ({
	findPlayerBySteamIdHash: vi.fn().mockResolvedValue(null),
	findPlayerByDiscordIdHash: vi.fn().mockResolvedValue(null),
	findPlayerById: vi.fn().mockResolvedValue(null),
	findPlayerBySteamName: vi.fn().mockResolvedValue(null),
	createPlayer: vi.fn().mockResolvedValue(mockPlayerRecord),
	linkSteam: vi.fn().mockResolvedValue(undefined),
	linkDiscord: vi.fn().mockResolvedValue(undefined),
	unlinkDiscord: vi.fn().mockResolvedValue(undefined),
	updateSteamName: vi.fn().mockResolvedValue(undefined),
	updateDiscordUsername: vi.fn().mockResolvedValue(undefined),
	updateUseDiscordName: vi.fn().mockResolvedValue(undefined),
	updatePreferredJoker: vi.fn().mockResolvedValue(undefined),
	updateTosAcceptedVersion: vi.fn().mockResolvedValue(undefined),
	updateChatStatus: vi.fn().mockResolvedValue(undefined),
}))

// Reset in-memory state between tests
beforeEach(async () => {
	const state = await import('../state/index.js')
	state.lobbies.clear()
	state.sessions.clear()
	state.steamIndex.clear()
	state.discordIndex.clear()
	state.stopSessionCleanup()

	const mm = await import('../state/matchmaking.js')
	mm.queues.clear()
	mm.playerQueues.clear()
	mm.matches.clear()
	mm.matchByLobby.clear()

	// Clear CSRF link state nonces
	const authService = await import('../services/auth.service.js')
	authService.linkStateNonces.clear()

	// Clear grace periods
	const gracePeriod = await import('../services/grace-period.service.js')
	gracePeriod.clearAllGracePeriods()

	// Reset server config — tosVersion 0 disables TOS gating in tests
	setConfig({ tosVersion: 0, mods: [], chatAllowlist: new Set() })

	vi.clearAllMocks()

	// Re-apply playerDb mock implementations (vi.restoreAllMocks in tests may reset them)
	const playerDb = await import('../services/player.service.js')
	vi.mocked(playerDb.findPlayerBySteamIdHash).mockResolvedValue(null)
	vi.mocked(playerDb.findPlayerByDiscordIdHash).mockResolvedValue(null)
	vi.mocked(playerDb.findPlayerById).mockResolvedValue(null)
	vi.mocked(playerDb.createPlayer).mockResolvedValue(mockPlayerRecord)
	vi.mocked(playerDb.linkSteam).mockResolvedValue(undefined)
	vi.mocked(playerDb.linkDiscord).mockResolvedValue(undefined)
	vi.mocked(playerDb.unlinkDiscord).mockResolvedValue(undefined)
	vi.mocked(playerDb.updateSteamName).mockResolvedValue(undefined)
	vi.mocked(playerDb.updateDiscordUsername).mockResolvedValue(undefined)
	vi.mocked(playerDb.updateUseDiscordName).mockResolvedValue(undefined)
	vi.mocked(playerDb.updatePreferredJoker).mockResolvedValue(undefined)
})
