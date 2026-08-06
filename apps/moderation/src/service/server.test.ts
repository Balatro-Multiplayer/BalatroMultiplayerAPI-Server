import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { GuardEngine } from '../guard/engine.js'
import type { ServicePosture } from './posture.js'
import { createModerationServer } from './server.js'
import { createModerationService } from './service.js'

/** A guard that answers Safe for everything, instantly. */
function safeGuard(): GuardEngine {
	return {
		ready: () => true,
		judge: async () => ({
			safety: 'Safe',
			categories: [],
			latencyMs: 0,
			raw: '',
		}),
	}
}

const ENFORCE_POSTURE: ServicePosture = {
	enforcement: 'enforce',
	authEnabled: true,
}

// HTTP-layer tests against an ephemeral port — auth, validation, verdict
// passthrough, health. This server has exactly two routes.

const TOKEN = 'test-secret'
let baseUrl = ''
let close: () => void

beforeAll(async () => {
	const service = createModerationService({ guard: safeGuard() })
	const server = createModerationServer({
		service,
		bearerTokens: [TOKEN, 'rotation-second-token'],
		modelId: 'null-model',
		posture: ENFORCE_POSTURE,
		lists: {
			allowlist: 42,
			rewrites: 'unset',
			approvedDomains: 0,
		},
	})
	await new Promise<void>((resolve) => server.listen(0, resolve))
	const { port } = server.address() as AddressInfo
	baseUrl = `http://127.0.0.1:${port}`
	close = () => server.close()
})

afterAll(() => close())

function moderate(body: unknown, token: string | null = TOKEN) {
	return fetch(`${baseUrl}/moderate`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(token ? { authorization: `Bearer ${token}` } : {}),
		},
		body: JSON.stringify(body),
	})
}

const valid = {
	playerId: 'p1',
	lobbyCode: 'ABCD',
	message: 'hello there',
}

describe('moderation HTTP server', () => {
	it('GET /health reports ok when the guard is ready', async () => {
		const res = await fetch(`${baseUrl}/health`)
		expect(res.status).toBe(200)
		expect(await res.json()).toMatchObject({ status: 'ok', model_loaded: true })
	})

	it('GET /health reports enforcement, auth and list-load state — no shell access needed to know whether this is blocking anything', async () => {
		const body = await (await fetch(`${baseUrl}/health`)).json()
		expect(body).toMatchObject({
			enforcement: 'enforce',
			auth: 'enabled',
			model_load_error: null,
			lists: {
				allowlist: 42,
				rewrites: 'unset',
				approvedDomains: 0,
			},
			guard: { inflight: 0, avg_judge_ms: null },
		})
	})

	it('GET /health defaults build.git_sha to "unknown" when unset', async () => {
		const body = await (await fetch(`${baseUrl}/health`)).json()
		expect(body).toMatchObject({ build: { git_sha: 'unknown' } })
	})

	it('rejects missing/wrong bearer token with 401', async () => {
		expect((await moderate(valid, null)).status).toBe(401)
		expect((await moderate(valid, 'wrong')).status).toBe(401)
	})

	it('moderates a valid request', async () => {
		const res = await moderate(valid)
		expect(res.status).toBe(200)
		expect(await res.json()).toMatchObject({ verdict: 'allow', band: 'clean' })
	})

	it('rejects a blocklist message with the verdict body', async () => {
		const res = await moderate({ ...valid, message: 'kys' })
		expect(res.status).toBe(200)
		const body = await res.json()
		expect(body).toMatchObject({
			verdict: 'reject',
			band: 'blocklist',
			reason: 'blocklist',
		})
	})

	it('400s on malformed body and missing fields', async () => {
		const bad = await fetch(`${baseUrl}/moderate`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${TOKEN}`,
			},
			body: 'not json',
		})
		expect(bad.status).toBe(400)
		expect((await moderate({ playerId: 'p1' })).status).toBe(400)
		expect((await moderate({ ...valid, message: '' })).status).toBe(400)
	})

	it('413s a payload over the size cap', async () => {
		const res = await moderate({ ...valid, message: 'x'.repeat(20_000) })
		expect(res.status).toBe(413)
	})

	it('404s unknown routes, including the removed admin/intake/analyze surface', async () => {
		expect((await fetch(`${baseUrl}/nope`)).status).toBe(404)
		expect((await fetch(`${baseUrl}/admin/stats`)).status).toBe(404)
		expect(
			(
				await fetch(`${baseUrl}/analyze`, {
					method: 'POST',
					headers: { authorization: `Bearer ${TOKEN}` },
				})
			).status,
		).toBe(404)
		expect((await fetch(`${baseUrl}/report`, { method: 'POST' })).status).toBe(
			404,
		)
	})
})

describe('moderation HTTP server — model not loaded', () => {
	it('still reports the outage on /health in shadow mode, but publishes rather than refusing', async () => {
		const service = createModerationService({
			guard: {
				ready: () => false,
				loadError: () => 'ENOENT: model file missing',
				judge: async () => {
					throw new Error('not loaded')
				},
			},
		})
		const server = createModerationServer({
			service,
			modelId: 'x',
			posture: { enforcement: 'shadow', authEnabled: false },
			gitSha: 'deadbeef',
		})
		await new Promise<void>((resolve) => server.listen(0, resolve))
		const { port } = server.address() as AddressInfo
		const url = `http://127.0.0.1:${port}`
		try {
			const health = await fetch(`${url}/health`)
			expect(health.status).toBe(503)
			expect(await health.json()).toMatchObject({
				status: 'loading',
				model_load_error: 'ENOENT: model file missing',
				enforcement: 'shadow',
				auth: 'disabled',
				build: { git_sha: 'deadbeef' },
				lists: {
					allowlist: 'unset',
					rewrites: 'unset',
					approvedDomains: 'unset',
				},
			})
			// /health still says "loading" — monitoring must see the outage.
			// But shadow mode grants the guard no enforcement power, so a model
			// it cannot consult must not take chat down with it.
			const res = await fetch(`${url}/moderate`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(valid),
			})
			expect(res.status).toBe(200)
			const verdict = (await res.json()) as { verdict: string; band: string }
			expect(verdict.verdict).toBe('allow')
			// 'review' is the band that means "published, but a human should
			// see it" — the skip reason itself rides on the logged verdict
			// (asserted in decide.test.ts), not on this response contract.
			expect(verdict.band).toBe('review')
		} finally {
			server.close()
		}
	})

	it('fails closed with 503 on /moderate when enforcing', async () => {
		const service = createModerationService({
			guard: {
				ready: () => false,
				loadError: () => 'ENOENT: model file missing',
				judge: async () => {
					throw new Error('not loaded')
				},
			},
		})
		const server = createModerationServer({
			service,
			modelId: 'x',
			posture: { enforcement: 'enforce', authEnabled: false },
		})
		await new Promise<void>((resolve) => server.listen(0, resolve))
		const { port } = server.address() as AddressInfo
		try {
			const res = await fetch(`http://127.0.0.1:${port}/moderate`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(valid),
			})
			expect(res.status).toBe(503)
			expect(await res.json()).toMatchObject({ error: 'model_not_loaded' })
		} finally {
			server.close()
		}
	})

	// The whole justification for publishing above is that the tiers ahead of
	// the guard still run. If this ever regressed, an unloaded model would mean
	// unfiltered chat.
	it('still rejects a deterministic block with no model, in shadow mode', async () => {
		const service = createModerationService({
			guard: {
				ready: () => false,
				judge: async () => {
					throw new Error('not loaded')
				},
			},
		})
		const server = createModerationServer({
			service,
			modelId: 'x',
			posture: { enforcement: 'shadow', authEnabled: false },
		})
		await new Promise<void>((resolve) => server.listen(0, resolve))
		const { port } = server.address() as AddressInfo
		try {
			const res = await fetch(`http://127.0.0.1:${port}/moderate`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					...valid,
					message: 'i will kill you and your family',
				}),
			})
			expect(res.status).toBe(200)
			const verdict = (await res.json()) as {
				verdict: string
				band: string
			}
			expect(verdict.verdict).toBe('reject')
			expect(verdict.band).toBe('threat_block')
		} finally {
			server.close()
		}
	})
})

describe('bearer rotation', () => {
	it('accepts any configured token during a rotation window', async () => {
		const res = await moderate(valid, 'rotation-second-token')
		expect(res.status).toBe(200)
	})
})
