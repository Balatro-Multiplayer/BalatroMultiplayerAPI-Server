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

export const env = {
	PORT: Number(optional('PORT', '8788')),
	NODE_ENV: optional('NODE_ENV', 'development'),

	DATABASE_URL: required('DATABASE_URL'),

	JWT_SECRET: required('JWT_SECRET'),
	JWT_EXPIRES_IN: optional('JWT_EXPIRES_IN', '24h'),

	STEAM_WEB_API_KEY: required('STEAM_WEB_API_KEY'),
	STEAM_APP_ID: optional('STEAM_APP_ID', '2379780'),

	DISCORD_CLIENT_ID: optional('DISCORD_CLIENT_ID', ''),
	DISCORD_CLIENT_SECRET: optional('DISCORD_CLIENT_SECRET', ''),
	DISCORD_REDIRECT_URI: optional(
		'DISCORD_REDIRECT_URI',
		'http://localhost:8788/api/auth/discord/callback',
	),

	EMQX_BROKER_URL: optional('EMQX_BROKER_URL', 'mqtt://emqx:1883'),
	EMQX_SYSTEM_CLIENT_ID: optional('EMQX_SYSTEM_CLIENT_ID', 'bmp-api-server'),
	EMQX_SYSTEM_USERNAME: optional('EMQX_SYSTEM_USERNAME', 'bmp-system'),
	EMQX_SYSTEM_PASSWORD: required('EMQX_SYSTEM_PASSWORD'),
} as const
