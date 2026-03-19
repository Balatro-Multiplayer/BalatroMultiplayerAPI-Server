import { afterEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createTestApp } from './app.js'
import { env } from '../../env.js'
import { lobbies, sessions } from '../../state/index.js'
import { Lobby } from '../../state/lobby.js'

const app = createTestApp()
const originalNodeEnv = env.NODE_ENV

describe('POST /api/auth/steam', () => {
	afterEach(() => {
		vi.restoreAllMocks()
	})

	it('returns 400 when ticket is missing', async () => {
		const res = await request(app)
			.post('/api/auth/steam')
			.send({ steamName: 'Alice' })

		expect(res.status).toBe(400)
		expect(res.body.error).toMatch(/ticket/)
	})

	it('returns 400 when steamName is missing', async () => {
		const res = await request(app)
			.post('/api/auth/steam')
			.send({ ticket: 'abc123' })

		expect(res.status).toBe(400)
		expect(res.body.error).toMatch(/steamName/)
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
			.send({ ticket: 'valid-hex', steamName: 'Alice' })

		expect(res.status).toBe(200)
		expect(res.body.token).toBeDefined()
		expect(res.body.player.id).toBeDefined()
		expect(res.body.player.steamName).toBe('Alice')
		expect(res.body.player.lobbyCode).toBeNull()
		expect(res.body.lobby).toBeUndefined()
	})

	it('includes lobby data when player is in a lobby', async () => {
		// Use production mode so authenticateWithSteam reuses the existing session
		;(env as { NODE_ENV: string }).NODE_ENV = 'production'

		const steamResponse = () =>
			new Response(
				JSON.stringify({
					response: {
						params: {
							result: 'OK',
							steamid: '76561198099999',
							ownersteamid: '76561198099999',
							vacbanned: false,
							publisherbanned: false,
						},
					},
				}),
				{ status: 200 },
			)
		vi.spyOn(globalThis, 'fetch').mockImplementation(() =>
			Promise.resolve(steamResponse()),
		)

		// First auth to create the session
		const firstRes = await request(app)
			.post('/api/auth/steam')
			.send({ ticket: 'valid-hex', steamName: 'Reconnector' })

		const playerId = firstRes.body.player.id

		// Put the player into a lobby
		const session = sessions.get(playerId)!
		const lobby = new Lobby('RECON', 'test-mod', playerId)
		lobby.addPlayer(session)
		lobbies.set('RECON', lobby)

		// Re-auth (simulates reconnect)
		const res = await request(app)
			.post('/api/auth/steam')
			.send({ ticket: 'valid-hex', steamName: 'Reconnector' })

		expect(res.status).toBe(200)
		expect(res.body.player.lobbyCode).toBe('RECON')
		expect(res.body.lobby).toBeDefined()
		expect(res.body.lobby.code).toBe('RECON')
		expect(res.body.lobby.modId).toBe('test-mod')
		expect(res.body.lobby.hostId).toBe(playerId)
		expect(res.body.lobby.isHost).toBe(true)

		// Cleanup
		lobby.removePlayer(playerId)
		lobbies.delete('RECON')
		;(env as { NODE_ENV: string }).NODE_ENV = originalNodeEnv
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
			.send({ ticket: 'bad', steamName: 'Alice' })

		expect(res.status).toBe(401)
	})
})

describe('POST /api/auth/dev', () => {
	const devApp = createTestApp()

	afterEach(() => {
		;(env as { NODE_ENV: string }).NODE_ENV = originalNodeEnv
	})

	it('returns 400 when steamName is missing', async () => {
		const res = await request(devApp)
			.post('/api/auth/dev')
			.send({})

		expect(res.status).toBe(400)
		expect(res.body.error).toMatch(/steamName/)
	})

	it('returns token and temp player for valid steamName', async () => {
		const res = await request(devApp)
			.post('/api/auth/dev')
			.send({ steamName: 'DevPlayer' })

		expect(res.status).toBe(200)
		expect(res.body.token).toBeDefined()
		expect(res.body.refreshToken).toBeNull()
		expect(res.body.player.id).toBeDefined()
		expect(res.body.player.steamName).toBe('DevPlayer')
		expect(res.body.player.steamLinked).toBe(false)
		expect(res.body.player.discordLinked).toBe(false)
		expect(res.body.player.isTemp).toBe(true)
	})

	it('creates a valid session that works with EMQX auth', async () => {
		const authRes = await request(devApp)
			.post('/api/auth/dev')
			.send({ steamName: 'DevPlayer' })

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
			.send({ steamName: 'DevPlayer' })

		expect(res.status).toBe(404)
		expect(res.body.error).toBe('Not found')
	})
})
