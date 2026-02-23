import { beforeEach, vi } from 'vitest'

// Set required env vars before any module imports
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test'
process.env.JWT_SECRET = 'test-jwt-secret'
process.env.STEAM_WEB_API_KEY = 'test-steam-key'
process.env.EMQX_SYSTEM_PASSWORD = 'test-emqx-password'

// Mock the MQTT service globally — no real broker in tests
vi.mock('../services/mqtt.service.js', () => ({
	mqttService: {
		connect: vi.fn().mockResolvedValue(undefined),
		publishEvent: vi.fn().mockResolvedValue(undefined),
		publishMetadata: vi.fn().mockResolvedValue(undefined),
		publishToPlayer: vi.fn().mockResolvedValue(undefined),
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
	},
	pool: {
		end: vi.fn().mockResolvedValue(undefined),
	},
}))

// Mock player.service — no real DB calls in tests
vi.mock('../services/player.service.js', () => ({
	findPlayerBySteamId: vi.fn().mockResolvedValue(null),
	findPlayerByDiscordId: vi.fn().mockResolvedValue(null),
	findPlayerById: vi.fn().mockResolvedValue(null),
	createPlayer: vi.fn().mockResolvedValue({
		id: 'mock-id',
		steamId: null,
		discordId: null,
		username: 'mock',
	}),
	linkSteam: vi.fn().mockResolvedValue(undefined),
	linkDiscord: vi.fn().mockResolvedValue(undefined),
	updateUsername: vi.fn().mockResolvedValue(undefined),
}))

// Reset in-memory state between tests
beforeEach(async () => {
	const state = await import('../state/index.js')
	state.lobbies.clear()
	state.sessions.clear()
	state.steamIndex.clear()
	state.discordIndex.clear()
	state.stopSessionCleanup()

	// Clear chat rate limiter
	const emqxAuth = await import('../services/emqx-auth.service.js')
	emqxAuth.chatTimestamps.clear()

	// Clear CSRF link state nonces
	const authService = await import('../services/auth.service.js')
	authService.linkStateNonces.clear()

	vi.clearAllMocks()

	// Re-apply playerDb mock implementations (vi.restoreAllMocks in tests may reset them)
	const playerDb = await import('../services/player.service.js')
	vi.mocked(playerDb.findPlayerBySteamId).mockResolvedValue(null)
	vi.mocked(playerDb.findPlayerByDiscordId).mockResolvedValue(null)
	vi.mocked(playerDb.findPlayerById).mockResolvedValue(null)
	vi.mocked(playerDb.createPlayer).mockResolvedValue({
		id: 'mock-id',
		steamId: null,
		discordId: null,
		username: 'mock',
	})
	vi.mocked(playerDb.linkSteam).mockResolvedValue(undefined)
	vi.mocked(playerDb.linkDiscord).mockResolvedValue(undefined)
	vi.mocked(playerDb.updateUsername).mockResolvedValue(undefined)
})
