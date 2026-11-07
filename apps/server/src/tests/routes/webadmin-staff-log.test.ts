import { PgDialect } from 'drizzle-orm/pg-core'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { itemTypesVisibleTo } from '../../features/service-queue/permissions.js'
import { signJwt } from '../../features/auth/jwt.js'
import { db } from '../../infrastructure/db/index.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import { listStaffLog } from '../../infrastructure/gateways/staff-log.gateway.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

const app = createTestApp()

function authAs(playerId: string, privileges: string[]) {
	createSession(playerId, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({ privileges } as any)
	return `Bearer ${signJwt({ playerId, steamName: playerId })}`
}

describe('GET /api/webadmin/staff-log', () => {
	it('gives a player with no staff role nothing', async () => {
		const res = await request(app).get('/api/webadmin/staff-log').set('Authorization', authAs('plain', []))
		expect(res.status).toBe(403)
		expect(vi.mocked(listStaffLog)).not.toHaveBeenCalled()
	})

	it('reads as the viewer and passes the filters on', async () => {
		vi.mocked(listStaffLog).mockResolvedValue({ entries: [{ id: 1, reason: 'spam' } as any], total: 1 })
		const res = await request(app)
			.get('/api/webadmin/staff-log')
			.query({ staff: 'Ann', player: 'Bob', action: 'chat_ban', from: '2026-10-01', to: '2026-10-08' })
			.set('Authorization', authAs('mod-1', ['moderator']))
		expect(res.status).toBe(200)
		expect(res.body.entries).toEqual([{ id: 1, reason: 'spam' }])
		expect(vi.mocked(listStaffLog)).toHaveBeenCalledWith(
			{ playerId: 'mod-1', role: 'moderator' },
			expect.objectContaining({
				staff: 'Ann',
				player: 'Bob',
				action: 'chat_ban',
				from: new Date('2026-10-01'),
				to: new Date('2026-10-08'),
			}),
		)
	})

	it('refuses an unknown action and a bad date', async () => {
		const token = authAs('adm-1', ['admin'])
		expect((await request(app).get('/api/webadmin/staff-log').query({ action: 'smite' }).set('Authorization', token)).status).toBe(400)
		expect((await request(app).get('/api/webadmin/staff-log').query({ from: 'soon' }).set('Authorization', token)).status).toBe(400)
	})
})

// The moderator rule lives in the query, so check the SQL the gateway builds.
describe('the staff log query', () => {
	const dialect = new PgDialect()
	async function whereOf(viewer: { playerId: string; role: 'moderator' | 'admin' }) {
		const wheres: unknown[] = []
		vi.mocked(db.select).mockImplementation((() => {
			const chain: any = {}
			for (const m of ['from', 'leftJoin', 'orderBy', 'limit', 'offset'])
				chain[m] = vi.fn(() => chain)
			chain.where = vi.fn((condition: unknown) => {
				wheres.push(condition)
				return chain
			})
			chain.then = (resolve: (rows: unknown[]) => void) => resolve([{ total: 0 }])
			return chain
		}) as any)
		const { listStaffLog: real } = await vi.importActual<typeof import('../../infrastructure/gateways/staff-log.gateway.js')>(
			'../../infrastructure/gateways/staff-log.gateway.js',
		)
		await real(viewer, { page: 1, limit: 50, staff: '00000000-0000-4000-8000-000000000001' })
		return dialect.sqlToQuery(wheres[0] as any)
	}

	it("limits a moderator to their own entries and the entries on queue items", async () => {
		const { sql, params } = await whereOf({ playerId: 'mod-1', role: 'moderator' })
		expect(sql).toContain('"item_id" is not null')
		expect(sql).toContain('exists (select')
		expect(sql).toContain('"service_queue_items"."id" = "staff_log"."item_id"')
		expect(sql).toMatch(/"item_type" in \(/)
		for (const type of itemTypesVisibleTo('moderator')) expect(params).toContain(type)
		expect(sql).toMatch(/"staff_player_id" = \$\d+ or/)
		expect(params).toContain('mod-1')
	})

	it('shows a moderator every item type, appeals included', () => {
		expect(itemTypesVisibleTo('moderator')).toEqual(expect.arrayContaining(['report', 'anti_cheat', 'appeal']))
	})

	it('leaves an admin unlimited', async () => {
		const { sql } = await whereOf({ playerId: 'adm-1', role: 'admin' })
		expect(sql).not.toContain('is not null')
	})
})
