import { afterEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createTestApp } from './app.js'

const app = createTestApp()

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
