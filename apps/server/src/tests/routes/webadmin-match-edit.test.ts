import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as matchStaff from '../../infrastructure/gateways/match-staff.gateway.js'
import * as queueGateway from '../../infrastructure/gateways/service-queue.gateway.js'
import { signJwt } from '../../features/auth/jwt.js'
import { matchEditorFor } from '../../features/ratings/match-edit.deps.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import { recordStaffAction } from '../../infrastructure/gateways/staff-log.gateway.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

vi.mock('../../features/ratings/match-edit.deps.js', () => ({
	matchEditorFor: vi.fn(),
}))

vi.mock('../../infrastructure/gateways/match-staff.gateway.js', () => ({
	hasOpenItemVisibleTo: vi.fn(),
	listOpenItemsAboutRun: vi.fn(),
	findRunWindow: vi.fn(),
}))
vi.mock('../../infrastructure/gateways/service-queue.gateway.js', async (importOriginal) => ({
	...(await importOriginal<typeof import('../../infrastructure/gateways/service-queue.gateway.js')>()),
	enqueueServiceQueueItem: vi.fn(),
	markServiceQueueItemResolved: vi.fn(),
	recordItemEvent: vi.fn(),
}))

const app = createTestApp()
const edited = {
	kind: 'edited',
	rerated: true,
	summary: { previous: [], next: [], ratingChanges: [] },
}

function authAs(playerId: string, privileges: string[]) {
	createSession(playerId, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({
		id: playerId,
		privileges,
	} as any)
	return `Bearer ${signJwt({ playerId, steamName: playerId })}`
}

const body = {
	reason: 'wrongful forfeit',
	placements: [
		{ playerId: 'a', place: 1 },
		{ playerId: 'b', place: 2 },
	],
}

describe('match edit routes', () => {
	const edit = vi.fn()
	beforeEach(() => {
		edit.mockReset().mockResolvedValue(edited)
		vi.mocked(matchStaff.hasOpenItemVisibleTo).mockReset()
		vi.mocked(matchStaff.listOpenItemsAboutRun).mockReset().mockResolvedValue([])
		vi.mocked(queueGateway.markServiceQueueItemResolved).mockReset()
		vi.mocked(matchEditorFor).mockReset().mockReturnValue(edit)
	})

	it('keeps plain players out of the match page edit', async () => {
		const res = await request(app)
			.post('/api/webadmin/matches/m1/result')
			.set('Authorization', authAs('p1', []))
			.send(body)
		expect(res.status).toBe(403)
		expect(edit).not.toHaveBeenCalled()
	})

	it('refuses a moderator when the match has no open queue item', async () => {
		vi.mocked(matchStaff.hasOpenItemVisibleTo).mockResolvedValue(false)
		for (const [path, payload] of [
			['result', body],
			['void', { reason: 'x' }],
		] as const) {
			const res = await request(app)
				.post(`/api/webadmin/matches/m1/${path}`)
				.set('Authorization', authAs('mod', ['moderator']))
				.send(payload)
			expect(res.status).toBe(403)
		}
		expect(matchStaff.hasOpenItemVisibleTo).toHaveBeenCalledWith('m1', 'moderator', undefined)
		expect(edit).not.toHaveBeenCalled()
	})

	it('lets a moderator edit while the match has an open queue item', async () => {
		vi.mocked(matchStaff.hasOpenItemVisibleTo).mockResolvedValue(true)
		const res = await request(app)
			.post('/api/webadmin/matches/m1/void')
			.set('Authorization', authAs('mod', ['moderator']))
			.send({ reason: 'cheating' })
		expect(res.status).toBe(200)
		expect(edit).toHaveBeenCalled()
	})

	it('checks a moderator again inside the edit transaction', async () => {
		vi.mocked(matchStaff.hasOpenItemVisibleTo).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
		vi.mocked(matchEditorFor).mockImplementation(
			(inTransaction) => (async () => {
				await inTransaction?.('tx' as any, { resultPlacements: [] } as any, [])
				return edited
			}) as any,
		)
		const res = await request(app)
			.post('/api/webadmin/matches/m1/void')
			.set('Authorization', authAs('mod', ['moderator']))
			.send({ reason: 'cheating' })
		expect(res.status).toBe(403)
		expect(matchStaff.hasOpenItemVisibleTo).toHaveBeenLastCalledWith('m1', 'moderator', 'tx')
		expect(recordStaffAction).not.toHaveBeenCalled()
	})

	it('lets an admin edit with no open queue item, without asking', async () => {
		const res = await request(app)
			.post('/api/webadmin/matches/m1/void')
			.set('Authorization', authAs('adm', ['admin']))
			.send({ reason: 'cheating' })
		expect(res.status).toBe(200)
		expect(matchStaff.hasOpenItemVisibleTo).not.toHaveBeenCalled()
	})

	it('closes every open item about the match inside the void transaction', async () => {
		vi.mocked(matchStaff.listOpenItemsAboutRun).mockResolvedValue([
			{ id: 7, itemType: 'contest', sourceId: 'm1' },
			{ id: 8, itemType: 'staff_report', sourceId: 'm1:1' },
		] as any)
		vi.mocked(queueGateway.markServiceQueueItemResolved).mockResolvedValue({} as any)
		await request(app)
			.post('/api/webadmin/matches/m1/void')
			.set('Authorization', authAs('adm', ['admin']))
			.send({ reason: 'cheating' })
		const log = vi.mocked(matchEditorFor).mock.calls[0][0] as (...a: unknown[]) => Promise<void>
		await log('tx', { resultPlacements: null }, [])
		const resolved = vi.mocked(queueGateway.markServiceQueueItemResolved).mock.calls
		expect(resolved.map((c) => [c[0], c[1], c[2], c[3], c[4]])).toEqual([
			['tx', 7, 'admin:adm', 'void', 'cheating'],
			['tx', 8, 'admin:adm', 'void', 'cheating'],
		])
		expect(vi.mocked(recordStaffAction)).toHaveBeenCalledTimes(1)
	})

	it('does not close items when the result is set, not voided', async () => {
		await request(app)
			.post('/api/webadmin/matches/m1/result')
			.set('Authorization', authAs('adm', ['admin']))
			.send(body)
		const log = vi.mocked(matchEditorFor).mock.calls[0][0] as (...a: unknown[]) => Promise<void>
		await log('tx', { resultPlacements: null }, [])
		expect(matchStaff.listOpenItemsAboutRun).not.toHaveBeenCalled()
	})

	describe('report to admins', () => {
		beforeEach(() => {
			vi.mocked(matchStaff.findRunWindow).mockResolvedValue({ runId: 'm1' } as any)
			vi.mocked(queueGateway.enqueueServiceQueueItem).mockReset().mockResolvedValue({} as any)
		})

		it('makes a staff report item from a moderator note', async () => {
			const res = await request(app)
				.post('/api/webadmin/matches/m1/report')
				.set('Authorization', authAs('mod', ['moderator']))
				.send({ note: 'looks rigged' })
			expect(res.status).toBe(201)
			expect(queueGateway.enqueueServiceQueueItem).toHaveBeenCalledWith(
				expect.objectContaining({
					itemType: 'staff_report',
					sourceId: expect.stringMatching(/^m1:\d+$/),
					context: { staffReport: { runId: 'm1', reporterId: 'mod', note: 'looks rigged' } },
				}),
			)
		})

		it('needs a note', async () => {
			const res = await request(app)
				.post('/api/webadmin/matches/m1/report')
				.set('Authorization', authAs('mod', ['moderator']))
				.send({})
			expect(res.status).toBe(400)
			expect(queueGateway.enqueueServiceQueueItem).not.toHaveBeenCalled()
		})

		it('keeps plain players out', async () => {
			const res = await request(app)
				.post('/api/webadmin/matches/m1/report')
				.set('Authorization', authAs('p1', []))
				.send({ note: 'x' })
			expect(res.status).toBe(403)
		})

		it('answers 404 for an unknown match', async () => {
			vi.mocked(matchStaff.findRunWindow).mockResolvedValue(null)
			const res = await request(app)
				.post('/api/webadmin/matches/m1/report')
				.set('Authorization', authAs('mod', ['moderator']))
				.send({ note: 'x' })
			expect(res.status).toBe(404)
		})
	})

	it('lets an admin set a result with a reason', async () => {
		const res = await request(app)
			.post('/api/webadmin/matches/m1/result')
			.set('Authorization', authAs('adm', ['admin']))
			.send(body)
		expect(res.status).toBe(200)
		expect(edit).toHaveBeenCalledWith(
			{ runId: 'm1', matchmade: true },
			{ kind: 'result', placements: body.placements },
		)
	})

	it('lets an admin void, and logs inside the edit transaction', async () => {
		const res = await request(app)
			.post('/api/webadmin/matches/m1/void')
			.set('Authorization', authAs('adm', ['admin']))
			.send({ reason: 'cheating' })
		expect(res.status).toBe(200)
		expect(edit).toHaveBeenCalledWith(
			{ runId: 'm1', matchmade: true },
			{ kind: 'void' },
		)
		const log = vi.mocked(matchEditorFor).mock.calls[0][0] as (
			tx: unknown,
			m: unknown,
			c: unknown,
		) => Promise<void>
		await log('tx', { resultPlacements: body.placements }, [
			{ playerId: 'a', rating: 20 },
		])
		expect(vi.mocked(recordStaffAction)).toHaveBeenCalledWith(
			'tx',
			expect.objectContaining({
				action: 'match_void',
				reason: 'cheating',
				staff: { playerId: 'adm', role: 'admin' },
				detail: {
					matchId: 'm1',
					previous: body.placements,
					next: null,
					ratingChanges: [{ playerId: 'a', rating: 20 }],
				},
			}),
		)
	})

	it('needs a reason and a valid result', async () => {
		const token = authAs('adm', ['admin'])
		expect(
			(
				await request(app)
					.post('/api/webadmin/matches/m1/void')
					.set('Authorization', token)
					.send({})
			).status,
		).toBe(400)
		const bad = await request(app)
			.post('/api/webadmin/matches/m1/result')
			.set('Authorization', token)
			.send({ reason: 'x', placements: [{ playerId: 'a', place: 1 }] })
		expect(bad.status).toBe(400)
		expect(edit).not.toHaveBeenCalled()
	})

	it('maps refusals to statuses', async () => {
		const token = authAs('adm', ['admin'])
		const call = () =>
			request(app)
				.post('/api/webadmin/matches/m1/void')
				.set('Authorization', token)
				.send({ reason: 'x' })
		edit.mockResolvedValueOnce({ kind: 'not_found' })
		expect((await call()).status).toBe(404)
		edit.mockResolvedValueOnce({ kind: 'not_resolved', status: 'active' })
		expect((await call()).status).toBe(409)
		edit.mockResolvedValueOnce({ kind: 'failed', reason: 'down' })
		expect((await call()).status).toBe(502)
	})
})
