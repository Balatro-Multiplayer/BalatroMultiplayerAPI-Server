import { env } from '../../env.js'

// HTTP transport for the external moderation service. Transport only — the
// business decision (verdict -> chat outcome) lives in
// features/chat/moderation-policy.ts. Any transport/protocol failure is
// reported as `unreachable` and the caller applies the outage policy: free-form
// chat never proceeds unmoderated.

// ---------------------------------------------------------------------------
// Wire contract (single source in this repo — mirror of the service's
// `Band` type in its pipeline/types.ts).
//
// `band` names which pipeline tier produced the verdict. The service's full
// vocabulary today: clean | preset | muted | rate_limited | threat_block |
// blocklist | safety_block | guard_block | guard_unavailable | review.
// The relay only gives special treatment to the two below; every other
// rejecting band is a generic "moderated" block, and unknown future bands
// degrade the same way by design (new tiers must not break old relays).
// ---------------------------------------------------------------------------

export const BAND_MUTED = 'muted'
export const BAND_RATE_LIMITED = 'rate_limited'

export type ModerationVerdict = {
	verdict: 'allow' | 'reject'
	band?: string
	retryAfterMs?: number
	mutedUntil?: string
	// Present when the service rewrote the message. On allow, the relay
	// publishes THIS instead of the original so the raw form never reaches
	// other players.
	publishText?: string
}

// Why a transport call failed — for operator logs, never for control flow.
// Known values: 'bad_json' | 'bad_verdict' | 'fetch_error' | `http_${status}`,
// plus runtime error names (TimeoutError, TypeError, ...) — so honestly a string.
export type UnreachableCause = string

export type ModerationResult =
	| { status: 'verdict'; verdict: ModerationVerdict }
	| { status: 'shed'; retryAfterMs: number }
	| { status: 'unreachable'; cause: UnreachableCause }

export type OutagePolicy = 'off' | 'presets'

export type ModerationBridge = {
	url: string
	bearerToken?: string
	timeoutMs: number
	outagePolicy: OutagePolicy
	fetchFn?: typeof fetch
}

// Wire-body validation: the service is trusted infrastructure, but a version
// skew or proxy error page must not flow into MQTT as a "verdict".
function parseVerdict(body: unknown): ModerationVerdict | null {
	if (typeof body !== 'object' || body === null) return null
	const b = body as Record<string, unknown>
	if (b.verdict !== 'allow' && b.verdict !== 'reject') return null
	if (b.band !== undefined && typeof b.band !== 'string') return null
	if (b.retryAfterMs !== undefined && typeof b.retryAfterMs !== 'number')
		return null
	if (b.mutedUntil !== undefined && typeof b.mutedUntil !== 'string')
		return null
	if (b.publishText !== undefined && typeof b.publishText !== 'string')
		return null
	return b as ModerationVerdict
}

function bridgeFromEnv(): ModerationBridge | null {
	if (!env.MODERATION_SERVICE_URL) return null
	// Guard the timeout: Number('') is 0 and Number('abc') is NaN — either one
	// would abort every request and read as a permanent outage.
	const timeoutMs =
		Number.isFinite(env.MODERATION_TIMEOUT_MS) && env.MODERATION_TIMEOUT_MS > 0
			? env.MODERATION_TIMEOUT_MS
			: 1500
	const policy = env.MODERATION_OUTAGE_POLICY
	if (policy !== 'off' && policy !== 'presets') {
		console.error(
			`[moderation] unrecognized MODERATION_OUTAGE_POLICY "${policy}" — using 'off' (fail closed)`,
		)
	}
	return {
		// Trailing slash would build "//moderate", which routers don't match.
		url: env.MODERATION_SERVICE_URL.replace(/\/+$/, ''),
		...(env.MODERATION_BEARER_TOKEN
			? { bearerToken: env.MODERATION_BEARER_TOKEN }
			: {}),
		timeoutMs,
		outagePolicy: policy === 'presets' ? 'presets' : 'off',
	}
}

// Parsed once at boot; the default seam for processAndPublishMessage.
const DEFAULT_BRIDGE = bridgeFromEnv()

export function moderationBridge(): ModerationBridge | null {
	return DEFAULT_BRIDGE
}

export async function moderateRemote(
	payload: {
		playerId: string
		displayName: string
		lobbyCode: string
		message: string
	},
	bridge: ModerationBridge,
): Promise<ModerationResult> {
	const fetchFn = bridge.fetchFn ?? fetch

	let response: Response
	try {
		response = await fetchFn(`${bridge.url}/moderate`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				...(bridge.bearerToken
					? { authorization: `Bearer ${bridge.bearerToken}` }
					: {}),
			},
			body: JSON.stringify(payload),
			signal: AbortSignal.timeout(bridge.timeoutMs),
		})
	} catch (err) {
		return {
			status: 'unreachable',
			cause: err instanceof Error ? err.name : 'fetch_error',
		}
	}

	if (response.status === 429) {
		let retryAfterMs = 1000
		try {
			const body = (await response.json()) as { retryAfterMs?: unknown }
			if (typeof body.retryAfterMs === 'number')
				retryAfterMs = body.retryAfterMs
		} catch {
			// keep default
		}
		return { status: 'shed', retryAfterMs }
	}

	if (!response.ok) {
		// 503 model-not-loaded, 401 misconfig, 5xx — all fail closed.
		return { status: 'unreachable', cause: `http_${response.status}` }
	}

	let body: unknown
	try {
		body = await response.json()
	} catch {
		return { status: 'unreachable', cause: 'bad_json' }
	}
	const verdict = parseVerdict(body)
	if (!verdict) return { status: 'unreachable', cause: 'bad_verdict' }
	return { status: 'verdict', verdict }
}
