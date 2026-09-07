import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import * as modsSyncService from '../../features/mods/mods-sync.service.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

vi.mock('../../features/mods/mods-sync.service.js', () => ({
	syncModRegistry: vi.fn(),
}))

const app = createTestApp()

function authAsModerator(playerId: string, steamName: string) {
	createSession(steamName, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({
		privileges: ['moderator'],
	} as any)
	return `Bearer ${signJwt({ playerId, steamName })}`
}

function authAsAdmin(playerId: string, steamName: string) {
	createSession(steamName, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({
		privileges: ['admin'],
	} as any)
	return `Bearer ${signJwt({ playerId, steamName })}`
}

describe('POST /api/webadmin/mods/sync', () => {
	it('returns 403 for a moderator (admin-only, same shape as the ranked-mods toggle)', async () => {
		const token = authAsModerator('mod-sync-1', 'Mod')
		const res = await request(app)
			.post('/api/webadmin/mods/sync')
			.set('Authorization', token)

		expect(res.status).toBe(403)
		expect(modsSyncService.syncModRegistry).not.toHaveBeenCalled()
	})

	it('runs the sync and returns its summary for an admin', async () => {
		vi.mocked(modsSyncService.syncModRegistry).mockResolvedValue({
			modsSynced: 855,
			hashed: 3,
			pruned: 1,
			skipped: 2,
			idCollisions: 1,
			versionsChecked: 4,
			thunderstoreOk: true,
			thunderstoreFetched: 120,
			thunderstoreMatched: 12,
			thunderstoreNew: 43,
		})

		const token = authAsAdmin('admin-sync-1', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/mods/sync')
			.set('Authorization', token)

		expect(res.status).toBe(200)
		expect(res.body).toEqual({
			ok: true,
			modsSynced: 855,
			hashed: 3,
			pruned: 1,
			skipped: 2,
			idCollisions: 1,
			versionsChecked: 4,
			thunderstoreOk: true,
			thunderstoreFetched: 120,
			thunderstoreMatched: 12,
			thunderstoreNew: 43,
		})
		expect(modsSyncService.syncModRegistry).toHaveBeenCalledTimes(1)
	})

	it('propagates a sync failure as a 500 rather than swallowing it', async () => {
		vi.mocked(modsSyncService.syncModRegistry).mockRejectedValue(
			new Error('upstream mod index zip fetch failed: 503'),
		)

		const token = authAsAdmin('admin-sync-2', 'Admin2')
		const res = await request(app)
			.post('/api/webadmin/mods/sync')
			.set('Authorization', token)

		expect(res.status).toBe(500)
	})
})
