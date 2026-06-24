import { env } from '../../env.js'
import type { DiscordTokenResponse, DiscordUser } from '../../shared/types/index.js'
import { err, ok } from '../../shared/utils/result.js'
import type { Result } from '../../shared/utils/result.js'

export function getDiscordAuthUrl(state?: string): string {
	const params = new URLSearchParams({
		client_id: env.DISCORD_CLIENT_ID,
		redirect_uri: env.DISCORD_REDIRECT_URI,
		response_type: 'code',
		scope: 'identify',
	})
	if (state) params.set('state', state)
	return `https://discord.com/api/oauth2/authorize?${params.toString()}`
}

async function exchangeDiscordCodeForToken(
	code: string,
): Promise<DiscordTokenResponse | null> {
	const res = await fetch('https://discord.com/api/oauth2/token', {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: env.DISCORD_CLIENT_ID,
			client_secret: env.DISCORD_CLIENT_SECRET,
			grant_type: 'authorization_code',
			code,
			redirect_uri: env.DISCORD_REDIRECT_URI,
		}),
	})
	if (!res.ok) return null
	return (await res.json()) as DiscordTokenResponse
}

async function fetchDiscordUser(accessToken: string): Promise<DiscordUser | null> {
	const res = await fetch('https://discord.com/api/users/@me', {
		headers: { Authorization: `Bearer ${accessToken}` },
	})
	if (!res.ok) return null
	return (await res.json()) as DiscordUser
}

function pickDiscordDisplayName(user: DiscordUser): string {
	return user.global_name ?? user.username
}

export type DiscordAuthError = 'token_exchange_failed' | 'user_fetch_failed'

export async function validateDiscordCode(
	code: string,
): Promise<Result<{ discordId: string; discordName: string }, DiscordAuthError>> {
	const tokenData = await exchangeDiscordCodeForToken(code)
	if (!tokenData) return err('token_exchange_failed')
	const user = await fetchDiscordUser(tokenData.access_token)
	if (!user) return err('user_fetch_failed')
	return ok({ discordId: user.id, discordName: pickDiscordDisplayName(user) })
}
