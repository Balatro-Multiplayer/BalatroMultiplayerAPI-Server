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

// A bad URL and a missing bearer token both present as a silent, total chat
// outage (every call throws, or every call gets a 401) with no signal beyond
// a console.error per message. Called once at boot so misconfiguration is a
// startup failure/warning instead of a mystery discovered in production chat.
export function assertValidModerationConfig(
	url: string,
	bearerToken: string,
	isProduction: boolean = IS_PRODUCTION,
): void {
	if (!url) {
		console.info('[env] chat moderation bridge is OFF (no service URL set)')
		return
	}

	// Warn rather than throw: a bad URL here would otherwise take down lobbies,
	// matchmaking and games over a chat setting. Chat still fails closed, which
	// is the outcome we want anyway.
	let parsed: URL | null = null
	try {
		parsed = new URL(url)
	} catch {
		console.error(
			`[env] MODERATION_SERVICE_URL is not a valid URL ('${url}') - chat will fail closed on every message until this is fixed`,
		)
		return
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		console.error(
			`[env] MODERATION_SERVICE_URL must use http or https ('${url}') - chat will fail closed on every message until this is fixed`,
		)
		return
	}
	console.info(`[env] chat moderation bridge is ON (${parsed.origin})`)
	if (!bearerToken) {
		console.warn(
			'[env] MODERATION_BEARER_TOKEN is empty while MODERATION_SERVICE_URL is set - the moderation service may reject every request with 401',
		)
	}
	// The bearer token crosses the wire on every call. A warning, not a hard
	// failure — plaintext http may be intentional (e.g. a same-host/VPN-only
	// service), so this flags the risk without blocking startup.
	if (parsed.protocol === 'http:' && isProduction) {
		console.warn(
			`[env] MODERATION_SERVICE_URL uses plaintext http in production ('${url}') - the bearer token crosses the wire unencrypted`,
		)
	}
}
