import request from 'supertest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import { setConfig } from '../../state/config.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

// The moderation bridge is parsed from env once at gateway module load, so the
// URL must exist before any import pulls the module graph in. The bridge has
// no fetchFn, so it falls through to global fetch — stubbed per test below.
vi.hoisted(() => {
	process.env.MODERATION_SERVICE_URL = 'http://moderation.test'
	process.env.MODERATION_BEARER_TOKEN = 'route-test-token'
})

const app = createTestApp()

function stubModeration(status: number, body: unknown) {
	vi.stubGlobal(
		'fetch',
		(async () =>
			new Response(JSON.stringify(body), {
				status,
				headers: { 'content-type': 'application/json' },
			})) as unknown as typeof fetch,
	)
}

function chatConfig() {
	setConfig({
		tosVersion: 0,
		mods: [],
		chatAllowlist: new Set(),
		chatEnabled: true,
	})
}

function authHeader(playerId: string, steamName: string) {
	createSession(steamName, { id: playerId, chatEnabled: true })
	const token = signJwt({ playerId, steamName })
	return `Bearer ${token}`
}

async function createLobby(hostId: string, hostName: string) {
	const res = await request(app)
		.post('/api/lobbies')
		.set('Authorization', authHeader(hostId, hostName))
		.send({ modId: 'mod1' })
	return res.body.lobby.code as string
}

async function sendChat(code: string, auth: string, message = 'hello') {
	return request(app)
		.post(`/api/lobbies/${code}/chat`)
		.set('Authorization', auth)
		.send({ message })
}

afterEach(() => {
	vi.unstubAllGlobals()
})

describe('POST /api/lobbies/:code/chat — moderation bridge mapping', () => {
	it('returns 200 without publishText when the service allows unmodified', async () => {
		chatConfig()
		const auth = authHeader('host1', 'Alice')
		const code = await createLobby('host1', 'Alice')
		stubModeration(200, { verdict: 'allow', band: 'clean' })

		const res = await sendChat(code, auth)
		expect(res.status).toBe(200)
		expect(res.body).toEqual({ ok: true })
	})

	it('returns publishText in the body only when the service rewrote the message', async () => {
		chatConfig()
		const auth = authHeader('host1', 'Alice')
		const code = await createLobby('host1', 'Alice')
		stubModeration(200, {
			verdict: 'allow',
			band: 'clean',
			publishText: 'suck my cocktail',
		})

		const res = await sendChat(code, auth, 'suck my cock')
		expect(res.status).toBe(200)
		expect(res.body).toEqual({ ok: true, publishText: 'suck my cocktail' })
	})

	it('maps a moderated reject to 403', async () => {
		chatConfig()
		const auth = authHeader('host1', 'Alice')
		const code = await createLobby('host1', 'Alice')
		stubModeration(200, { verdict: 'reject', band: 'blocklist' })

		const res = await sendChat(code, auth)
		expect(res.status).toBe(403)
		expect(res.body.error).toMatch(/rejected by moderation/)
	})

	it('maps a muted reject to 403 with the until-timestamp in the message', async () => {
		chatConfig()
		const auth = authHeader('host1', 'Alice')
		const code = await createLobby('host1', 'Alice')
		stubModeration(200, {
			verdict: 'reject',
			band: 'muted',
			mutedUntil: '2026-08-01T00:00:00Z',
		})

		const res = await sendChat(code, auth)
		expect(res.status).toBe(403)
		expect(res.body.error).toBe('You are muted until 2026-08-01T00:00:00Z')
	})

	it('maps rate limiting to 429 and the Retry-After header survives the error middleware', async () => {
		chatConfig()
		const auth = authHeader('host1', 'Alice')
		const code = await createLobby('host1', 'Alice')
		stubModeration(200, {
			verdict: 'reject',
			band: 'rate_limited',
			retryAfterMs: 2500,
		})

		const res = await sendChat(code, auth)
		expect(res.status).toBe(429)
		expect(res.headers['retry-after']).toBe('3')
	})

	it('maps service load-shedding (429) the same way', async () => {
		chatConfig()
		const auth = authHeader('host1', 'Alice')
		const code = await createLobby('host1', 'Alice')
		stubModeration(429, { retryAfterMs: 1000 })

		const res = await sendChat(code, auth)
		expect(res.status).toBe(429)
		expect(res.headers['retry-after']).toBe('1')
	})

	it('fails closed to 503 when the service is unreachable', async () => {
		chatConfig()
		const auth = authHeader('host1', 'Alice')
		const code = await createLobby('host1', 'Alice')
		stubModeration(503, {})

		const res = await sendChat(code, auth)
		expect(res.status).toBe(503)
		expect(res.body.error).toBe('Chat is temporarily unavailable')
	})

	it('still rejects empty messages before the bridge is consulted', async () => {
		chatConfig()
		const auth = authHeader('host1', 'Alice')
		const code = await createLobby('host1', 'Alice')
		stubModeration(200, { verdict: 'allow' })

		const res = await sendChat(code, auth, '   ')
		expect(res.status).toBe(400)
	})
})
