import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import { replayLogService } from '../../features/replay-log/replay-log.service.js'
import { db } from '../../infrastructure/db/index.js'
import { createSession, lobbies } from '../../state/index.js'
import { Lobby } from '../../state/lobby.js'
import { createTestApp } from './app.js'

const app = createTestApp()

function authHeader(playerId: string, steamName: string) {
	createSession(steamName, { id: playerId })
	return `Bearer ${signJwt({ playerId, steamName })}`
}

// Mirrors the drizzle chain-mocking pattern used in matchmaking.service.test.ts
// (`db.select().from().where()`), since replay-log.gateway.ts isn't otherwise
// injectable at the route layer -- it's consumed via the replayLogService
// singleton.
function mockSelectChain(rows: unknown[]) {
	return vi.fn().mockReturnValue({
		from: vi.fn().mockReturnValue({
			where: vi.fn().mockResolvedValue(rows),
		}),
	})
}

// insertRun (called lazily by handleActionLogEvent on a lobby's first event)
// needs .values().returning() -- the base db mock in setup.ts only stubs
// .values() as a plain resolved promise (see runs.test.ts's mockSelectChain
// comment above for the same reasoning re: select).
function mockInsertReturningChain(row: { id: string }) {
	return vi.fn().mockReturnValue({
		values: vi.fn().mockReturnValue({
			returning: vi.fn().mockResolvedValue([row]),
		}),
	})
}

describe('runs routes', () => {
	describe('GET /:runId/replay', () => {
		it('returns 401 without auth', async () => {
			const res = await request(app).get('/api/runs/run-1/replay')
			expect(res.status).toBe(401)
		})

		it('returns 404 when the run does not exist', async () => {
			;(db as any).select = mockSelectChain([])

			const res = await request(app)
				.get('/api/runs/missing-run/replay')
				.set('Authorization', authHeader('p1', 'Alice'))

			expect(res.status).toBe(404)
		})

		it('returns 403 when the requester was not a participant', async () => {
			const runRow = {
				id: 'run-1',
				lobbyCode: 'ABCDE',
				modId: 'mod1',
				lobbyType: 'public',
				status: 'completed',
				startedAt: new Date(),
				finalizedAt: new Date(),
			}
			;(db as any).select = vi
				.fn()
				.mockReturnValueOnce({
					from: vi
						.fn()
						.mockReturnValue({ where: vi.fn().mockResolvedValue([runRow]) }),
				})
				.mockReturnValueOnce({
					from: vi.fn().mockReturnValue({
						where: vi.fn().mockResolvedValue([
							{
								playerId: 'p1',
								compressedEvents: 'x',
								carbonHash: null,
								eventCount: 1,
								status: 'complete',
							},
						]),
					}),
				})

			const res = await request(app)
				.get('/api/runs/run-1/replay')
				.set('Authorization', authHeader('someone-else', 'Bob'))

			expect(res.status).toBe(403)
		})

		it('returns the run for a participant', async () => {
			const runRow = {
				id: 'run-1',
				lobbyCode: 'ABCDE',
				modId: 'mod1',
				lobbyType: 'public',
				status: 'completed',
				startedAt: new Date(),
				finalizedAt: new Date(),
			}
			const logRow = {
				playerId: 'p1',
				compressedEvents: 'x',
				carbonHash: null,
				eventCount: 1,
				status: 'complete',
			}
			;(db as any).select = vi
				.fn()
				.mockReturnValueOnce({
					from: vi
						.fn()
						.mockReturnValue({ where: vi.fn().mockResolvedValue([runRow]) }),
				})
				.mockReturnValueOnce({
					from: vi
						.fn()
						.mockReturnValue({ where: vi.fn().mockResolvedValue([logRow]) }),
				})

			const res = await request(app)
				.get('/api/runs/run-1/replay')
				.set('Authorization', authHeader('p1', 'Alice'))

			expect(res.status).toBe(200)
			expect(res.body.run.id).toBe('run-1')
			expect(res.body.logs).toEqual([logRow])
		})
	})

	describe('GET /:lobbyCode/players/:playerId/tail', () => {
		it('returns 401 without auth', async () => {
			const res = await request(app).get('/api/runs/TAIL01/players/p1/tail')
			expect(res.status).toBe(401)
		})

		it('returns 404 when the lobby does not exist', async () => {
			const res = await request(app)
				.get('/api/runs/GHOST1/players/p1/tail')
				.set('Authorization', authHeader('p1', 'Alice'))

			expect(res.status).toBe(404)
		})

		it('returns 403 when the requester is not a member of the lobby', async () => {
			const lobby = new Lobby('TAIL02', 'mod1', 'p1', 16, 'public')
			lobby.addPlayer(createSession('Alice', { id: 'p1' }))
			lobbies.set('TAIL02', lobby)

			const res = await request(app)
				.get('/api/runs/TAIL02/players/p1/tail')
				.set('Authorization', authHeader('outsider', 'Mallory'))

			expect(res.status).toBe(403)
			lobbies.delete('TAIL02')
		})

		it('returns [] when nothing is buffered for the lobby', async () => {
			const lobby = new Lobby('TAIL03', 'mod1', 'p1', 16, 'public')
			lobby.addPlayer(createSession('Alice', { id: 'p1' }))
			lobbies.set('TAIL03', lobby)

			const res = await request(app)
				.get('/api/runs/TAIL03/players/p1/tail')
				.set('Authorization', authHeader('p1', 'Alice'))

			expect(res.status).toBe(200)
			expect(res.body.events).toEqual([])
			lobbies.delete('TAIL03')
		})

		it('returns only events after since_t', async () => {
			const lobby = new Lobby('TAIL04', 'mod1', 'p1', 16, 'public')
			lobby.addPlayer(createSession('Alice', { id: 'p1' }))
			lobby.addPlayer(createSession('Bob', { id: 'p2' }))
			lobbies.set('TAIL04', lobby)
			;(db as any).insert = mockInsertReturningChain({ id: 'run-tail-1' })

			await replayLogService.handleActionLogEvent('TAIL04', 'p2', {
				t: 10,
				opcode: 'select_blind',
				args: [0],
			})
			await replayLogService.handleActionLogEvent('TAIL04', 'p2', {
				t: 50,
				opcode: 'hand_result',
				args: ['1234', 3],
			})

			const res = await request(app)
				.get('/api/runs/TAIL04/players/p2/tail')
				.query({ since_t: 10 })
				.set('Authorization', authHeader('p1', 'Alice'))

			expect(res.status).toBe(200)
			expect(res.body.events).toEqual([
				{ t: 50, opcode: 'hand_result', args: ['1234', 3] },
			])
			lobbies.delete('TAIL04')
		})

		it('returns 400 when since_t is not a number', async () => {
			const lobby = new Lobby('TAIL05', 'mod1', 'p1', 16, 'public')
			lobby.addPlayer(createSession('Alice', { id: 'p1' }))
			lobbies.set('TAIL05', lobby)

			const res = await request(app)
				.get('/api/runs/TAIL05/players/p1/tail')
				.query({ since_t: 'not-a-number' })
				.set('Authorization', authHeader('p1', 'Alice'))

			expect(res.status).toBe(400)
			lobbies.delete('TAIL05')
		})
	})
})
