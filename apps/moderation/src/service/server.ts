import { timingSafeEqual } from 'node:crypto'
import { type Server, createServer } from 'node:http'
import type { ServicePosture } from './posture.js'
import type { ModerateRequest, ModerationService } from './service.js'

// Thin HTTP transport over the service core: POST /moderate + GET /health.
// Nothing else — this service is verdict-only (docs/13: JUDGMENT here,
// STANDING is a separate deployable). Bearer auth on /moderate (shared token
// with the relay, ADR-1); /health open (deliberately: it must answer "is this
// enforcing?" without a bearer token, per its whole purpose). Deliberately
// node:http — two routes don't justify a framework dependency.

/** A word-list's load state, for /health visibility (see main.ts). */
export type ListStatus = number | 'unset' | 'error'

export type ServerOptions = {
	service: ModerationService
	/**
	 * Accepted bearer tokens. More than one enables ZERO-DOWNTIME ROTATION:
	 * add the new token here, let the relay swap at its leisure, then remove
	 * the old one. Comma-separated via MODERATION_BEARER_TOKEN env.
	 */
	bearerTokens?: string[]
	modelId: string
	/**
	 * Boot-computed enforcement/auth posture — rendered in the boot banner AND
	 * here, from the same fields, so they can never drift apart.
	 */
	posture: ServicePosture
	/** Word-list load state, surfaced so config drift (DEPLOY.md's known failure mode) is visible by polling instead of log archaeology. */
	lists?: {
		allowlist: ListStatus
		rewrites: ListStatus
		approvedDomains: ListStatus
	}
	/** The commit this image was built from (Dockerfile's GIT_SHA build arg); 'unknown' outside CI's build. */
	gitSha?: string
}

function tokenMatches(header: string | undefined, tokens: string[]): boolean {
	// Zero configured tokens = accept unauthenticated requests. main.ts is
	// responsible for refusing to boot this way in production and for
	// warning loudly (boot banner + /health `auth`) everywhere else — nothing
	// here enforces "dev only".
	if (tokens.length === 0) return true
	if (!header?.startsWith('Bearer ')) return false
	const presented = Buffer.from(header.slice(7))
	return tokens.some((t) => {
		const expected = Buffer.from(t)
		return (
			presented.length === expected.length &&
			timingSafeEqual(presented, expected)
		)
	})
}

function isModerateRequest(body: unknown): body is ModerateRequest {
	if (typeof body !== 'object' || body === null) return false
	const b = body as Record<string, unknown>
	return (
		typeof b.playerId === 'string' &&
		b.playerId.length > 0 &&
		typeof b.lobbyCode === 'string' &&
		typeof b.message === 'string' &&
		b.message.length > 0 &&
		b.message.length <= 2000
	)
}

export function createModerationServer(opts: ServerOptions): Server {
	const { service, modelId, posture } = opts
	const tokens = opts.bearerTokens ?? []
	const lists = opts.lists ?? {
		allowlist: 'unset' as const,
		rewrites: 'unset' as const,
		approvedDomains: 'unset' as const,
	}
	const gitSha = opts.gitSha ?? 'unknown'

	return createServer(async (req, res) => {
		const json = (status: number, body: unknown): void => {
			res.writeHead(status, { 'content-type': 'application/json' })
			res.end(JSON.stringify(body))
		}

		try {
			if (req.method === 'GET' && req.url === '/health') {
				const ready = service.ready()
				const diagnostics = service.diagnostics()
				return json(ready ? 200 : 503, {
					status: ready ? 'ok' : 'loading',
					model: modelId,
					model_loaded: ready,
					model_load_error: diagnostics.modelLoadError,
					// The whole point: an operator must be able to tell whether this
					// is actually blocking anything from THIS endpoint, no shell needed.
					enforcement: posture.enforcement,
					auth: posture.authEnabled ? 'enabled' : 'disabled',
					build: { git_sha: gitSha },
					lists,
					guard: {
						inflight: diagnostics.guardInflight,
						avg_judge_ms: diagnostics.guardAvgJudgeMs,
					},
				})
			}

			if (req.method === 'POST' && req.url === '/moderate') {
				if (!tokenMatches(req.headers.authorization, tokens)) {
					return json(401, { error: 'unauthorized' })
				}
				// Fail-closed: the relay treats 503 per its outage policy.
				//
				// Not in shadow mode, though. There the guard has no enforcement
				// power at all (an 'Unsafe' verdict publishes), so refusing every
				// message because it cannot answer would be strictly harsher than
				// the case where it did object — and it would make a missing or
				// still-loading model indistinguishable from "chat is broken".
				// Falling through instead lets the pipeline run: the guard tier
				// records itself as skipped ('engine_not_ready') and publishes as
				// 'review', while the deterministic tiers ahead of it — threats,
				// blocklist, PII/contact, links, rate limit — still reject.
				if (!service.ready() && posture.enforcement !== 'shadow') {
					return json(503, { error: 'model_not_loaded' })
				}

				let body = ''
				for await (const chunk of req) {
					body += chunk
					if (body.length > 16_384) {
						return json(413, { error: 'payload_too_large' })
					}
				}
				let parsed: unknown
				try {
					parsed = JSON.parse(body)
				} catch {
					return json(400, { error: 'invalid_json' })
				}
				if (!isModerateRequest(parsed)) {
					return json(400, { error: 'invalid_request' })
				}

				const verdict = await service.moderate(parsed)
				if (verdict.band === 'shed') {
					return json(429, verdict)
				}
				return json(200, verdict)
			}

			return json(404, { error: 'not_found' })
		} catch {
			// Totality at the transport edge: an unexpected throw is a 500, and
			// the relay's fail-closed handling takes over.
			return json(500, { error: 'internal' })
		}
	})
}
