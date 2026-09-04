import { describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { createTestApp } from './app.js'
import { signJwt } from '../../features/auth/jwt.js'
import { createSession, sessions } from '../../state/index.js'
import { queues, playerQueues } from '../../state/matchmaking.js'
import { findPlayerById } from '../../infrastructure/gateways/player.gateway.js'
import type { PlayerRecord } from '../../contracts/IPlayerRepository.js'

const app = createTestApp()

// A server restart wipes ALL in-memory state at once: sessions AND the queue
// maps. (The JWT is stateless and survives on the client.)
function simulateRestart(): void {
	sessions.clear()
	queues.clear()
	playerQueues.clear()
}

const QUEUE_BODY = { modId: 'mod1', gameMode: 'mode1', minPlayers: 2, maxPlayers: 4 }

function dbPlayer(id: string, steamName: string): PlayerRecord {
	return {
		id,
		steamIdHash: 'hash',
		discordIdHash: null,
		discordUsername: null,
		useDiscordName: false,
		preferredJoker: 'j_joker',
		privileges: [],
		steamName,
		chatEnabled: false,
		chatBlocked: false,
		tosAcceptedVersion: 0,
	} as PlayerRecord
}

// Regression coverage for issue #32.
//
// A valid JWT outlives its in-memory session (the session Map is wiped on a
// server restart, and the EMQX disconnect webhook reaps a non-lobby player).
// Matchmaking used a strict getSession() that 401'd such a player with no way
// to recover. The fix routes the lookup through ensureSession(), which rebuilds
// the session from the durable player record.
describe('issue #32: matchmaking self-heals a lost session', () => {
	it('queues normally while the in-memory session exists', async () => {
		const playerId = 'p-live'
		createSession('Alice', { id: playerId })
		const token = signJwt({ playerId, steamName: 'Alice' })

		const res = await request(app)
			.post('/api/matchmaking/queue')
			.set('Authorization', `Bearer ${token}`)
			.send(QUEUE_BODY)

		expect(res.status).toBe(200)
	})

	it('rebuilds the session from the DB and re-queues with the SAME token after the map is wiped', async () => {
		const playerId = 'p-known'
		createSession('Alice', { id: playerId })
		const token = signJwt({ playerId, steamName: 'Alice' })

		// token works right now
		const ok = await request(app)
			.post('/api/matchmaking/queue')
			.set('Authorization', `Bearer ${token}`)
			.send(QUEUE_BODY)
		expect(ok.status).toBe(200)

		// session reaped (restart / disconnect webhook). JWT is unchanged.
		simulateRestart()

		// the player still exists in the durable store
		vi.mocked(findPlayerById).mockResolvedValueOnce(dbPlayer(playerId, 'Alice'))

		const res = await request(app)
			.post('/api/matchmaking/queue')
			.set('Authorization', `Bearer ${token}`)
			.send(QUEUE_BODY)

		// Before the fix this was 401 "Session not found". Now it self-heals.
		expect(res.status).toBe(200)
		// and the session really was rebuilt in memory
		expect(sessions.has(playerId)).toBe(true)
	})

	it('rejects with 404 when the player does not exist in the DB at all', async () => {
		const playerId = 'p-ghost'
		createSession('Ghost', { id: playerId })
		const token = signJwt({ playerId, steamName: 'Ghost' })

		simulateRestart()
		// default gateway mock already resolves findPlayerById -> null
		vi.mocked(findPlayerById).mockResolvedValueOnce(null)

		const res = await request(app)
			.post('/api/matchmaking/queue')
			.set('Authorization', `Bearer ${token}`)
			.send(QUEUE_BODY)

		expect(res.status).toBe(404)
		expect(res.body.error ?? res.body.message ?? '').toMatch(/player not found/i)
	})
})
