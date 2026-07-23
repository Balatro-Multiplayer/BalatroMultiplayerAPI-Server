import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import { db } from '../../infrastructure/db/index.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

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

describe('PATCH /api/webadmin/players/:id/privileges', () => {
	it('returns 403 when the requester holds only moderator (cannot grant privileges, including to itself)', async () => {
		const token = authAsModerator('mod-1', 'Mod')
		const res = await request(app)
			.patch('/api/webadmin/players/mod-1/privileges')
			.set('Authorization', token)
			.send({ privileges: ['moderator', 'admin'] })

		expect(res.status).toBe(403)
	})

	it('returns 200 and applies the update when the requester is an admin', async () => {
		const token = authAsAdmin('admin-1', 'Admin')
		;(db as any).update = vi.fn().mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					returning: vi.fn().mockResolvedValue([{ id: 'target-1', privileges: ['moderator'] }]),
				}),
			}),
		})

		const res = await request(app)
			.patch('/api/webadmin/players/target-1/privileges')
			.set('Authorization', token)
			.send({ privileges: ['moderator'] })

		expect(res.status).toBe(200)
		expect(res.body.privileges).toEqual(['moderator'])
	})
})

describe('duplicate ban route removal', () => {
	it('the old secret-gated /admin/players/:id/bans route no longer exists', async () => {
		const res = await request(app)
			.get('/admin/players/some-id/bans')
			.set('x-admin-secret', process.env.ADMIN_SECRET ?? '')
		expect(res.status).toBe(404)
	})

	it('the webadmin player detail route (which includes bans) still works for a privileged player', async () => {
		const token = authAsAdmin('admin-2', 'Admin')
		// listBans is mocked to [] by the global ban.gateway.js mock (tests/setup.ts);
		// findPlayerById's persistent mock (set by authAsAdmin) covers both the
		// webAdmin gate's own lookup and this route's target-player lookup.
		const res = await request(app).get('/api/webadmin/players/some-id').set('Authorization', token)
		expect(res.status).not.toBe(404)
	})
})
