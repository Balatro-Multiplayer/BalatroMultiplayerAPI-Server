import { env } from '../../env.js'
import type { ModerationAttempt } from '../../features/chat/moderation.js'

export type ModerationRequest = {
	playerId: string
	lobbyCode: string
	message: string
}

export type ModerationServiceConfig = {
	url: string
	bearerToken: string
	timeoutMs: number
}

// Whether the bridge is on is one seam, not two: this reads the same env
// value used to build the default call config below, so "is it enabled" and
// "what do we call" can never disagree.
export function isModerationBridgeEnabled(): boolean {
	return env.MODERATION_SERVICE_URL !== ''
}

// Evaluated fresh per call (default params re-run their expression each time
// the arg is omitted) rather than snapshotted at module load, so it can never
// go stale relative to isModerationBridgeEnabled() above.
function currentConfig(): ModerationServiceConfig {
	return {
		url: env.MODERATION_SERVICE_URL,
		bearerToken: env.MODERATION_BEARER_TOKEN,
		timeoutMs: env.MODERATION_TIMEOUT_MS,
	}
}

// Single attempt, no retries. Any network error, abort, or non-JSON body
// comes back as null — the caller treats that as a failed-closed attempt.
export async function callModerationService(
	request: ModerationRequest,
	config: ModerationServiceConfig = currentConfig(),
): Promise<ModerationAttempt> {
	const headers: Record<string, string> = { 'Content-Type': 'application/json' }
	if (config.bearerToken) {
		headers.Authorization = `Bearer ${config.bearerToken}`
	}

	try {
		const res = await fetch(`${config.url}/moderate`, {
			method: 'POST',
			headers,
			body: JSON.stringify(request),
			// Never follow a redirect for a "verdict" response — that would let
			// something other than the configured origin decide whether a message
			// is allowed. Treat a redirect as the transport failure it is.
			redirect: 'error',
			signal: AbortSignal.timeout(config.timeoutMs),
		})
		const body: unknown = await res.json().catch(() => null)
		if (res.status !== 200 && res.status !== 429) {
			// 401/413/500/503 all fail closed downstream; without this line a
			// misconfigured token or a dead service is a silent chat outage.
			console.error(
				`[moderation] moderation service returned ${res.status}, chat fails closed`,
			)
		}
		return { status: res.status, body }
	} catch (err) {
		console.error(
			'[moderation] request to moderation service failed, chat fails closed:',
			err,
		)
		return null
	}
}
