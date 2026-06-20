/**
 * Thin client for the EMQX management API used for moderation actions
 * (force-disconnecting a banned client). The webhook *rules* are set up in
 * emqx-provision.service.ts; this module only performs ad-hoc client kicks.
 */

import { env } from '../../env.js'

const EMQX_API = env.EMQX_API_URL
const EMQX_USER = 'admin'
const EMQX_PASS = 'public'

async function getToken(): Promise<string> {
	const res = await fetch(`${EMQX_API}/login`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ username: EMQX_USER, password: EMQX_PASS }),
	})
	if (!res.ok) throw new Error(`EMQX login failed: ${res.status}`)
	const data = (await res.json()) as { token: string }
	return data.token
}

/**
 * Force-disconnects a client (by clientid == playerId) from the broker.
 * Returns true if EMQX accepted the kick (204) or the client was already gone
 * (404). Never throws — kicking is best-effort; the ban row is the source of
 * truth and will deny the next CONNECT regardless.
 */
export async function kickClient(clientId: string): Promise<boolean> {
	try {
		const token = await getToken()
		const res = await fetch(
			`${EMQX_API}/clients/${encodeURIComponent(clientId)}`,
			{
				method: 'DELETE',
				headers: { Authorization: `Bearer ${token}` },
			},
		)
		// 204 = kicked, 404 = not currently connected — both are success for us.
		return res.ok || res.status === 404
	} catch (err) {
		console.error(`[emqx-admin] Failed to kick client ${clientId}:`, err)
		return false
	}
}
