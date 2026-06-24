import { env } from '../../env.js'
import type { SteamAuthResponse } from '../../shared/types/index.js'
import { err, ok } from '../../shared/utils/result.js'
import type { Result } from '../../shared/utils/result.js'

const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login'
const STEAM_ID_REGEX = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/

export function getSteamOpenIdUrl(returnTo: string): string {
	const params = new URLSearchParams({
		'openid.ns': 'http://specs.openid.net/auth/2.0',
		'openid.mode': 'checkid_setup',
		'openid.return_to': returnTo,
		'openid.realm': new URL(returnTo).origin,
		'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
		'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
	})
	return `${STEAM_OPENID_ENDPOINT}?${params.toString()}`
}

export type SteamOpenIdError = 'invalid_response' | 'validation_failed'

export async function validateSteamOpenIdResponse(
	query: Record<string, string>,
): Promise<Result<string, SteamOpenIdError>> {
	const claimedId = query['openid.claimed_id'] ?? ''
	const match = STEAM_ID_REGEX.exec(claimedId)
	if (!match) return err('invalid_response')

	const verifyParams = new URLSearchParams({ ...query, 'openid.mode': 'check_authentication' })
	const res = await fetch(STEAM_OPENID_ENDPOINT, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: verifyParams.toString(),
	})
	const text = await res.text()
	if (!text.includes('is_valid:true')) return err('validation_failed')

	return ok(match[1])
}

export async function getSteamPlayerName(steamId: string): Promise<string> {
	const url = `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${env.STEAM_WEB_API_KEY}&steamids=${steamId}`
	try {
		const res = await fetch(url)
		const data = (await res.json()) as { response?: { players?: { personaname?: string }[] } }
		return data.response?.players?.[0]?.personaname ?? 'Unknown'
	} catch {
		return 'Unknown'
	}
}

function buildSteamAuthUrl(ticket: string): string {
	const url = new URL(
		'https://api.steampowered.com/ISteamUserAuth/AuthenticateUserTicket/v1/',
	)
	url.searchParams.set('key', env.STEAM_WEB_API_KEY)
	url.searchParams.set('appid', env.STEAM_APP_ID)
	url.searchParams.set('ticket', ticket)
	return url.toString()
}

export type SteamTicketError = 'invalid_ticket' | 'api_error'

export async function validateSteamTicket(
	ticket: string,
): Promise<Result<{ steamId: string }, SteamTicketError>> {
	const response = await fetch(buildSteamAuthUrl(ticket))
	if (!response.ok) return err('api_error')
	const data = (await response.json()) as SteamAuthResponse
	if (!data.response?.params || data.response.params.result !== 'OK') {
		return err('invalid_ticket')
	}
	return ok({ steamId: data.response.params.steamid })
}
