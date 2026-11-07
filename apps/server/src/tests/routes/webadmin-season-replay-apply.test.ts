import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../../env.js'
import { signJwt } from '../../features/auth/jwt.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import * as ratingGateway from '../../infrastructure/gateways/rating.gateway.js'
import { err, ok } from '../../shared/utils/result.js'
import * as staffLog from '../../infrastructure/gateways/staff-log.gateway.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

const apply = vi.fn()
const restore = vi.fn()
vi.mock('../../features/ratings/season-replay-apply.deps.js', () => ({
	seasonReplayApplyFor: () => ({ apply, restore }),
}))
vi.mock('../../infrastructure/gateways/rating.gateway.js', () => ({
	getSeasonForReplay: vi.fn(),
}))

const app = createTestApp()
const startedAt = new Date('2026-06-01T00:00:00Z')

function authAs(playerId: string, privileges: string[]) {
	createSession(playerId, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({
		privileges,
	} as any)
	return `Bearer ${signJwt({ playerId, steamName: playerId })}`
}

const post = (path: string, auth: string, body: object = {}) =>
	request(app)
		.post(`/api/webadmin/ratings/season-replay/${path}`)
		.set('Authorization', auth)
		.send(body)

beforeEach(() => {
	env.OWNER_PLAYER_ID = 'owner-1'
	apply.mockReset()
	restore.mockReset()
	vi.mocked(ratingGateway.getSeasonForReplay).mockResolvedValue({
		id: 1,
		name: 'Season 1',
		startedAt,
	})
})

describe('POST /ratings/season-replay/apply', () => {
	it('applies for the owner with the token from the dry run', async () => {
		apply.mockResolvedValue(ok({ backupId: 'b1', games: 3 }))
		const res = await post('apply', authAs('owner-1', ['admin']), {
			token: 'abc',
			reason: 'Rules changed',
		})
		expect(res.status).toBe(200)
		expect(res.body).toEqual({ backupId: 'b1', games: 3 })
		expect(apply).toHaveBeenCalledWith(
			{ id: 1, name: 'Season 1', startedAt },
			'abc',
			'owner-1',
		)
	})

	it('refuses another admin', async () => {
		expect(
			(await post('apply', authAs('admin-2', ['admin']), { token: 'abc' }))
				.status,
		).toBe(403)
		expect(apply).not.toHaveBeenCalled()
	})

	it('needs the token', async () => {
		expect((await post('apply', authAs('owner-1', ['admin']))).status).toBe(400)
		expect(apply).not.toHaveBeenCalled()
	})

	it('shows the active game count and refuses', async () => {
		apply.mockResolvedValue(err({ code: 'active_games', count: 3 }))
		const res = await post('apply', authAs('owner-1', ['admin']), {
			token: 'abc',
			reason: 'Rules changed',
		})
		expect(res.status).toBe(409)
		expect(res.body).toMatchObject({ code: 'active_games', activeGames: 3 })
	})

	it('refuses a token that no longer matches', async () => {
		apply.mockResolvedValue(err({ code: 'stale_token' }))
		const res = await post('apply', authAs('owner-1', ['admin']), {
			token: 'abc',
			reason: 'Rules changed',
		})
		expect(res.status).toBe(409)
		expect(res.body.code).toBe('stale_token')
	})
})

describe('the staff log', () => {
	it('refuses an apply with no reason and changes nothing', async () => {
		const res = await post('apply', authAs('owner-1', ['admin']), { token: 'abc' })
		expect(res.status).toBe(400)
		expect(apply).not.toHaveBeenCalled()
	})

	it('logs an apply with its reason and backup', async () => {
		apply.mockResolvedValue(ok({ backupId: 'b1', games: 3 }))
		vi.mocked(staffLog.recordStaffAction).mockClear()
		await post('apply', authAs('owner-1', ['admin']), { token: 'abc', reason: 'Rules changed' })
		expect(staffLog.recordStaffAction).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({
				action: 'season_replay_apply',
				reason: 'Rules changed',
				detail: expect.objectContaining({ result: { backupId: 'b1', games: 3 } }),
			}),
		)
	})

	it('refuses a restore with no reason and logs one with a reason', async () => {
		restore.mockResolvedValue(ok({ season: 1 }))
		expect((await post('restore', authAs('owner-1', ['admin']), { backupId: 'b1' })).status).toBe(400)
		expect(restore).not.toHaveBeenCalled()
		vi.mocked(staffLog.recordStaffAction).mockClear()
		await post('restore', authAs('owner-1', ['admin']), { backupId: 'b1', reason: 'Bad replay' })
		expect(staffLog.recordStaffAction).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ action: 'season_replay_restore', reason: 'Bad replay' }),
		)
	})
})

describe('POST /ratings/season-replay/restore', () => {
	it('restores for the owner only', async () => {
		restore.mockResolvedValue(ok({ season: 1 }))
		expect(
			(await post('restore', authAs('admin-2', ['admin']), { backupId: 'b1' }))
				.status,
		).toBe(403)
		const res = await post('restore', authAs('owner-1', ['admin']), {
			backupId: 'b1',
			reason: 'Bad replay',
		})
		expect(res.status).toBe(200)
		expect(restore).toHaveBeenCalledWith('b1')
	})
})
