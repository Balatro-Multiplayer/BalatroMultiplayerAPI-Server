import { NOTICE_DATE, NOTICE_VERSION } from '@bmp/types'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import * as configGateway from '../../infrastructure/gateways/config.gateway.js'
import { db } from '../../infrastructure/db/index.js'
import { createSession } from '../../state/index.js'
import { getConfig, setConfig } from '../../state/config.js'
import { createTestApp } from './app.js'

vi.mock('../../infrastructure/gateways/config.gateway.js', () => ({
	loadConfigFromDb: vi.fn(),
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

describe('GET /api/webadmin/config', () => {
	it('returns the current in-memory config, including chatEnabled/testingMode read-only', async () => {
		const original = getConfig()
		setConfig({
			mods: [{ modId: 'MultiplayerPvP', displayName: 'PvP', version: '1.2.3', downloadUrl: 'https://example.com' }],
			chatAllowlist: new Set(['gg', 'nice']),
			chatEnabled: true,
			testingMode: false,
			rankedEnabled: false,
			casualQueueEnabled: true,
			groupQueueEnabled: false,
			lobbyCreationEnabled: true,
			achievementsEnabled: true,
			queueAllowedModIds: ['MultiplayerPvP'],
		})

		const token = authAsAdmin('mod-cfg-1', 'Mod')
		const res = await request(app).get('/api/webadmin/config').set('Authorization', token)

		expect(res.status).toBe(200)
		expect(res.body.noticeVersion).toBe(NOTICE_VERSION)
		expect(res.body.noticeDate).toBe(NOTICE_DATE)
		expect(res.body.mods).toEqual([
			{ modId: 'MultiplayerPvP', displayName: 'PvP', version: '1.2.3', downloadUrl: 'https://example.com' },
		])
		expect(res.body.chatAllowlist.sort()).toEqual(['gg', 'nice'])
		expect(res.body.chatEnabled).toBe(true)
		expect(res.body.testingMode).toBe(false)
		expect(res.body.rankedEnabled).toBe(false)
		expect(res.body.casualQueueEnabled).toBe(true)
		expect(res.body.groupQueueEnabled).toBe(false)
		expect(res.body.lobbyCreationEnabled).toBe(true)
		expect(res.body.achievementsEnabled).toBe(true)
		expect('queueModsEnforced' in res.body).toBe(false)
		expect(res.body.queueAllowedModIds).toEqual(['MultiplayerPvP'])

		setConfig(original)
	})
})

describe('the Notice version', () => {
	it('is set in code: there is no admin route to change it', async () => {
		const token = authAsAdmin('admin-cfg-1', 'Admin')
		const res = await request(app)
			.patch('/api/webadmin/config/tos-version')
			.set('Authorization', token)
			.send({ tosVersion: 5 })

		expect(res.status).toBe(404)
	})
})

describe('PATCH /api/webadmin/config/feature-flags', () => {
	it('returns 403 for a moderator', async () => {
		const token = authAsModerator('mod-cfg-flags-1', 'ModFlags')
		const res = await request(app)
			.patch('/api/webadmin/config/feature-flags')
			.set('Authorization', token)
			.send({ rankedEnabled: false })

		expect(res.status).toBe(403)
	})

	it('returns 400 when a provided flag is not a boolean', async () => {
		const token = authAsAdmin('admin-cfg-flags-1', 'AdminFlags')
		const res = await request(app)
			.patch('/api/webadmin/config/feature-flags')
			.set('Authorization', token)
			.send({ chatEnabled: 'yes' })

		expect(res.status).toBe(400)
	})

	it('returns 400 for an empty body', async () => {
		const token = authAsAdmin('admin-cfg-flags-2', 'AdminFlags2')
		const res = await request(app)
			.patch('/api/webadmin/config/feature-flags')
			.set('Authorization', token)
			.send({})

		expect(res.status).toBe(400)
	})

	it('writes only the provided flags (partial update) and reloads config for an admin', async () => {
		const token = authAsAdmin('admin-cfg-flags-3', 'AdminFlags3')
		const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
		;(db as any).update = vi.fn().mockReturnValue({ set: setMock })
		vi.mocked(configGateway.loadConfigFromDb).mockResolvedValue({
			mods: [],
			chatAllowlist: new Set(),
			chatEnabled: false,
			testingMode: false,
			rankedEnabled: false,
			casualQueueEnabled: true,
			groupQueueEnabled: false,
			lobbyCreationEnabled: true,
		} as any)

		const res = await request(app)
			.patch('/api/webadmin/config/feature-flags')
			.set('Authorization', token)
			.send({ rankedEnabled: false })

		expect(res.status).toBe(200)
		expect(res.body.rankedEnabled).toBe(false)
		expect(setMock).toHaveBeenCalledTimes(1)
		const patch = setMock.mock.calls[0][0]
		expect(patch.rankedEnabled).toBe(false)
		expect(patch).not.toHaveProperty('chatEnabled')
		expect(patch).not.toHaveProperty('casualQueueEnabled')
		expect(patch).not.toHaveProperty('groupQueueEnabled')
		expect(patch).not.toHaveProperty('lobbyCreationEnabled')
		expect(patch.updatedAt).toBeInstanceOf(Date)
	})

	it('switches achievements on for an admin', async () => {
		const token = authAsAdmin('admin-cfg-flags-4', 'AdminFlags4')
		const setMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
		;(db as any).update = vi.fn().mockReturnValue({ set: setMock })
		vi.mocked(configGateway.loadConfigFromDb).mockResolvedValue({
			chatEnabled: false,
			rankedEnabled: true,
			casualQueueEnabled: true,
			lobbyCreationEnabled: true,
			achievementsEnabled: true,
		} as any)

		const res = await request(app)
			.patch('/api/webadmin/config/feature-flags')
			.set('Authorization', token)
			.send({ achievementsEnabled: true })

		expect(res.status).toBe(200)
		expect(res.body.achievementsEnabled).toBe(true)
		expect(setMock.mock.calls[0][0]).toMatchObject({ achievementsEnabled: true })
		expect(setMock.mock.calls[0][0]).not.toHaveProperty('rankedEnabled')
	})
})

describe('PUT /api/webadmin/config/mods/:modId', () => {
	it('returns 403 for a moderator', async () => {
		const token = authAsModerator('mod-cfg-3', 'Mod3')
		const res = await request(app)
			.put('/api/webadmin/config/mods/MultiplayerPvP')
			.set('Authorization', token)
			.send({ displayName: 'PvP', version: '1.0.0', downloadUrl: 'https://example.com' })

		expect(res.status).toBe(403)
	})

	it('returns 400 when a required field is missing', async () => {
		const token = authAsAdmin('admin-cfg-3', 'Admin3')
		const res = await request(app)
			.put('/api/webadmin/config/mods/MultiplayerPvP')
			.set('Authorization', token)
			.send({ displayName: 'PvP', version: '1.0.0' })

		expect(res.status).toBe(400)
	})

	it('upserts the mod row and reloads config for an admin', async () => {
		const token = authAsAdmin('admin-cfg-4', 'Admin4')
		;(db as any).insert = vi.fn().mockReturnValue({
			values: vi.fn().mockReturnValue({
				onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
			}),
		})
		vi.mocked(configGateway.loadConfigFromDb).mockResolvedValue({
			mods: [{ modId: 'MultiplayerPvP', displayName: 'PvP', version: '2.0.0', downloadUrl: 'https://example.com' }],
			chatAllowlist: new Set(),
		} as any)

		const res = await request(app)
			.put('/api/webadmin/config/mods/MultiplayerPvP')
			.set('Authorization', token)
			.send({ displayName: 'PvP', version: '2.0.0', downloadUrl: 'https://example.com' })

		expect(res.status).toBe(200)
		expect(res.body.mods).toEqual([
			{ modId: 'MultiplayerPvP', displayName: 'PvP', version: '2.0.0', downloadUrl: 'https://example.com' },
		])
	})
})

describe('POST/DELETE /api/webadmin/config/chat-allowlist', () => {
	it('returns 403 for a moderator on add', async () => {
		const token = authAsModerator('mod-cfg-4', 'Mod4')
		const res = await request(app)
			.post('/api/webadmin/config/chat-allowlist')
			.set('Authorization', token)
			.send({ message: 'gg' })

		expect(res.status).toBe(403)
	})

	it('adds a message for an admin', async () => {
		const token = authAsAdmin('admin-cfg-5', 'Admin5')
		;(db as any).insert = vi.fn().mockReturnValue({
			values: vi.fn().mockReturnValue({
				onConflictDoNothing: vi.fn().mockResolvedValue(undefined),
			}),
		})
		vi.mocked(configGateway.loadConfigFromDb).mockResolvedValue({
			mods: [],
			chatAllowlist: new Set(['gg']),
		} as any)

		const res = await request(app)
			.post('/api/webadmin/config/chat-allowlist')
			.set('Authorization', token)
			.send({ message: 'gg' })

		expect(res.status).toBe(200)
		expect(res.body.chatAllowlist).toEqual(['gg'])
	})

	it('returns 403 for a moderator on delete', async () => {
		const token = authAsModerator('mod-cfg-5', 'Mod5')
		const res = await request(app)
			.delete('/api/webadmin/config/chat-allowlist/gg')
			.set('Authorization', token)

		expect(res.status).toBe(403)
	})

	it('has no mod-enforcement switch: the allowed-mods check is always on', async () => {
		const token = authAsAdmin('admin-cfg-flags-5', 'AdminFlags5')
		const update = vi.fn()
		;(db as any).update = update

		const res = await request(app)
			.patch('/api/webadmin/config/feature-flags')
			.set('Authorization', token)
			.send({ queueModsEnforced: false })

		expect(res.status).toBe(400)
		expect(update).not.toHaveBeenCalled()
	})
})
