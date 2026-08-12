import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
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
		setRankedConfig: vi.fn(),
		setFeatured: vi.fn(),
		clearRankedConfig: vi.fn(),
		createCustomMod: vi.fn(),
		deleteCustomMod: vi.fn(),
		getPublicModById: vi.fn(),
		updateModFields: vi.fn(),
		resetModFieldOverrides: vi.fn(),
	}
})

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

describe('PUT /api/webadmin/mods/:modId', () => {
	it('returns 403 for a moderator', async () => {
		const token = authAsModerator('mod-ranked-1', 'Mod')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ allowedInRanked: true })

		expect(res.status).toBe(403)
		expect(modsGateway.setRankedConfig).not.toHaveBeenCalled()
	})

	it('returns 400 when neither field is present', async () => {
		const token = authAsAdmin('admin-ranked-1', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({})

		expect(res.status).toBe(400)
	})

	it('returns 400 when rankedVersion is not a string or null', async () => {
		const token = authAsAdmin('admin-ranked-2', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ rankedVersion: 5 })

		expect(res.status).toBe(400)
	})

	it('updates allowedInRanked and rankedVersion together for an admin', async () => {
		vi.mocked(modsGateway.setRankedConfig).mockResolvedValue(true)
		const token = authAsAdmin('admin-ranked-3', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ allowedInRanked: true, rankedVersion: '1.2.3' })

		expect(res.status).toBe(200)
		expect(modsGateway.setRankedConfig).toHaveBeenCalledWith('Author@Mod', {
			allowedInRanked: true,
			rankedVersion: '1.2.3',
		})
	})

	it('allows updating just rankedVersion, leaving allowedInRanked untouched', async () => {
		vi.mocked(modsGateway.setRankedConfig).mockResolvedValue(true)
		const token = authAsAdmin('admin-ranked-4', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ rankedVersion: null })

		expect(res.status).toBe(200)
		expect(modsGateway.setRankedConfig).toHaveBeenCalledWith('Author@Mod', {
			allowedInRanked: undefined,
			rankedVersion: null,
		})
	})

	it('returns 404 when the mod does not exist', async () => {
		vi.mocked(modsGateway.setRankedConfig).mockResolvedValue(false)
		const token = authAsAdmin('admin-ranked-5', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Nobody@Nothing')
			.set('Authorization', token)
			.send({ allowedInRanked: true })

		expect(res.status).toBe(404)
	})

	it('returns 400 when featured is not a boolean', async () => {
		const token = authAsAdmin('admin-ranked-6', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ featured: 'yes' })

		expect(res.status).toBe(400)
	})

	it('sets featured for an admin, independently of ranked config', async () => {
		vi.mocked(modsGateway.setFeatured).mockResolvedValue(true)
		const token = authAsAdmin('admin-ranked-7', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ featured: true })

		expect(res.status).toBe(200)
		expect(modsGateway.setFeatured).toHaveBeenCalledWith('Author@Mod', true)
		expect(modsGateway.setRankedConfig).not.toHaveBeenCalled()
	})
})

describe('PATCH /api/webadmin/mods/:modId', () => {
	it('returns 403 for a moderator', async () => {
		const token = authAsModerator('mod-patch-1', 'Mod')
		const res = await request(app)
			.patch('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ description: 'New description' })

		expect(res.status).toBe(403)
		expect(modsGateway.updateModFields).not.toHaveBeenCalled()
	})

	it('returns 400 when no field is present', async () => {
		const token = authAsAdmin('admin-patch-1', 'Admin')
		const res = await request(app)
			.patch('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({})

		expect(res.status).toBe(400)
	})

	it('returns 400 for a malformed field', async () => {
		const token = authAsAdmin('admin-patch-2', 'Admin')
		const res = await request(app)
			.patch('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ categories: 'not-an-array' })

		expect(res.status).toBe(400)
	})

	it('updates only the fields present in the body for an admin', async () => {
		vi.mocked(modsGateway.updateModFields).mockResolvedValue({
			id: 'Author@Mod',
			description: 'New description',
		} as any)
		const token = authAsAdmin('admin-patch-3', 'Admin')
		const res = await request(app)
			.patch('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ description: 'New description' })

		expect(res.status).toBe(200)
		expect(modsGateway.updateModFields).toHaveBeenCalledWith('Author@Mod', {
			description: 'New description',
		})
	})

	it('returns 404 when the mod does not exist', async () => {
		vi.mocked(modsGateway.updateModFields).mockResolvedValue(null)
		const token = authAsAdmin('admin-patch-4', 'Admin')
		const res = await request(app)
			.patch('/api/webadmin/mods/Nobody@Nothing')
			.set('Authorization', token)
			.send({ description: 'New description' })

		expect(res.status).toBe(404)
	})
})

describe('POST /api/webadmin/mods/:modId/reset-overrides', () => {
	it('returns 403 for a moderator', async () => {
		const token = authAsModerator('mod-reset-1', 'Mod')
		const res = await request(app)
			.post('/api/webadmin/mods/Author@Mod/reset-overrides')
			.set('Authorization', token)
			.send({})

		expect(res.status).toBe(403)
		expect(modsGateway.resetModFieldOverrides).not.toHaveBeenCalled()
	})

	it('returns 400 when fields is not a string array', async () => {
		const token = authAsAdmin('admin-reset-1', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/mods/Author@Mod/reset-overrides')
			.set('Authorization', token)
			.send({ fields: [1, 2] })

		expect(res.status).toBe(400)
	})

	it('resets the given fields for an admin', async () => {
		vi.mocked(modsGateway.resetModFieldOverrides).mockResolvedValue(true)
		const token = authAsAdmin('admin-reset-2', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/mods/Author@Mod/reset-overrides')
			.set('Authorization', token)
			.send({ fields: ['description'] })

		expect(res.status).toBe(200)
		expect(modsGateway.resetModFieldOverrides).toHaveBeenCalledWith(
			'Author@Mod',
			['description'],
		)
	})

	it('resets every overridden field when fields is omitted', async () => {
		vi.mocked(modsGateway.resetModFieldOverrides).mockResolvedValue(true)
		const token = authAsAdmin('admin-reset-3', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/mods/Author@Mod/reset-overrides')
			.set('Authorization', token)
			.send({})

		expect(res.status).toBe(200)
		expect(modsGateway.resetModFieldOverrides).toHaveBeenCalledWith(
			'Author@Mod',
			undefined,
		)
	})

	it('returns 404 when the mod does not exist', async () => {
		vi.mocked(modsGateway.resetModFieldOverrides).mockResolvedValue(false)
		const token = authAsAdmin('admin-reset-4', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/mods/Nobody@Nothing/reset-overrides')
			.set('Authorization', token)
			.send({})

		expect(res.status).toBe(404)
	})
})

describe('DELETE /api/webadmin/mods/:modId/ranked', () => {
	it('returns 403 for a moderator', async () => {
		const token = authAsModerator('mod-clear-1', 'Mod')
		const res = await request(app)
			.delete('/api/webadmin/mods/Author@Mod/ranked')
			.set('Authorization', token)

		expect(res.status).toBe(403)
	})

	it('clears ranked config for an admin', async () => {
		vi.mocked(modsGateway.clearRankedConfig).mockResolvedValue(true)
		const token = authAsAdmin('admin-clear-1', 'Admin')
		const res = await request(app)
			.delete('/api/webadmin/mods/Author@Mod/ranked')
			.set('Authorization', token)

		expect(res.status).toBe(200)
		expect(modsGateway.clearRankedConfig).toHaveBeenCalledWith('Author@Mod')
	})
})

describe('POST /api/webadmin/mods', () => {
	const validBody = { id: 'Custom@Mod', title: 'Custom Mod', author: 'Someone' }

	it('returns 403 for a moderator', async () => {
		const token = authAsModerator('mod-create-1', 'Mod')
		const res = await request(app)
			.post('/api/webadmin/mods')
			.set('Authorization', token)
			.send(validBody)

		expect(res.status).toBe(403)
		expect(modsGateway.createCustomMod).not.toHaveBeenCalled()
	})

	it('returns 400 when id/title/author is missing', async () => {
		const token = authAsAdmin('admin-create-1', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/mods')
			.set('Authorization', token)
			.send({ id: 'Custom@Mod', title: 'Custom Mod' })

		expect(res.status).toBe(400)
	})

	it('creates a custom mod for an admin', async () => {
		vi.mocked(modsGateway.createCustomMod).mockResolvedValue({
			...validBody,
			isCustom: true,
		} as any)
		const token = authAsAdmin('admin-create-2', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/mods')
			.set('Authorization', token)
			.send(validBody)

		expect(res.status).toBe(201)
		expect(res.body.isCustom).toBe(true)
	})

	it('returns 409 on an id collision', async () => {
		vi.mocked(modsGateway.createCustomMod).mockResolvedValue(null)
		const token = authAsAdmin('admin-create-3', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/mods')
			.set('Authorization', token)
			.send(validBody)

		expect(res.status).toBe(409)
	})
})

describe('DELETE /api/webadmin/mods/:modId', () => {
	it('returns 403 for a moderator', async () => {
		const token = authAsModerator('mod-delete-1', 'Mod')
		const res = await request(app)
			.delete('/api/webadmin/mods/Custom@Mod')
			.set('Authorization', token)

		expect(res.status).toBe(403)
	})

	it('returns 404 when the mod does not exist', async () => {
		vi.mocked(modsGateway.getPublicModById).mockResolvedValue(null)
		const token = authAsAdmin('admin-delete-1', 'Admin')
		const res = await request(app)
			.delete('/api/webadmin/mods/Nobody@Nothing')
			.set('Authorization', token)

		expect(res.status).toBe(404)
	})

	it('returns 400 for a synced (non-custom) mod', async () => {
		vi.mocked(modsGateway.getPublicModById).mockResolvedValue({
			id: 'Author@Mod',
			isCustom: false,
		} as any)
		const token = authAsAdmin('admin-delete-2', 'Admin')
		const res = await request(app)
			.delete('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)

		expect(res.status).toBe(400)
		expect(modsGateway.deleteCustomMod).not.toHaveBeenCalled()
	})

	it('deletes a custom mod for an admin', async () => {
		vi.mocked(modsGateway.getPublicModById).mockResolvedValue({
			id: 'Custom@Mod',
			isCustom: true,
		} as any)
		vi.mocked(modsGateway.deleteCustomMod).mockResolvedValue(true)
		const token = authAsAdmin('admin-delete-3', 'Admin')
		const res = await request(app)
			.delete('/api/webadmin/mods/Custom@Mod')
			.set('Authorization', token)

		expect(res.status).toBe(200)
		expect(modsGateway.deleteCustomMod).toHaveBeenCalledWith('Custom@Mod')
	})
})
