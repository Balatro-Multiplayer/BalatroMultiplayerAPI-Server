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

	// When false, the server rejects all chat sends with an error. Off for now.
	CHAT_ENABLED: optionalBool('CHAT_ENABLED', false),

	// When true, only players holding the 'tester' privilege may create lobbies or
	// queue for matches. Everyone else is rejected. Off by default.
	TESTING_MODE: optionalBool('TESTING_MODE', false),

	// Raw-HTTPS URL to BETModIndex's built dist/mods-index.json (the fork's
	// build-index.yml output, combining upstream skyline69/balatro-mod-index
	// with our bet-overrides/ overlay -- see that repo's README). Left blank
	// until the fork exists; mods-sync.service.ts logs and no-ops rather than
	// failing when unset, matching the "missing optional integration disables
	// the feature, not the server" pattern used elsewhere in this file.
	BET_MOD_INDEX_URL: optional('BET_MOD_INDEX_URL', ''),
	// Chat moderation bridge. Unset (default) means dormant — chat keeps using the
	// local obscenity filter, unchanged. Set MODERATION_SERVICE_URL to route chat
	// through an external moderation service instead.
	MODERATION_SERVICE_URL: optional('MODERATION_SERVICE_URL', '').replace(
		/\/+$/,
		'',
	),
	MODERATION_BEARER_TOKEN: optional('MODERATION_BEARER_TOKEN', ''),
	// Must exceed the moderation service's own judgement deadline plus margin.
	// Set below it and a slow-but-successful verdict is abandoned here while it
	// still occupies the service's single model lane, so the player sees an
	// outage and their retry deepens the backlog that caused it.
	MODERATION_TIMEOUT_MS: optionalPositiveInt('MODERATION_TIMEOUT_MS', 6000),
} as const
