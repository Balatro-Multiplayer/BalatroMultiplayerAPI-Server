import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import { recordStaffAction } from '../../infrastructure/gateways/staff-log.gateway.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import { err, ok } from '../../shared/utils/result.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

vi.mock('../../features/achievements/achievements-backfill.service.js', () => ({
	backfillAchievements: vi.fn(),
}))

import { backfillAchievements } from '../../features/achievements/achievements-backfill.service.js'

const app = createTestApp()

function authAs(playerId: string, privileges: string[]) {
	createSession(playerId, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({
		privileges,
	} as any)
	return `Bearer ${signJwt({ playerId, steamName: playerId })}`
}

const post = (auth: string) =>
	request(app)
		.post('/api/webadmin/achievements/backfill')
		.set('Authorization', auth)
		.send({ reason: 'new avatars' })

describe('POST /api/webadmin/achievements/backfill', () => {
	it('runs the backfill again for an admin, forced', async () => {
		vi.mocked(backfillAchievements).mockResolvedValue(
			ok({ filled: 2, skipped: 7, failed: 0 }),
		)
		const res = await post(authAs('ach-admin-1', ['admin']))
		expect(res.status).toBe(200)
		expect(res.body).toEqual({ ok: true, filled: 2, skipped: 7, failed: 0 })
		expect(backfillAchievements).toHaveBeenCalledWith({ force: true })
		expect(recordStaffAction).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ action: 'achievements_backfill', reason: 'new avatars' }),
		)
	})

	it('refuses a backfill with no reason', async () => {
		vi.mocked(backfillAchievements).mockClear()
		const res = await request(app)
			.post('/api/webadmin/achievements/backfill')
			.set('Authorization', authAs('ach-admin-4', ['admin']))
		expect(res.status).toBe(400)
		expect(backfillAchievements).not.toHaveBeenCalled()
	})

	it('is admin-only', async () => {
		vi.mocked(backfillAchievements).mockClear()
		expect((await post(authAs('ach-mod-1', ['moderator']))).status).toBe(403)
		expect(backfillAchievements).not.toHaveBeenCalled()
	})

	it('says why it could not run', async () => {
		vi.mocked(backfillAchievements).mockResolvedValue(err('off'))
		expect((await post(authAs('ach-admin-2', ['admin']))).status).toBe(409)
		vi.mocked(backfillAchievements).mockResolvedValue(err('unreachable'))
		expect((await post(authAs('ach-admin-3', ['admin']))).status).toBe(503)
	})
})
