import http from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../../env.js'
import { decideModerationOutcome } from '../../features/chat/moderation.js'
import {
	type ModerationServiceConfig,
	callModerationService,
	isModerationBridgeEnabled,
} from '../../infrastructure/gateways/moderation.gateway.js'

const config: ModerationServiceConfig = {
	url: 'http://moderation.local',
	bearerToken: '',
	timeoutMs: 1500,
}

const request = {
	playerId: 'p1',
	displayName: 'Alice',
	lobbyCode: 'ABC123',
	message: 'hello there',
}

describe('moderation.gateway.callModerationService', () => {
	const originalFetch = global.fetch

	beforeEach(() => {
		global.fetch = vi.fn()
	})

	afterEach(() => {
		global.fetch = originalFetch
	})

	it('posts to <url>/moderate with the request body', async () => {
		vi.mocked(global.fetch).mockResolvedValue(
			new Response(JSON.stringify({ verdict: 'allow' }), { status: 200 }),
		)

		await callModerationService(request, config)

		expect(global.fetch).toHaveBeenCalledWith(
			'http://moderation.local/moderate',
			expect.objectContaining({
				method: 'POST',
				body: JSON.stringify(request),
			}),
		)
	})

	it('omits the Authorization header when no bearer token is configured', async () => {
		vi.mocked(global.fetch).mockResolvedValue(
			new Response(JSON.stringify({ verdict: 'allow' }), { status: 200 }),
		)

		await callModerationService(request, config)

		const [, init] = vi.mocked(global.fetch).mock.calls[0]
		const headers = init?.headers as Record<string, string>
		expect(headers.Authorization).toBeUndefined()
	})

	it('sends an Authorization: Bearer header when a token is configured', async () => {
		vi.mocked(global.fetch).mockResolvedValue(
			new Response(JSON.stringify({ verdict: 'allow' }), { status: 200 }),
		)

		await callModerationService(request, {
			...config,
			bearerToken: 'secret-token',
		})

		const [, init] = vi.mocked(global.fetch).mock.calls[0]
		const headers = init?.headers as Record<string, string>
		expect(headers.Authorization).toBe('Bearer secret-token')
	})

	it('returns the parsed status and body on a normal response', async () => {
		vi.mocked(global.fetch).mockResolvedValue(
			new Response(
				JSON.stringify({ verdict: 'reject', band: 'threat_block' }),
				{ status: 200 },
			),
		)

		await expect(callModerationService(request, config)).resolves.toEqual({
			status: 200,
			body: { verdict: 'reject', band: 'threat_block' },
		})
	})

	it('passes through a non-2xx status with its body', async () => {
		vi.mocked(global.fetch).mockResolvedValue(
			new Response(JSON.stringify({ error: 'overloaded' }), { status: 429 }),
		)

		await expect(callModerationService(request, config)).resolves.toEqual({
			status: 429,
			body: { error: 'overloaded' },
		})
	})

	it('returns a null body when the response is not valid JSON (e.g. a proxy error page)', async () => {
		vi.mocked(global.fetch).mockResolvedValue(
			new Response('<html>502 Bad Gateway</html>', { status: 200 }),
		)

		await expect(callModerationService(request, config)).resolves.toEqual({
			status: 200,
			body: null,
		})
	})

	it('returns null (transport failure) when fetch rejects, e.g. on timeout/abort', async () => {
		vi.mocked(global.fetch).mockRejectedValue(
			new DOMException('The operation was aborted', 'AbortError'),
		)

		await expect(callModerationService(request, config)).resolves.toBeNull()
	})

	it('returns null when fetch throws a network error', async () => {
		vi.mocked(global.fetch).mockRejectedValue(new TypeError('fetch failed'))

		await expect(callModerationService(request, config)).resolves.toBeNull()
	})

	// Trust-boundary regression: a redirect must never be able to hand back an
	// "allow" from somewhere other than the configured moderation origin. This
	// drives a real HTTP 302 through the real fetch (restored for just this
	// test) instead of asserting on call args, so it actually catches a
	// regression back to the default redirect: 'follow' behaviour.
	it('fails closed (never allows) when the moderation origin responds with a redirect', async () => {
		global.fetch = originalFetch

		// The redirect target is a REACHABLE origin serving a valid allow
		// verdict. That is what makes this a real regression test: revert to
		// redirect: 'follow' and fetch reaches this server, returns 200 +
		// allow, and the assertion below fails. Pointing at an unresolvable
		// host would pass either way.
		const impostor = http.createServer((_req, res) => {
			res.writeHead(200, { 'Content-Type': 'application/json' })
			res.end(JSON.stringify({ verdict: 'allow' }))
		})
		await new Promise<void>((resolve) => impostor.listen(0, resolve))
		const impostorAddress = impostor.address()
		if (impostorAddress === null || typeof impostorAddress === 'string') {
			throw new Error('failed to bind impostor server')
		}

		const redirector = http.createServer((_req, res) => {
			res.writeHead(302, {
				Location: `http://127.0.0.1:${impostorAddress.port}/moderate`,
			})
			res.end()
		})
		await new Promise<void>((resolve) => redirector.listen(0, resolve))
		const address = redirector.address()
		if (address === null || typeof address === 'string') {
			throw new Error('failed to bind test redirect server')
		}

		try {
			const result = await callModerationService(request, {
				...config,
				url: `http://127.0.0.1:${address.port}`,
			})

			expect(result).toBeNull()
			expect(decideModerationOutcome(result).allowed).toBe(false)
		} finally {
			redirector.close()
			impostor.close()
		}
	})
})

describe('moderation.gateway.isModerationBridgeEnabled', () => {
	// env.ts's readonly typing is TS-only (no runtime freeze).
	const mutableEnv = env as { MODERATION_SERVICE_URL: string }
	const originalUrl = env.MODERATION_SERVICE_URL

	afterEach(() => {
		mutableEnv.MODERATION_SERVICE_URL = originalUrl
	})

	it('is false when MODERATION_SERVICE_URL is unset', () => {
		mutableEnv.MODERATION_SERVICE_URL = ''
		expect(isModerationBridgeEnabled()).toBe(false)
	})

	it('is true when MODERATION_SERVICE_URL is set, and the default call config agrees', async () => {
		mutableEnv.MODERATION_SERVICE_URL = 'http://moderation.local'
		expect(isModerationBridgeEnabled()).toBe(true)

		// The default config is re-read live, from the same value, so a caller
		// that only checks isModerationBridgeEnabled() can never end up calling
		// out to a stale/empty URL.
		const originalFetch = global.fetch
		global.fetch = vi
			.fn()
			.mockResolvedValue(
				new Response(JSON.stringify({ verdict: 'allow' }), { status: 200 }),
			)
		try {
			await callModerationService(request)
			expect(global.fetch).toHaveBeenCalledWith(
				'http://moderation.local/moderate',
				expect.anything(),
			)
		} finally {
			global.fetch = originalFetch
		}
	})
})
