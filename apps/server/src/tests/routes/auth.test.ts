import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createTestApp } from './app.js'
import { env } from '../../env.js'
import { lobbies, sessions, createSession } from '../../state/index.js'
import { Lobby } from '../../state/lobby.js'
import { redeemRefreshToken, issueRefreshToken } from '../../services/refresh-token.service.js'
import { signTosPendingToken } from '../../services/auth.service.js'
import { setConfig } from '../../state/config.js'

const app = createTestApp()
const originalNodeEnv = env.NODE_ENV

describe('POST /api/auth/steam', () => {
	afterEach(() => {
		vi.restoreAllMocks()
		;(env as { NODE_ENV: string }).NODE_ENV = originalNodeEnv
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

describe('POST /api/auth/refresh', () => {
	beforeEach(() => {
		// vi.restoreAllMocks() in prior afterEach blocks strips vi.mock() implementations
		vi.mocked(issueRefreshToken).mockResolvedValue('mock-refresh-token')
		vi.mocked(redeemRefreshToken).mockResolvedValue(null)
	})

	it('returns 400 when refreshToken is missing', async () => {
		const res = await request(app)
			.post('/api/auth/refresh')
			.send({ steamName: 'Alice' })
		expect(res.status).toBe(400)
	})

	it('returns 400 when steamName is missing', async () => {
		const res = await request(app)
			.post('/api/auth/refresh')
			.send({ refreshToken: 'some-token' })
		expect(res.status).toBe(400)
	})

	it('returns 401 for invalid or expired refresh token', async () => {
		// redeemRefreshToken returns null by default (setup.ts mock)
		const res = await request(app)
			.post('/api/auth/refresh')
			.send({ refreshToken: 'bad-token', steamName: 'Alice' })
		expect(res.status).toBe(401)
	})

	it('returns token and player for valid refresh token', async () => {
		createSession('Alice', { id: 'refresh-p1' })
		vi.mocked(redeemRefreshToken).mockResolvedValueOnce('refresh-p1')

		const res = await request(app)
			.post('/api/auth/refresh')
			.send({ refreshToken: 'valid-token', steamName: 'Alice' })

		expect(res.status).toBe(200)
		expect(res.body).toHaveProperty('token')
		expect(res.body).toHaveProperty('refreshToken', 'mock-refresh-token')
		expect(res.body.player).toMatchObject({ id: 'refresh-p1' })
	})

	it('issues a new refresh token on success (token rotation)', async () => {
		createSession('Alice', { id: 'refresh-p2' })
		vi.mocked(redeemRefreshToken).mockResolvedValueOnce('refresh-p2')

		await request(app)
			.post('/api/auth/refresh')
			.send({ refreshToken: 'old-token', steamName: 'Alice' })

		expect(vi.mocked(issueRefreshToken)).toHaveBeenCalledWith('refresh-p2')
	})

	it('returns tosRequired gate when ToS update is pending', async () => {
		setConfig({ tosVersion: 2, mods: [], chatAllowlist: new Set() })
		createSession('Alice', { id: 'refresh-tos', tosAcceptedVersion: 1 })
		vi.mocked(redeemRefreshToken).mockResolvedValueOnce('refresh-tos')

		const res = await request(app)
			.post('/api/auth/refresh')
			.send({ refreshToken: 'valid', steamName: 'Alice' })

		expect(res.status).toBe(200)
		expect(res.body).toMatchObject({ tosRequired: true, tosUpdate: true })
		expect(res.body).toHaveProperty('token')
		expect(res.body).toHaveProperty('refreshToken', 'mock-refresh-token')
	})
})

describe('POST /api/auth/accept-tos', () => {
	beforeEach(() => {
		vi.mocked(issueRefreshToken).mockResolvedValue('mock-refresh-token')
	})

	it('returns 401 when Authorization header is missing', async () => {
		const res = await request(app).post('/api/auth/accept-tos')
		expect(res.status).toBe(401)
	})

	it('returns 401 for an invalid pending token', async () => {
		const res = await request(app)
			.post('/api/auth/accept-tos')
			.set('Authorization', 'Bearer not.a.valid.token')
		expect(res.status).toBe(401)
	})

	it('returns 401 for a regular JWT (wrong purpose)', async () => {
		const { signJwt } = await import('../../services/auth.service.js')
		createSession('Alice', { id: 'tos-wrong-jwt' })
		const regularToken = signJwt({ playerId: 'tos-wrong-jwt', steamName: 'Alice' })

		const res = await request(app)
			.post('/api/auth/accept-tos')
			.set('Authorization', `Bearer ${regularToken}`)
		expect(res.status).toBe(401)
	})

	it('returns full auth payload after accepting ToS', async () => {
		setConfig({ tosVersion: 1, mods: [], chatAllowlist: new Set() })
		createSession('Alice', { id: 'tos-p1', tosAcceptedVersion: 0 })
		const pendingToken = signTosPendingToken('tos-p1')

		const res = await request(app)
			.post('/api/auth/accept-tos')
			.set('Authorization', `Bearer ${pendingToken}`)

		expect(res.status).toBe(200)
		expect(res.body).toHaveProperty('token')
		expect(res.body).toHaveProperty('refreshToken', 'mock-refresh-token')
		expect(res.body.player).toMatchObject({ id: 'tos-p1' })
	})

	it('issues a refresh token on success', async () => {
		setConfig({ tosVersion: 1, mods: [], chatAllowlist: new Set() })
		createSession('Alice', { id: 'tos-p2', tosAcceptedVersion: 0 })
		const pendingToken = signTosPendingToken('tos-p2')

		await request(app)
			.post('/api/auth/accept-tos')
			.set('Authorization', `Bearer ${pendingToken}`)

		expect(vi.mocked(issueRefreshToken)).toHaveBeenCalledWith('tos-p2')
	})

	it('returns 401 when session does not exist for the pending token player', async () => {
		const pendingToken = signTosPendingToken('nonexistent-player')

		const res = await request(app)
			.post('/api/auth/accept-tos')
			.set('Authorization', `Bearer ${pendingToken}`)

		expect(res.status).toBe(401)
	})
})
