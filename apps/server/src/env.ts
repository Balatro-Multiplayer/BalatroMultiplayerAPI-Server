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

	// When false, the server rejects all chat sends with an error. Off for now.
	CHAT_ENABLED: optionalBool('CHAT_ENABLED', false),

	// When true, only players holding the 'tester' privilege may create lobbies or
	// queue for matches. Everyone else is rejected. Off by default.
	TESTING_MODE: optionalBool('TESTING_MODE', false),

	// Moderation service bridge. Unset URL = legacy local pipeline (obscenity);
	// set it to route free-form chat through the external moderation service.
	// Outage policy: 'off' (chat 503s) or 'presets' (allowlist-only) when the
	// service is unreachable — free-form never proceeds unmoderated.
	MODERATION_SERVICE_URL: optional('MODERATION_SERVICE_URL', ''),
	MODERATION_BEARER_TOKEN: optional('MODERATION_BEARER_TOKEN', ''),
	MODERATION_TIMEOUT_MS: Number(optional('MODERATION_TIMEOUT_MS', '1500')),
	MODERATION_OUTAGE_POLICY: optional('MODERATION_OUTAGE_POLICY', 'off'),
} as const
