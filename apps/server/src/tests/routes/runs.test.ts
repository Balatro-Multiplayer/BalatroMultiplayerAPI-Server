import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import { isModerator } from '../../infrastructure/gateways/player.gateway.js'
import * as replayLogGateway from '../../infrastructure/gateways/replay-log.gateway.js'
import { compressToBase64 } from '../../shared/utils/compression.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

const app = createTestApp()

function authHeader(playerId: string, steamName: string) {
	createSession(steamName, { id: playerId })
	return `Bearer ${signJwt({ playerId, steamName })}`
}

const run = {
	id: 'run-1',
	lobbyCode: 'ABCDE',
	modId: 'mod1',
	lobbyType: 'public',
	status: 'completed' as const,
	startedAt: new Date(),
	finalizedAt: new Date(),
}
const block = compressToBase64(
	JSON.stringify([
		[1, 'select_blind', [0, 'bl_small']],
		[2, 'buy', [1, 2, 3]],
		[3, 'end', { result: 'win' }],
	]),
)
const log = (playerId: string, sharedAt: Date | null) => ({
	playerId,
	compressedEvents: block,
	carbonHash: null,
	eventCount: 3,
	status: 'complete' as const,
	flagReason: null,
	sharedAt,
})

function mockRun(sharedAt: { p1: Date | null; p2: Date | null }) {
	vi.spyOn(replayLogGateway, 'getRunWithLogs').mockResolvedValue({
		run,
		logs: [log('p1', sharedAt.p1), log('p2', sharedAt.p2)],
	})
	vi.spyOn(replayLogGateway, 'getDisplayNames').mockResolvedValue(
		new Map([
			['p1', 'Alice'],
			['p2', 'Bob'],
		]),
	)
}

describe('runs routes', () => {
	describe('GET /:runId/replay', () => {
		it('returns 404 when the run does not exist', async () => {
			vi.spyOn(replayLogGateway, 'getRunWithLogs').mockResolvedValue(undefined)

			const res = await request(app)
				.get('/api/runs/missing-run/replay')
				.set('Authorization', authHeader('p1', 'Alice'))

			expect(res.status).toBe(404)
		})

		it('returns 401 for a bad token', async () => {
			mockRun({ p1: new Date(), p2: null })

			const res = await request(app)
				.get('/api/runs/run-1/replay')
				.set('Authorization', 'Bearer nonsense')

			expect(res.status).toBe(401)
		})

		it('returns 404 without login when nothing is shared', async () => {
			mockRun({ p1: null, p2: null })

			const res = await request(app).get('/api/runs/run-1/replay')

			expect(res.status).toBe(404)
		})

		it('returns 404 to a logged-in stranger when nothing is shared', async () => {
			mockRun({ p1: null, p2: null })

			const res = await request(app)
				.get('/api/runs/run-1/replay')
				.set('Authorization', authHeader('stranger', 'Eve'))

			expect(res.status).toBe(404)
		})

		it('gives the public shared sides in full and the others reduced', async () => {
			mockRun({ p1: new Date(), p2: null })

			const res = await request(app).get('/api/runs/run-1/replay')

			expect(res.status).toBe(200)
			expect(res.body.viewer).toEqual({ role: 'public' })
			expect(res.body.logs[0]).toMatchObject({
				playerId: 'p1',
				displayName: 'Alice',
				shared: true,
				hidden: false,
				compressedEvents: block,
			})
			expect(res.body.logs[1]).toMatchObject({
				playerId: 'p2',
				displayName: 'Bob',
				shared: false,
				hidden: true,
			})
			expect(res.body.logs[1].compressedEvents).not.toBe(block)
		})

		it('gives a participant every side in full', async () => {
			mockRun({ p1: new Date(), p2: null })

			const res = await request(app)
				.get('/api/runs/run-1/replay')
				.set('Authorization', authHeader('p2', 'Bob'))

			expect(res.status).toBe(200)
			expect(res.body.viewer).toEqual({ role: 'participant', playerId: 'p2' })
			expect(
				res.body.logs.every(
					(l: { hidden: boolean; compressedEvents: string }) =>
						!l.hidden && l.compressedEvents === block,
				),
			).toBe(true)
		})

		it('gives a moderator every side in full when nothing is shared', async () => {
			mockRun({ p1: null, p2: null })
			vi.mocked(isModerator).mockResolvedValue(true)

			const res = await request(app)
				.get('/api/runs/run-1/replay')
				.set('Authorization', authHeader('mod', 'Mod'))

			expect(res.status).toBe(200)
			expect(res.body.viewer).toEqual({ role: 'moderator', playerId: 'mod' })
			expect(
				res.body.logs.every(
					(l: { hidden: boolean; compressedEvents: string }) => !l.hidden,
				),
			).toBe(true)
		})
	})

	describe('POST and DELETE /:runId/share', () => {
		it('returns 401 without login', async () => {
			expect((await request(app).post('/api/runs/run-1/share')).status).toBe(
				401,
			)
			expect((await request(app).delete('/api/runs/run-1/share')).status).toBe(
				401,
			)
		})

		it('shares and unshares only the caller own row', async () => {
			const setShared = vi
				.spyOn(replayLogGateway, 'setShared')
				.mockResolvedValue(true)

			const shared = await request(app)
				.post('/api/runs/run-1/share')
				.set('Authorization', authHeader('p1', 'Alice'))
			const unshared = await request(app)
				.delete('/api/runs/run-1/share')
				.set('Authorization', authHeader('p1', 'Alice'))

			expect(shared.status).toBe(200)
			expect(shared.body).toEqual({ shared: true })
			expect(unshared.body).toEqual({ shared: false })
			expect(setShared).toHaveBeenNthCalledWith(1, 'run-1', 'p1', true)
			expect(setShared).toHaveBeenNthCalledWith(2, 'run-1', 'p1', false)
		})

		it('returns 404 when the caller has no row in the run', async () => {
			vi.spyOn(replayLogGateway, 'setShared').mockResolvedValue(false)

			const res = await request(app)
				.post('/api/runs/run-1/share')
				.set('Authorization', authHeader('stranger', 'Eve'))

			expect(res.status).toBe(404)
		})
	})
})
