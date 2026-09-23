import request from 'supertest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import * as modsGateway from '../../infrastructure/gateways/mods.gateway.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

vi.mock('../../infrastructure/gateways/mods.gateway.js', async () => {
	const actual = await vi.importActual<
		typeof import('../../infrastructure/gateways/mods.gateway.js')
	>('../../infrastructure/gateways/mods.gateway.js')
	return {
		...actual,
		listPublicMods: vi.fn(),
		findModByIdOrFullName: vi.fn(),
		setModFlags: vi.fn(),
		setRankedVersion: vi.fn(),
	}
})

vi.mock('../../features/mods/thunderstore-mod-index.service.js', () => ({
	fetchThunderstorePackageVersions: vi.fn(),
}))

import { fetchThunderstorePackageVersions } from '../../features/mods/thunderstore-mod-index.service.js'

const app = createTestApp()

// A carried-over row: legacy id, claimed by a Thunderstore package.
const legacyRow = { id: 'Author@Mod', thunderstoreFullName: 'Author-Mod' }

beforeEach(() => {
	vi.mocked(modsGateway.findModByIdOrFullName).mockResolvedValue(
		legacyRow as any,
	)
	vi.mocked(modsGateway.setModFlags).mockResolvedValue(true)
})

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

describe('GET /api/webadmin/mods', () => {
	it('mirrors the public compact list plus hidden mods, readable by a moderator', async () => {
		const rows = [
			{ id: 'Author-Mod', title: 'Mod', author: 'Author', rankedVersion: null },
		]
		vi.mocked(modsGateway.listPublicMods).mockResolvedValue(rows as any)

		const token = authAsModerator('mod-list-1', 'Mod')
		const res = await request(app)
			.get('/api/webadmin/mods')
			.set('Authorization', token)

		expect(res.status).toBe(200)
		expect(res.body).toEqual(rows)
		expect(modsGateway.listPublicMods).toHaveBeenCalledWith({
			includeHidden: true,
		})
	})
})

describe('GET /api/webadmin/mods/:id/versions', () => {
	it('returns 403 for a moderator (admin-only)', async () => {
		const token = authAsModerator('mod-ver-1', 'Mod')
		const res = await request(app)
			.get('/api/webadmin/mods/Author-Mod/versions')
			.set('Authorization', token)

		expect(res.status).toBe(403)
		expect(fetchThunderstorePackageVersions).not.toHaveBeenCalled()
	})

	it('live-proxies the version list for an admin', async () => {
		vi.mocked(fetchThunderstorePackageVersions).mockResolvedValue([
			{ version: '1.0.0', downloadUrl: 'https://example.com/1.0.0' },
		])

		const token = authAsAdmin('admin-ver-1', 'Admin')
		const res = await request(app)
			.get('/api/webadmin/mods/Author-Mod/versions')
			.set('Authorization', token)

		expect(res.status).toBe(200)
		expect(res.body).toEqual([
			{ version: '1.0.0', downloadUrl: 'https://example.com/1.0.0' },
		])
		expect(fetchThunderstorePackageVersions).toHaveBeenCalledWith('Author-Mod')
	})

	it('returns 404 for an unknown mod', async () => {
		vi.mocked(modsGateway.findModByIdOrFullName).mockResolvedValue(null)

		const token = authAsAdmin('admin-ver-2', 'Admin')
		const res = await request(app)
			.get('/api/webadmin/mods/Nobody-Nothing/versions')
			.set('Authorization', token)

		expect(res.status).toBe(404)
	})
})

describe('PUT /api/webadmin/mods/:modId', () => {
	it('returns 403 for a moderator', async () => {
		const token = authAsModerator('mod-put-1', 'Mod')
		const res = await request(app)
			.put('/api/webadmin/mods/Author-Mod')
			.set('Authorization', token)
			.send({ rankedVersion: '1.0.0' })

		expect(res.status).toBe(403)
		expect(modsGateway.setRankedVersion).not.toHaveBeenCalled()
	})

	it('returns 400 when rankedVersion is not a string or null', async () => {
		const token = authAsAdmin('admin-put-1', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author-Mod')
			.set('Authorization', token)
			.send({ rankedVersion: 5 })

		expect(res.status).toBe(400)
	})

	it('returns 400 when the version is not currently on Thunderstore', async () => {
		vi.mocked(fetchThunderstorePackageVersions).mockResolvedValue([
			{ version: '1.0.0', downloadUrl: 'https://example.com/1.0.0' },
		])

		const token = authAsAdmin('admin-put-2', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author-Mod')
			.set('Authorization', token)
			.send({ rankedVersion: '9.9.9' })

		expect(res.status).toBe(400)
		expect(modsGateway.setRankedVersion).not.toHaveBeenCalled()
	})

	it('skips the live version check and calls setRankedVersion(null) to ban a mod', async () => {
		vi.mocked(modsGateway.setRankedVersion).mockResolvedValue({ ok: true })

		const token = authAsAdmin('admin-put-3', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author-Mod')
			.set('Authorization', token)
			.send({ rankedVersion: null })

		expect(res.status).toBe(200)
		expect(fetchThunderstorePackageVersions).not.toHaveBeenCalled()
		expect(modsGateway.setRankedVersion).toHaveBeenCalledWith(
			'Author@Mod',
			null,
		)
	})

	it('pins a known version and returns ok on success', async () => {
		vi.mocked(fetchThunderstorePackageVersions).mockResolvedValue([
			{ version: '1.0.0', downloadUrl: 'https://example.com/1.0.0' },
		])
		vi.mocked(modsGateway.setRankedVersion).mockResolvedValue({ ok: true })

		const token = authAsAdmin('admin-put-4', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author-Mod')
			.set('Authorization', token)
			.send({ rankedVersion: '1.0.0' })

		expect(res.status).toBe(200)
		expect(res.body).toEqual({ ok: true })
		expect(fetchThunderstorePackageVersions).toHaveBeenCalledWith('Author-Mod')
		expect(modsGateway.setRankedVersion).toHaveBeenCalledWith(
			'Author@Mod',
			'1.0.0',
		)
	})

	it('returns 404 when the gateway reports the mod does not exist', async () => {
		vi.mocked(fetchThunderstorePackageVersions).mockResolvedValue([
			{ version: '1.0.0', downloadUrl: 'https://example.com/1.0.0' },
		])
		vi.mocked(modsGateway.setRankedVersion).mockResolvedValue({
			ok: false,
			reason: 'not-found',
		})

		const token = authAsAdmin('admin-put-5', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author-Mod')
			.set('Authorization', token)
			.send({ rankedVersion: '1.0.0' })

		expect(res.status).toBe(404)
	})

	it('returns 400 when the gateway could not compute a hash', async () => {
		vi.mocked(fetchThunderstorePackageVersions).mockResolvedValue([
			{ version: '1.0.0', downloadUrl: 'https://example.com/1.0.0' },
		])
		vi.mocked(modsGateway.setRankedVersion).mockResolvedValue({
			ok: false,
			reason: 'hash-failed',
		})

		const token = authAsAdmin('admin-put-6', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author-Mod')
			.set('Authorization', token)
			.send({ rankedVersion: '1.0.0' })

		expect(res.status).toBe(400)
	})

	it('returns 404 when the mod does not exist', async () => {
		vi.mocked(modsGateway.findModByIdOrFullName).mockResolvedValue(null)

		const token = authAsAdmin('admin-put-7', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Nobody-Nothing')
			.set('Authorization', token)
			.send({ featured: true })

		expect(res.status).toBe(404)
	})

	it('sets featured/hidden without touching the ranked pin', async () => {
		const token = authAsAdmin('admin-put-8', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author-Mod')
			.set('Authorization', token)
			.send({ featured: true, hidden: false })

		expect(res.status).toBe(200)
		expect(modsGateway.setModFlags).toHaveBeenCalledWith('Author@Mod', {
			featured: true,
			hidden: false,
		})
		expect(modsGateway.setRankedVersion).not.toHaveBeenCalled()
	})

	it('returns 400 when featured or hidden is not a boolean', async () => {
		const token = authAsAdmin('admin-put-9', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author-Mod')
			.set('Authorization', token)
			.send({ hidden: 'yes' })

		expect(res.status).toBe(400)
		expect(modsGateway.setModFlags).not.toHaveBeenCalled()
	})
})
