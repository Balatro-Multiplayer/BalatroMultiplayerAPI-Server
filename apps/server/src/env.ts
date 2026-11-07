import { serverKindErrorMessage, serverSettings } from '@bmp/types'

function required(key: string): string {
	const value = process.env[key]
	if (!value) {
		throw new Error(`Missing required environment variable: ${key}`)
	}
	return value
}

function optional(key: string, defaultValue: string): string {
	return process.env[key] ?? defaultValue
}

function optionalBool(key: string, defaultValue: boolean): boolean {
	const value = process.env[key]
	if (value === undefined) return defaultValue
	return value === 'true' || value === '1'
}

// Guards '' -> 0 and non-numeric input -> NaN, either of which would make
// every request abort immediately if used as a timeout unchecked.
function optionalPositiveInt(key: string, defaultValue: number): number {
	const value = process.env[key]
	if (!value) return defaultValue
	const parsed = Number(value)
	return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue
}

const NODE_ENV = optional('NODE_ENV', 'development')
const IS_PRODUCTION = NODE_ENV === 'production'

// Required in production, but falls back to a default outside it so the server can
// boot locally without real Steam credentials (dev/impersonation auth bypasses
// Steam ticket validation anyway).
function requiredInProduction(key: string, defaultValue: string): string {
	if (IS_PRODUCTION) return required(key)
	return optional(key, defaultValue)
}

const SERVER = (() => {
	const result = serverSettings(process.env)
	if (!result.ok) throw new Error(`Refusing to start: ${serverKindErrorMessage(result.error)}`)
	return result.value
})()

export const env = {
	PORT: Number(optional('PORT', '8788')),
	NODE_ENV,

	DATABASE_URL: required('DATABASE_URL'),

	JWT_SECRET: required('JWT_SECRET'),
	JWT_EXPIRES_IN: optional('JWT_EXPIRES_IN', '24h'),

	STEAM_WEB_API_KEY: requiredInProduction('STEAM_WEB_API_KEY', ''),
	STEAM_APP_ID: optional('STEAM_APP_ID', '2379780'),

	DISCORD_CLIENT_ID: optional('DISCORD_CLIENT_ID', ''),
	DISCORD_CLIENT_SECRET: optional('DISCORD_CLIENT_SECRET', ''),
	DISCORD_REDIRECT_URI: optional(
		'DISCORD_REDIRECT_URI',
		'https://balatromp.com/api/auth/discord/callback',
	),

	PLAYER_ID_SALT: required('PLAYER_ID_SALT'),

	ADMIN_SECRET: required('ADMIN_SECRET'),

	WEB_BASE_URL: optional('WEB_BASE_URL', 'https://balatromp.com'),

	// When true, only players holding the 'tester' privilege may create lobbies or
	// queue for matches. Everyone else is rejected. Off by default.
	TESTING_MODE: optionalBool('TESTING_MODE', false),

	// The server kind (packages/types/src/server-kind.ts). Startup fails
	// above on the Official server with any dev flag on.
	BMP_SERVER_KIND: SERVER.kind,
	// Whether the website asks players to accept the Notice (only the
	// Official server does, like the game).
	NOTICE_REQUIRED: SERVER.noticeRequired,

	// Dev-only escape hatch for local Ranked testing without a real BET launcher
	// (e.g. ClaudeControl-driven clients, which can never answer the launcher-
	// integrity HMAC challenge -- see launcher-integrity.service.ts). When true,
	// every player is marked launcher-verified on connect and never issued a
	// challenge at all, rather than needing to actually pass one. Only a Dev
	// server (BMP_SERVER_KIND=dev) accepts it.
	DEV_AUTO_VERIFY_LAUNCHER: SERVER.autoVerifyLauncher,
	// Dev-only stand-in for the private launcher-integrity strategy
	// (features/launcher-integrity/dev-strategy.ts), so the challenge round
	// trip runs locally. Only used when no private strategy registered; only
	// a Dev server accepts it.
	DEV_FAKE_LAUNCHER_STRATEGY: SERVER.fakeLauncherStrategy,

	// On/off switch for the hourly mod-registry sync (features/mods/mods-sync.service.ts,
	// which fetches https://thunderstore.io/c/balatro/api/v1/package/ directly
	// -- see thunderstore-mod-index.service.ts -- no auth, no token). Off by
	// default so local dev/tests don't need network access just to boot;
	// mods-sync.service.ts logs and no-ops rather than failing when this is
	// false, matching the "missing optional integration disables the
	// feature, not the server" pattern used elsewhere in this file.
	MOD_INDEX_SYNC_ENABLED: optionalBool('MOD_INDEX_SYNC_ENABLED', false),

	// Effectively REQUIRED for features/launcher-releases/launcher-github-releases.service.ts
	// and features/r2modman-releases/r2modman-github-releases.service.ts, which
	// read Releases from the *private* Balatro-Multiplayer/new-launcher and
	// Balatro-Multiplayer/bmp-r2modman repos respectively and need a token with
	// repo (classic) or Contents:Read (fine-grained) access to those specific
	// repos, or every release admin action and every public download fails
	// with a clear 500. Kept optional() rather than required since other
	// features must keep working even before this token exists.
	GITHUB_TOKEN: optional('GITHUB_TOKEN', ''),

	// Nakama's HTTP API base, e.g. http://nakama:7350 on the compose network.
	// The API mirrors its games into Postgres and drives it through its
	// server-only admin RPCs (features/nakama).
	NAKAMA_URL: required('NAKAMA_URL').replace(/\/+$/, ''),
	// Nakama's runtime.http_key, for those admin RPCs. Unset = dormant.
	NAKAMA_HTTP_KEY: optional('NAKAMA_HTTP_KEY', ''),
	// Nakama's Prometheus endpoint (metrics.prometheus_port in nakama/*.yml),
	// e.g. http://nakama:9100/ on the compose network. The Stats page reads
	// its open-socket gauge as the online player count. Unset = the page
	// shows the count as unknown.
	NAKAMA_METRICS_URL: optional('NAKAMA_METRICS_URL', ''),
	// Shared key Nakama sends (X-BMP-Internal-Key) on /internal/nakama/*.
	// Unset = those routes refuse everything.
	INTERNAL_API_KEY: optional('INTERNAL_API_KEY', ''),
	// The one player id (an admin) allowed to run the owner-only repair tools,
	// such as the Season replay. Unset = nobody is the owner.
	OWNER_PLAYER_ID: optional('OWNER_PLAYER_ID', ''),

	// Directory containing archived Discord channel bundles (features/webadmin/
	// archives.route.ts), each produced externally by the discord-channel-archiver
	// bot and manually copied onto the server -- this app never writes here, only
	// reads. Defaults to a relative path for local dev; the deployed container
	// mounts a real host directory here read-only (see docker-compose.yml's
	// api-blue volumes:).
	ARCHIVE_DIR: optional('ARCHIVE_DIR', './archives'),
} as const
