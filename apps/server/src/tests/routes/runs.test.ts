import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import { db } from '../../infrastructure/db/index.js'
import { createSession } from '../../state/index.js'
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
})
