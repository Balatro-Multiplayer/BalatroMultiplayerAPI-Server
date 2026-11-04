import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import { matchEditorFor } from '../../features/ratings/match-edit.deps.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import { recordStaffAction } from '../../infrastructure/gateways/staff-log.gateway.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

vi.mock('../../features/ratings/match-edit.deps.js', () => ({
	matchEditorFor: vi.fn(),
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
		vi.mocked(matchEditorFor).mockReset().mockReturnValue(edit)
	})

	it('keeps moderators and plain players out of the match page edit', async () => {
		for (const privileges of [['moderator'], []]) {
			const res = await request(app)
				.post('/api/webadmin/matches/m1/result')
				.set('Authorization', authAs('p1', privileges))
				.send(body)
			expect(res.status).toBe(403)
		}
		expect(edit).not.toHaveBeenCalled()
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
