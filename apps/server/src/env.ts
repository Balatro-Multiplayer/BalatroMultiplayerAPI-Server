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

const NODE_ENV = optional('NODE_ENV', 'development')
const IS_PRODUCTION = NODE_ENV === 'production'

// Required in production, but falls back to a default outside it so the server can
// boot locally without real Steam credentials (dev/impersonation auth bypasses
// Steam ticket validation anyway).
function requiredInProduction(key: string, defaultValue: string): string {
	if (IS_PRODUCTION) return required(key)
	return optional(key, defaultValue)
}

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
		'https://new.balatromp.com/api/auth/discord/callback',
	),

	EMQX_BROKER_URL: optional('EMQX_BROKER_URL', 'mqtt://emqx:1883'),
	EMQX_API_URL: optional('EMQX_API_URL', 'http://emqx:18083/api/v5'),
	EMQX_SYSTEM_CLIENT_ID: optional('EMQX_SYSTEM_CLIENT_ID', 'bmp-api-server'),
	EMQX_SYSTEM_USERNAME: optional('EMQX_SYSTEM_USERNAME', 'bmp-system'),
	EMQX_SYSTEM_PASSWORD: required('EMQX_SYSTEM_PASSWORD'),

	PLAYER_ID_SALT: required('PLAYER_ID_SALT'),

	ADMIN_SECRET: required('ADMIN_SECRET'),

	WEB_BASE_URL: optional('WEB_BASE_URL', 'https://new.balatromp.com'),

	// When true, only players holding the 'tester' privilege may create lobbies or
	// queue for matches. Everyone else is rejected. Off by default.
	TESTING_MODE: optionalBool('TESTING_MODE', false),

	// Dev-only escape hatch for local Ranked testing without a real BET launcher
	// (e.g. ClaudeControl-driven clients, which can never answer the launcher-
	// integrity HMAC challenge -- see launcher-integrity.service.ts). When true,
	// every player is marked launcher-verified on connect and never issued a
	// challenge at all, rather than needing to actually pass one. Forced off
	// outside development regardless of the raw env value, so a stray .env
	// setting can never enable this in production.
	DEV_AUTO_VERIFY_LAUNCHER:
		!IS_PRODUCTION && optionalBool('DEV_AUTO_VERIFY_LAUNCHER', false),

	// On/off switch for the hourly mod-registry sync (features/mods/mods-sync.service.ts,
	// which fetches skyline69/balatro-mod-index directly -- see
	// upstream-mod-index.service.ts). Off by default so local dev/tests don't
	// need network access to GitHub just to boot; mods-sync.service.ts logs
	// and no-ops rather than failing when this is false, matching the
	// "missing optional integration disables the feature, not the server"
	// pattern used elsewhere in this file.
	MOD_INDEX_SYNC_ENABLED: optionalBool('MOD_INDEX_SYNC_ENABLED', false),

	// Independent on/off switch for the Thunderstore half of the mod-registry
	// sync (features/mods/thunderstore-mod-index.service.ts, which fetches
	// https://thunderstore.io/c/balatro/api/v1/package/ directly -- no auth,
	// no token). Off by default, same "local dev/tests need no network
	// access" reasoning as MOD_INDEX_SYNC_ENABLED above. Turning this off is
	// treated as a real, intentional "there are zero Thunderstore mods now"
	// result (not a fetch failure), so previously-synced Thunderstore-sourced
	// mod_registry rows ARE pruned on the next sync after disabling it -- see
	// mod-index-merge.ts's ThunderstoreOutcome.ok vs. this flag's own
	// early-return shape in mods-sync.service.ts's runSync().
	THUNDERSTORE_SYNC_ENABLED: optionalBool('THUNDERSTORE_SYNC_ENABLED', false),

	// Optional for custom-mod-version-check.service.ts's calls against the
	// *public* skyline69/balatro-mod-index repo (rate-limit headroom only,
	// unauthenticated GitHub REST already allows 60 req/hr) -- but
	// effectively REQUIRED for features/launcher-releases/launcher-github-releases.service.ts,
	// which reads Releases from the *private* Balatro-Multiplayer/new-launcher
	// repo and needs a token with repo (classic) or Contents:Read
	// (fine-grained) access to that specific repo, or every launcher-release
	// admin action and every public download fails with a clear 500. Kept as
	// one shared optional() rather than two separately-required vars since
	// the mods feature must keep working even before this token exists.
	GITHUB_TOKEN: optional('GITHUB_TOKEN', ''),

	// Directory containing archived Discord channel bundles (features/webadmin/
	// archives.route.ts), each produced externally by the discord-channel-archiver
	// bot and manually copied onto the server -- this app never writes here, only
	// reads. Defaults to a relative path for local dev; the deployed container
	// mounts a real host directory here read-only (see docker-compose.yml's
	// api-blue volumes:).
	ARCHIVE_DIR: optional('ARCHIVE_DIR', './archives'),
} as const
