import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createTestApp } from './app.js'
import { signJwt } from '../../services/auth.service.js'
import { createSession } from '../../state/index.js'
import { getLobby } from '../../state/index.js'
import * as lobbyService from '../../services/lobby.service.js'

const app = createTestApp()

function authHeader(
	playerId: string,
	steamName: string,
	lobbyCode?: string,
	opts?: { chatEnabled?: boolean },
) {
	createSession(steamName, { id: playerId, chatEnabled: opts?.chatEnabled ?? false })
	const token = signJwt({ playerId, steamName, lobbyCode })
	return `Bearer ${token}`
}

async function createLobby(hostId: string, hostName: string) {
	const res = await request(app)
		.post('/api/lobbies')
		.set('Authorization', authHeader(hostId, hostName))
		.send({ modId: 'mod1' })
	return res.body.lobby.code as string
}

describe('POST /api/lobbies/:code/report', () => {
	it('returns 401 without auth', async () => {
		const code = await createLobby('host1', 'Alice')
		const res = await request(app)
			.post(`/api/lobbies/${code}/report`)
			.send({ reportedPlayerId: 'guest1', type: 'harassment' })
		expect(res.status).toBe(401)
	})

	it('returns 404 for unknown lobby code', async () => {
		const res = await request(app)
			.post('/api/lobbies/ZZZZZ/report')
			.set('Authorization', authHeader('p1', 'Alice'))
			.send({ reportedPlayerId: 'guest1', type: 'harassment' })
		expect(res.status).toBe(404)
	})

	it('returns 403 if reporter is not in the lobby', async () => {
		const code = await createLobby('host1', 'Alice')
		const res = await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('outsider', 'Eve'))
			.send({ reportedPlayerId: 'host1', type: 'harassment' })
		expect(res.status).toBe(403)
	})

	it('returns 400 if reportedPlayerId is missing', async () => {
		const code = await createLobby('host1', 'Alice')
		const res = await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ type: 'harassment' })
		expect(res.status).toBe(400)
	})

	it('returns 400 if type is missing', async () => {
		const code = await createLobby('host1', 'Alice')
		const res = await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ reportedPlayerId: 'guest1' })
		expect(res.status).toBe(400)
	})

	it('returns 400 if type exceeds 64 characters', async () => {
		const code = await createLobby('host1', 'Alice')
		const res = await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ reportedPlayerId: 'guest1', type: 'x'.repeat(65) })
		expect(res.status).toBe(400)
	})

	it('returns 400 if message exceeds 500 characters', async () => {
		const code = await createLobby('host1', 'Alice')
		const res = await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ reportedPlayerId: 'guest1', type: 'harassment', message: 'x'.repeat(501) })
		expect(res.status).toBe(400)
	})

	it('accepts a report without an optional message', async () => {
		const code = await createLobby('host1', 'Alice')
		const res = await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ reportedPlayerId: 'guest1', type: 'cheating' })
		expect(res.status).toBe(200)
		expect(res.body.ok).toBe(true)
	})

	it('accepts a report with an optional message', async () => {
		const code = await createLobby('host1', 'Alice')
		const res = await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ reportedPlayerId: 'guest1', type: 'harassment', message: 'They were being rude' })
		expect(res.status).toBe(200)
		expect(res.body.ok).toBe(true)
	})

	it('marks the lobby as reported after first report', async () => {
		const code = await createLobby('host1', 'Alice')
		await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ reportedPlayerId: 'guest1', type: 'harassment' })

		const lobby = getLobby(code)
		expect(lobby?.isReported).toBe(true)
	})

	it('allows reporting a player who has already left the lobby', async () => {
		const code = await createLobby('host1', 'Alice')
		// guest1 is just a player ID — they don't need to be in the lobby currently
		const res = await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ reportedPlayerId: 'former-player-id', type: 'harassment' })
		expect(res.status).toBe(200)
	})

	it('flushes message buffer to DB on first report', async () => {
		const { db } = await import('../../db/index.js')
		const code = await createLobby('host1', 'Alice')

		// Manually populate the buffer
		const lobby = getLobby(code)!
		lobby.bufferMessage({ playerId: 'host1', displayName: 'Alice', message: 'hello', sentAt: new Date() })
		lobby.bufferMessage({ playerId: 'guest1', displayName: 'Bob', message: 'hi', sentAt: new Date() })

		vi.mocked(db.insert).mockClear()

		await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ reportedPlayerId: 'guest1', type: 'harassment' })

		// Should have called insert twice: once for the report, once for the buffer flush
		expect(vi.mocked(db.insert)).toHaveBeenCalledTimes(2)
	})

	it('does not flush buffer again on subsequent reports', async () => {
		const { db } = await import('../../db/index.js')
		const code = await createLobby('host1', 'Alice')

		const lobby = getLobby(code)!
		lobby.bufferMessage({ playerId: 'host1', displayName: 'Alice', message: 'hello', sentAt: new Date() })

		// First report — marks lobby + flushes buffer
		await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ reportedPlayerId: 'guest1', type: 'harassment' })

		vi.mocked(db.insert).mockClear()

		// Second report — only inserts the report row
		await request(app)
			.post(`/api/lobbies/${code}/report`)
			.set('Authorization', authHeader('host1', 'Alice', code))
			.send({ reportedPlayerId: 'guest2', type: 'cheating' })

		expect(vi.mocked(db.insert)).toHaveBeenCalledTimes(1)
	})
})
