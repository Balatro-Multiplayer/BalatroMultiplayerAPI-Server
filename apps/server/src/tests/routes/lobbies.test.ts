import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createTestApp } from './app.js'
import { signJwt } from '../../services/auth.service.js'
import { createSession } from '../../state/index.js'

const app = createTestApp()

function authHeader(playerId: string, steamName: string, lobbyCode?: string) {
	createSession(steamName, { id: playerId })
	const token = signJwt({ playerId, steamName, lobbyCode })
	return `Bearer ${token}`
}

describe('lobby routes', () => {
	describe('POST /api/lobbies', () => {
		it('returns 401 without auth', async () => {
			const res = await request(app).post('/api/lobbies').send({ modId: 'mod1' })
			expect(res.status).toBe(401)
		})

		it('returns 400 without modId', async () => {
			const res = await request(app)
				.post('/api/lobbies')
				.set('Authorization', authHeader('host1', 'Alice'))
				.send({})
			expect(res.status).toBe(400)
		})

		it('creates a lobby and returns lobby info', async () => {
			const res = await request(app)
				.post('/api/lobbies')
				.set('Authorization', authHeader('host1', 'Alice'))
				.send({ modId: 'cool_mod' })

			expect(res.status).toBe(201)
			expect(res.body.lobby.code).toHaveLength(6)
			expect(res.body.lobby.modId).toBe('cool_mod')
			expect(res.body.lobby.isHost).toBe(true)
			expect(res.body.lobby.maxPlayers).toBe(16)
			expect(res.body.token).toBeDefined()
		})

		it('creates a lobby with custom maxPlayers', async () => {
			const res = await request(app)
				.post('/api/lobbies')
				.set('Authorization', authHeader('host1', 'Alice'))
				.send({ modId: 'cool_mod', maxPlayers: 4 })

			expect(res.status).toBe(201)
			expect(res.body.lobby.maxPlayers).toBe(4)
		})

		it('returns 400 for invalid maxPlayers', async () => {
			const res = await request(app)
				.post('/api/lobbies')
				.set('Authorization', authHeader('host1', 'Alice'))
				.send({ modId: 'cool_mod', maxPlayers: 1 })

			expect(res.status).toBe(400)
			expect(res.body.error).toMatch(/maxPlayers/)
		})

		it('returns 400 for non-integer maxPlayers', async () => {
			const res = await request(app)
				.post('/api/lobbies')
				.set('Authorization', authHeader('host1', 'Alice'))
				.send({ modId: 'cool_mod', maxPlayers: 3.5 })

			expect(res.status).toBe(400)
		})

		it('returns 400 for maxPlayers > 128', async () => {
			const res = await request(app)
				.post('/api/lobbies')
				.set('Authorization', authHeader('host1', 'Alice'))
				.send({ modId: 'cool_mod', maxPlayers: 200 })

			expect(res.status).toBe(400)
		})
	})

	describe('POST /api/lobbies/:code/join', () => {
		it('joins an existing lobby', async () => {
			// Create lobby first
			const createRes = await request(app)
				.post('/api/lobbies')
				.set('Authorization', authHeader('host1', 'Alice'))
				.send({ modId: 'mod1' })

			const code = createRes.body.lobby.code

			// Join as guest
			const joinRes = await request(app)
				.post(`/api/lobbies/${code}/join`)
				.set('Authorization', authHeader('guest1', 'Bob'))
				.send()

			expect(joinRes.status).toBe(200)
			expect(joinRes.body.lobby.code).toBe(code)
			expect(joinRes.body.lobby.isHost).toBe(false)
			expect(joinRes.body.lobby.maxPlayers).toBeDefined()
			expect(joinRes.body.token).toBeDefined()
		})

		it('returns 404 for unknown lobby code', async () => {
			const res = await request(app)
				.post('/api/lobbies/ZZZZZ/join')
				.set('Authorization', authHeader('guest1', 'Bob'))
				.send()

			expect(res.status).toBe(404)
		})
	})

	describe('POST /api/lobbies/:code/leave', () => {
		it('leaves a lobby and returns new token without lobbyCode', async () => {
			const createRes = await request(app)
				.post('/api/lobbies')
				.set('Authorization', authHeader('host1', 'Alice'))
				.send({ modId: 'mod1' })

			const code = createRes.body.lobby.code

			// Join as guest
			await request(app)
				.post(`/api/lobbies/${code}/join`)
				.set('Authorization', authHeader('guest1', 'Bob'))
				.send()

			// Guest leaves
			const leaveRes = await request(app)
				.post(`/api/lobbies/${code}/leave`)
				.set('Authorization', authHeader('guest1', 'Bob', code))
				.send()

			expect(leaveRes.status).toBe(200)
			expect(leaveRes.body.token).toBeDefined()
		})
	})

	describe('GET /api/lobbies/:code', () => {
		it('returns lobby info with maxPlayers', async () => {
			const createRes = await request(app)
				.post('/api/lobbies')
				.set('Authorization', authHeader('host1', 'Alice'))
				.send({ modId: 'mod1' })

			const code = createRes.body.lobby.code

			const getRes = await request(app)
				.get(`/api/lobbies/${code}`)
				.set('Authorization', authHeader('host1', 'Alice', code))

			expect(getRes.status).toBe(200)
			expect(getRes.body.lobby.code).toBe(code)
			expect(getRes.body.lobby.isHost).toBe(true)
			expect(getRes.body.lobby.maxPlayers).toBe(16)
		})

		it('returns 404 for unknown code', async () => {
			const res = await request(app)
				.get('/api/lobbies/ZZZZZ')
				.set('Authorization', authHeader('p1', 'Alice'))

			expect(res.status).toBe(404)
		})
	})

	describe('GET /api/lobbies/:code/players', () => {
		it('returns player list', async () => {
			const createRes = await request(app)
				.post('/api/lobbies')
				.set('Authorization', authHeader('host1', 'Alice'))
				.send({ modId: 'mod1' })

			const code = createRes.body.lobby.code

			await request(app)
				.post(`/api/lobbies/${code}/join`)
				.set('Authorization', authHeader('guest1', 'Bob'))
				.send()

			const playersRes = await request(app)
				.get(`/api/lobbies/${code}/players`)
				.set('Authorization', authHeader('host1', 'Alice', code))

			expect(playersRes.status).toBe(200)
			expect(playersRes.body.players).toHaveLength(2)
			expect(playersRes.body.players).toEqual(
				expect.arrayContaining([
					expect.objectContaining({ id: 'host1', displayName: 'Alice' }),
					expect.objectContaining({ id: 'guest1', displayName: 'Bob' }),
				]),
			)
		})
	})

	describe('PUT /api/lobbies/:code/metadata', () => {
		it('allows host to set metadata', async () => {
			const createRes = await request(app)
				.post('/api/lobbies')
				.set('Authorization', authHeader('host1', 'Alice'))
				.send({ modId: 'mod1' })

			const code = createRes.body.lobby.code

			const metaRes = await request(app)
				.put(`/api/lobbies/${code}/metadata`)
				.set('Authorization', authHeader('host1', 'Alice', code))
				.send({ metadata: { ante: 1, stake: 'gold' } })

			expect(metaRes.status).toBe(200)
			expect(metaRes.body.metadata).toEqual({ ante: 1, stake: 'gold' })
		})

		it('returns 403 for non-host', async () => {
			const createRes = await request(app)
				.post('/api/lobbies')
				.set('Authorization', authHeader('host1', 'Alice'))
				.send({ modId: 'mod1' })

			const code = createRes.body.lobby.code

			await request(app)
				.post(`/api/lobbies/${code}/join`)
				.set('Authorization', authHeader('guest1', 'Bob'))
				.send()

			const metaRes = await request(app)
				.put(`/api/lobbies/${code}/metadata`)
				.set('Authorization', authHeader('guest1', 'Bob', code))
				.send({ metadata: { ante: 99 } })

			expect(metaRes.status).toBe(403)
		})

		it('returns 400 without metadata field', async () => {
			const createRes = await request(app)
				.post('/api/lobbies')
				.set('Authorization', authHeader('host1', 'Alice'))
				.send({ modId: 'mod1' })

			const code = createRes.body.lobby.code

			const metaRes = await request(app)
				.put(`/api/lobbies/${code}/metadata`)
				.set('Authorization', authHeader('host1', 'Alice', code))
				.send({})

			expect(metaRes.status).toBe(400)
		})
	})
})
