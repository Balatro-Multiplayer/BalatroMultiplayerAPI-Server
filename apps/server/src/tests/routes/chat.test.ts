import { afterEach, describe, expect, it } from 'vitest'
import request from 'supertest'
import { signJwt } from '../../features/auth/jwt.js'
import { createSession, lobbies } from '../../state/index.js'
import { Lobby } from '../../state/lobby.js'
import { getConfig, setConfig } from '../../state/config.js'
import { env } from '../../env.js'
import { createTestApp } from './app.js'

const app = createTestApp()

function makeAuthedPlayer(playerId: string, steamName: string) {
	const session = createSession(steamName, { id: playerId, chatEnabled: true })
	return { session, header: `Bearer ${signJwt({ playerId, steamName })}` }
}

function makeLobby(code: string, hostSession: ReturnType<typeof createSession>) {
	const lobby = new Lobby(code, 'mod1', hostSession.playerId, 16, 'public')
	lobby.addPlayer(hostSession)
	lobbies.set(code, lobby)
	return lobby
}

const originalNodeEnv = env.NODE_ENV
const originalConfig = getConfig()

describe('POST /api/lobbies/:code/chat', () => {
	afterEach(() => {
		;(env as { NODE_ENV: string }).NODE_ENV = originalNodeEnv
		setConfig(originalConfig)
	})

	it('sends a message when chat is enabled', async () => {
		setConfig({ ...originalConfig, chatEnabled: true })
		const { session, header } = makeAuthedPlayer('p1', 'Alice')
		makeLobby('CHAT01', session)

		const res = await request(app)
			.post('/api/lobbies/CHAT01/chat')
			.set('Authorization', header)
			.send({ message: 'hello there' })

		expect(res.status).toBe(200)
		expect(res.body.ok).toBe(true)
	})

	it('returns 403 when the global chat flag is off', async () => {
		setConfig({ ...originalConfig, chatEnabled: false })
		const { session, header } = makeAuthedPlayer('p2', 'Bob')
		makeLobby('CHAT02', session)

		const res = await request(app)
			.post('/api/lobbies/CHAT02/chat')
			.set('Authorization', header)
			.send({ message: 'hello there' })

		expect(res.status).toBe(403)
	})

	// §14.3: rate limiting is enforced entirely server-side. The limiter is
	// skipped outside production (see chatRateLimiter's `skip`) so the rest of
	// the suite isn't flaky -- exercise it explicitly here with NODE_ENV forced
	// to production, mirroring auth.test.ts's existing convention for the same
	// express-rate-limit gotcha.
	it('§14.3: throttles a player sending messages faster than the limit', async () => {
		setConfig({ ...originalConfig, chatEnabled: true })
		;(env as { NODE_ENV: string }).NODE_ENV = 'production'
		const { session, header } = makeAuthedPlayer('p3', 'Carol')
		makeLobby('CHAT03', session)

		const statuses: number[] = []
		for (let i = 0; i < 6; i++) {
			const res = await request(app)
				.post('/api/lobbies/CHAT03/chat')
				.set('Authorization', header)
				.send({ message: `message ${i}` })
			statuses.push(res.status)
		}

		expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200])
		expect(statuses[5]).toBe(429)
	})

	it('§14.3: does not rate-limit a different player sharing the same lobby', async () => {
		setConfig({ ...originalConfig, chatEnabled: true })
		;(env as { NODE_ENV: string }).NODE_ENV = 'production'
		const { session: hostSession, header: hostHeader } = makeAuthedPlayer('p4', 'Dave')
		const lobby = makeLobby('CHAT04', hostSession)
		const { session: guestSession, header: guestHeader } = makeAuthedPlayer('p5', 'Eve')
		lobby.addPlayer(guestSession)

		for (let i = 0; i < 6; i++) {
			await request(app)
				.post('/api/lobbies/CHAT04/chat')
				.set('Authorization', hostHeader)
				.send({ message: `spam ${i}` })
		}

		const res = await request(app)
			.post('/api/lobbies/CHAT04/chat')
			.set('Authorization', guestHeader)
			.send({ message: 'not spam' })

		expect(res.status).toBe(200)
	})
})
