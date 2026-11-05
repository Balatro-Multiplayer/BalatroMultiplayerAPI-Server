import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { env } from '../../env.js'
import { signJwt } from '../../features/auth/jwt.js'
import { db } from '../../infrastructure/db/index.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

const app = createTestApp()

const fullRow = {
	id: 'target-1',
	steamName: 'Target',
	steamIdHash: 'steam-hash',
	discordIdHash: 'discord-hash',
	discordUsername: 'target#1',
	privileges: [],
}

function authAs(playerId: string, privileges: string[]) {
	createSession(playerId, { id: playerId })
	vi.mocked(playerGateway.findPlayerById).mockResolvedValue({
		...fullRow,
		id: playerId,
		privileges,
	} as any)
	return `Bearer ${signJwt({ playerId, steamName: playerId })}`
}

beforeEach(() => {
	env.OWNER_PLAYER_ID = ''
})

describe('staff pages are guarded by role on the server', () => {
	const adminOnly = ['/config', '/mods', '/launcher-releases']
	const staffRoutes = [
		'/players',
		'/service-queue',
		'/lobbies',
		'/matches',
		'/blog/posts',
		'/archives',
	]

	it('gives a player with no role no data from any staff route', async () => {
		const token = authAs('plain-1', ['tester'])
		for (const path of [...staffRoutes, ...adminOnly]) {
			const res = await request(app)
				.get(`/api/webadmin${path}`)
				.set('Authorization', token)
			expect(res.status, path).toBe(403)
		}
	})

	it('gives a moderator the moderator pages but not the admin pages', async () => {
		const token = authAs('mod-1', ['moderator'])
		for (const path of adminOnly) {
			const res = await request(app)
				.get(`/api/webadmin${path}`)
				.set('Authorization', token)
			expect(res.status, path).toBe(403)
		}
		for (const path of ['/players', '/matches']) {
			const res = await request(app)
				.get(`/api/webadmin${path}`)
				.set('Authorization', token)
			expect(res.status, path).not.toBe(403)
		}
	})

	it('lets an admin reach an admin page', async () => {
		const token = authAs('admin-1', ['admin'])
		const res = await request(app)
			.get('/api/webadmin/launcher-releases')
			.set('Authorization', token)
		expect(res.status).not.toBe(403)
	})
})

describe('the owner is always an admin', () => {
	it('reaches an admin page with an empty privilege list', async () => {
		env.OWNER_PLAYER_ID = 'owner-1'
		const token = authAs('owner-1', [])
		const res = await request(app)
			.get('/api/webadmin/launcher-releases')
			.set('Authorization', token)
		expect(res.status).not.toBe(403)
	})

	it('refuses a request that removes the owner admin role', async () => {
		env.OWNER_PLAYER_ID = 'owner-1'
		const token = authAs('admin-2', ['admin'])
		const update = vi.fn()
		;(db as any).update = update
		for (const privileges of [[], ['moderator']]) {
			const res = await request(app)
				.patch('/api/webadmin/players/owner-1/privileges')
				.set('Authorization', token)
				.send({ privileges, reason: 'r' })
			expect(res.status).toBe(403)
		}
		expect(update).not.toHaveBeenCalled()
	})

	it('still lets an admin change the privileges of someone else', async () => {
		env.OWNER_PLAYER_ID = 'owner-1'
		const token = authAs('admin-3', ['admin'])
		;(db as any).update = vi.fn().mockReturnValue({
			set: vi.fn().mockReturnValue({
				where: vi.fn().mockReturnValue({
					returning: vi.fn().mockResolvedValue([{ id: 'p', privileges: [] }]),
				}),
			}),
		})
		const res = await request(app)
			.patch('/api/webadmin/players/p/privileges')
			.set('Authorization', token)
			.send({ privileges: [], reason: 'r' })
		expect(res.status).toBe(200)
	})
})

describe('identity data stays with admins', () => {
	it('sends a moderator a player with no hash and no linked account', async () => {
		const token = authAs('mod-2', ['moderator'])
		vi.mocked(playerGateway.findPlayerById).mockResolvedValue({
			...fullRow,
			privileges: ['moderator'],
		} as any)
		const res = await request(app)
			.get('/api/webadmin/players/target-1')
			.set('Authorization', token)
		expect(res.status).toBe(200)
		expect(res.body.player.steamName).toBe('Target')
		for (const field of ['steamIdHash', 'discordIdHash', 'discordUsername'])
			expect(res.body.player, field).not.toHaveProperty(field)
	})

	it('still sends an admin the whole player', async () => {
		const token = authAs('admin-4', ['admin'])
		vi.mocked(playerGateway.findPlayerById).mockResolvedValue({
			...fullRow,
			privileges: ['admin'],
		} as any)
		const res = await request(app)
			.get('/api/webadmin/players/target-1')
			.set('Authorization', token)
		expect(res.body.player).toMatchObject({
			steamIdHash: 'steam-hash',
			discordIdHash: 'discord-hash',
			discordUsername: 'target#1',
		})
	})

	it('leaves the linked account out of the player list for a moderator, not an admin', async () => {
		const rows = [
			{
				id: 'target-1',
				steamName: 'Target',
				discordUsername: 'target#1',
				privileges: [],
			},
		]
		const chain = (value: unknown) => {
			const c: any = {}
			for (const m of [
				'from',
				'where',
				'orderBy',
				'limit',
				'offset',
				'groupBy',
				'leftJoin',
			])
				c[m] = vi.fn(() => c)
			c.then = (resolve: (v: unknown) => void) => resolve(value)
			return c
		}
		for (const [privilege, shown] of [
			['moderator', false],
			['admin', true],
		] as const) {
			const token = authAs(`${privilege}-5`, [privilege])
			vi.mocked(db.select)
				.mockReturnValueOnce(chain([{ total: 1 }]))
				.mockReturnValueOnce(chain(rows.map((r) => ({ ...r }))))
			const res = await request(app)
				.get('/api/webadmin/players')
				.set('Authorization', token)
			expect(res.status).toBe(200)
			expect('discordUsername' in res.body.players[0], privilege).toBe(shown)
		}
	})
})
