import { afterEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createTestApp } from './app.js'
import { env } from '../../env.js'

const app = createTestApp()
const originalNodeEnv = env.NODE_ENV

describe('POST /api/auth/steam', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('returns 400 when ticket is missing', async () => {
		const res = await request(app)
			.post('/api/auth/steam')
			.send({ username: 'Alice' })

		expect(res.status).toBe(400)
		expect(res.body.error).toMatch(/ticket/)
	})

	it('returns 400 when username is missing', async () => {
		const res = await request(app)
			.post('/api/auth/steam')
			.send({ ticket: 'abc123' })

		expect(res.status).toBe(400)
		expect(res.body.error).toMatch(/username/)
	})

	it('returns token and player for valid Steam ticket', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					response: {
						params: {
							result: 'OK',
							steamid: '76561198012345',
							ownersteamid: '76561198012345',
							vacbanned: false,
							publisherbanned: false,
						},
					},
				}),
				{ status: 200 },
			),
		)

		const res = await request(app)
			.post('/api/auth/steam')
			.send({ ticket: 'valid-hex', username: 'Alice' })

		expect(res.status).toBe(200)
		expect(res.body.token).toBeDefined()
		expect(res.body.player.id).toBeDefined()
		expect(res.body.player.username).toBe('Alice')
		expect(res.body.player.steamId).toBe('76561198012345')
	})

	it('returns error for invalid Steam ticket', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			new Response(
				JSON.stringify({
					response: {
						params: {
							result: 'FAIL',
							steamid: '',
							ownersteamid: '',
							vacbanned: false,
							publisherbanned: false,
						},
					},
				}),
				{ status: 200 },
			),
		)

		const res = await request(app)
			.post('/api/auth/steam')
			.send({ ticket: 'bad', username: 'Alice' })

		expect(res.status).toBe(401)
	})
})

describe('POST /api/auth/dev', () => {
	const devApp = createTestApp()

	afterEach(() => {
		;(env as { NODE_ENV: string }).NODE_ENV = originalNodeEnv
	})

	it('returns 400 when username is missing', async () => {
		const res = await request(devApp)
			.post('/api/auth/dev')
			.send({})

		expect(res.status).toBe(400)
		expect(res.body.error).toMatch(/username/)
	})

	it('returns token and temp player for valid username', async () => {
		const res = await request(devApp)
			.post('/api/auth/dev')
			.send({ username: 'DevPlayer' })

		expect(res.status).toBe(200)
		expect(res.body.token).toBeDefined()
		expect(res.body.refreshToken).toBeNull()
		expect(res.body.player.id).toBeDefined()
		expect(res.body.player.username).toBe('DevPlayer')
		expect(res.body.player.steamId).toBeNull()
		expect(res.body.player.discordId).toBeNull()
		expect(res.body.player.isTemp).toBe(true)
	})

	it('creates a valid session that works with EMQX auth', async () => {
		const authRes = await request(devApp)
			.post('/api/auth/dev')
			.send({ username: 'DevPlayer' })

		const playerId = authRes.body.player.id
		const token = authRes.body.token

		const emqxRes = await request(devApp)
			.post('/emqx/auth')
			.send({
				clientid: playerId,
				username: playerId,
				password: token,
				peerhost: '127.0.0.1',
			})

		expect(emqxRes.status).toBe(200)
		expect(emqxRes.body.result).toBe('allow')
	})

	it('returns 404 when NODE_ENV is production', async () => {
		;(env as { NODE_ENV: string }).NODE_ENV = 'production'

		const res = await request(devApp)
			.post('/api/auth/dev')
			.send({ username: 'DevPlayer' })

		expect(res.status).toBe(404)
		expect(res.body.error).toBe('Not found')
	})
})
