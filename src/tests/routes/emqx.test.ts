import { describe, expect, it } from 'vitest'
import request from 'supertest'
import { createTestApp } from './app.js'
import { signJwt } from '../../services/auth.service.js'
import { Lobby, createSession, lobbies } from '../../state/index.js'

const app = createTestApp()

describe('EMQX webhook routes', () => {
	describe('POST /emqx/auth', () => {
		it('allows system client as superuser', async () => {
			const res = await request(app)
				.post('/emqx/auth')
				.send({
					clientid: 'bmp-api-server',
					username: 'bmp-system',
					password: 'test-emqx-password',
					peerhost: '127.0.0.1',
				})

			expect(res.status).toBe(200)
			expect(res.body).toEqual({ result: 'allow', is_superuser: true })
		})

		it('allows player with valid JWT and session', async () => {
			createSession('Alice', { id: 'steam1' })
			const token = signJwt({ playerId: 'steam1', steamName: 'Alice' })

			const res = await request(app)
				.post('/emqx/auth')
				.send({
					clientid: 'steam1',
					username: 'steam1',
					password: token,
					peerhost: '127.0.0.1',
				})

			expect(res.status).toBe(200)
			expect(res.body).toEqual({ result: 'allow', is_superuser: false })
		})

		it('denies invalid JWT', async () => {
			const res = await request(app)
				.post('/emqx/auth')
				.send({
					clientid: 'steam1',
					username: 'steam1',
					password: 'bad-token',
					peerhost: '127.0.0.1',
				})

			expect(res.status).toBe(200)
			expect(res.body.result).toBe('deny')
		})
	})

	describe('POST /emqx/authz', () => {
		it('allows lobby member to subscribe to metadata', async () => {
			const lobby = new Lobby('ABCDE', 'mod1', 'host1')
			lobbies.set('ABCDE', lobby)
			const session = createSession('Alice', { id: 'host1' })
			lobby.addPlayer(session)

			const res = await request(app)
				.post('/emqx/authz')
				.send({
					clientid: 'host1',
					username: 'host1',
					topic: 'lobby/ABCDE/metadata',
					action: 'subscribe',
					peerhost: '127.0.0.1',
				})

			expect(res.status).toBe(200)
			expect(res.body).toEqual({ result: 'allow' })
		})

		it('denies non-member', async () => {
			const lobby = new Lobby('ABCDE', 'mod1', 'host1')
			lobbies.set('ABCDE', lobby)
			const session = createSession('Alice', { id: 'host1' })
			lobby.addPlayer(session)

			createSession('Eve', { id: 'outsider' })

			const res = await request(app)
				.post('/emqx/authz')
				.send({
					clientid: 'outsider',
					username: 'outsider',
					topic: 'lobby/ABCDE/metadata',
					action: 'subscribe',
					peerhost: '127.0.0.1',
				})

			expect(res.status).toBe(200)
			expect(res.body).toEqual({ result: 'deny' })
		})

		it('denies publish to events (server-only topic)', async () => {
			const lobby = new Lobby('ABCDE', 'mod1', 'host1')
			lobbies.set('ABCDE', lobby)
			const session = createSession('Alice', { id: 'host1' })
			lobby.addPlayer(session)

			const res = await request(app)
				.post('/emqx/authz')
				.send({
					clientid: 'host1',
					username: 'host1',
					topic: 'lobby/ABCDE/events',
					action: 'publish',
					peerhost: '127.0.0.1',
				})

			expect(res.status).toBe(200)
			expect(res.body).toEqual({ result: 'deny' })
		})
	})
})
