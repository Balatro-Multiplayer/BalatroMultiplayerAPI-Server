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
		setRankedVersion: vi.fn(),
		setFeatured: vi.fn(),
		createCustomMod: vi.fn(),
		updateCustomMod: vi.fn(),
		deleteCustomMod: vi.fn(),
		getPublicModById: vi.fn(),
		upsertProfileEntry: vi.fn(),
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
	const releaseMod = {
		id: 'Author@Mod',
		latestDownloadUrl:
			'https://github.com/author/mod/releases/download/v1.2.3/mod.zip',
		latestVersion: '1.2.3',
		versions: [{ version: '1.2.3' }, { version: '1.0.0' }],
	}
	const branchMod = {
		id: 'Author@Mod',
		latestDownloadUrl:
			'https://github.com/author/mod/archive/refs/heads/main.zip',
		latestVersion: 'abcdef1',
		versions: [{ version: 'abcdef1' }],
	}
	const customMod = {
		id: 'Author@Mod',
		latestDownloadUrl: 'https://example.com/mod.zip',
		latestVersion: '1.0.0',
		versions: [{ version: '1.0.0' }],
	}

	it('returns 403 for a moderator', async () => {
		const token = authAsModerator('mod-ranked-1', 'Mod')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ rankedVersion: '1.2.3' })

		expect(res.status).toBe(403)
		expect(modsGateway.setRankedVersion).not.toHaveBeenCalled()
	})

	it('returns 400 when no field is present', async () => {
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

	it('sets rankedVersion for an admin when it is a known version of a release-type mod', async () => {
		vi.mocked(modsGateway.getPublicModById).mockResolvedValue(releaseMod as any)
		vi.mocked(modsGateway.setRankedVersion).mockResolvedValue(true)
		const token = authAsAdmin('admin-ranked-3', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ rankedVersion: '1.2.3' })

		expect(res.status).toBe(200)
		expect(modsGateway.setRankedVersion).toHaveBeenCalledWith(
			'Author@Mod',
			'1.2.3',
		)
	})

	it('rejects rankedVersion for a release-type mod when it is not a known version', async () => {
		vi.mocked(modsGateway.getPublicModById).mockResolvedValue(releaseMod as any)
		const token = authAsAdmin('admin-ranked-3b', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ rankedVersion: '9.9.9' })

		expect(res.status).toBe(400)
		expect(modsGateway.setRankedVersion).not.toHaveBeenCalled()
	})

	it('accepts rankedVersion for a branch-tracked mod when it matches the current version', async () => {
		vi.mocked(modsGateway.getPublicModById).mockResolvedValue(branchMod as any)
		vi.mocked(modsGateway.setRankedVersion).mockResolvedValue(true)
		const token = authAsAdmin('admin-ranked-3c', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ rankedVersion: 'abcdef1' })

		expect(res.status).toBe(200)
		expect(modsGateway.setRankedVersion).toHaveBeenCalledWith(
			'Author@Mod',
			'abcdef1',
		)
	})

	it('rejects rankedVersion for a branch-tracked mod when it is not the current version', async () => {
		vi.mocked(modsGateway.getPublicModById).mockResolvedValue(branchMod as any)
		const token = authAsAdmin('admin-ranked-3d', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ rankedVersion: 'stale99' })

		expect(res.status).toBe(400)
		expect(modsGateway.setRankedVersion).not.toHaveBeenCalled()
	})

	it('rejects any rankedVersion for a custom-hosted mod', async () => {
		vi.mocked(modsGateway.getPublicModById).mockResolvedValue(customMod as any)
		const token = authAsAdmin('admin-ranked-3e', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ rankedVersion: '1.0.0' })

		expect(res.status).toBe(400)
		expect(modsGateway.setRankedVersion).not.toHaveBeenCalled()
	})

	it('allows clearing rankedVersion to null without any source validation', async () => {
		vi.mocked(modsGateway.setRankedVersion).mockResolvedValue(true)
		const token = authAsAdmin('admin-ranked-4', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ rankedVersion: null })

		expect(res.status).toBe(200)
		expect(modsGateway.getPublicModById).not.toHaveBeenCalled()
		expect(modsGateway.setRankedVersion).toHaveBeenCalledWith(
			'Author@Mod',
			null,
		)
	})

	it('returns 404 when the mod does not exist', async () => {
		vi.mocked(modsGateway.getPublicModById).mockResolvedValue(null)
		const token = authAsAdmin('admin-ranked-5', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Nobody@Nothing')
			.set('Authorization', token)
			.send({ rankedVersion: '1.2.3' })

		expect(res.status).toBe(404)
		expect(modsGateway.setRankedVersion).not.toHaveBeenCalled()
	})

	it('returns 400 when featured is not a boolean', async () => {
		const token = authAsAdmin('admin-ranked-6', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ featured: 'yes' })

		expect(res.status).toBe(400)
	})

	it('sets featured for an admin, independently of rankedVersion', async () => {
		vi.mocked(modsGateway.setFeatured).mockResolvedValue(true)
		const token = authAsAdmin('admin-ranked-7', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)
			.send({ featured: true })

		expect(res.status).toBe(200)
		expect(modsGateway.setFeatured).toHaveBeenCalledWith('Author@Mod', true)
		expect(modsGateway.setRankedVersion).not.toHaveBeenCalled()
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

	it('clears rankedVersion for an admin', async () => {
		vi.mocked(modsGateway.setRankedVersion).mockResolvedValue(true)
		const token = authAsAdmin('admin-clear-1', 'Admin')
		const res = await request(app)
			.delete('/api/webadmin/mods/Author@Mod/ranked')
			.set('Authorization', token)

		expect(res.status).toBe(200)
		expect(modsGateway.setRankedVersion).toHaveBeenCalledWith(
			'Author@Mod',
			null,
		)
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

	it('defaults automaticVersionCheck/fixedReleaseTagUpdates to undefined when omitted', async () => {
		vi.mocked(modsGateway.createCustomMod).mockResolvedValue({
			...validBody,
			isCustom: true,
		} as any)
		const token = authAsAdmin('admin-create-4', 'Admin')
		await request(app)
			.post('/api/webadmin/mods')
			.set('Authorization', token)
			.send(validBody)

		expect(modsGateway.createCustomMod).toHaveBeenCalledWith(
			expect.objectContaining({
				automaticVersionCheck: undefined,
				fixedReleaseTagUpdates: undefined,
			}),
		)
	})

	it('passes automaticVersionCheck/fixedReleaseTagUpdates through when provided', async () => {
		vi.mocked(modsGateway.createCustomMod).mockResolvedValue({
			...validBody,
			isCustom: true,
		} as any)
		const token = authAsAdmin('admin-create-5', 'Admin')
		await request(app)
			.post('/api/webadmin/mods')
			.set('Authorization', token)
			.send({
				...validBody,
				automaticVersionCheck: true,
				fixedReleaseTagUpdates: true,
			})

		expect(modsGateway.createCustomMod).toHaveBeenCalledWith(
			expect.objectContaining({
				automaticVersionCheck: true,
				fixedReleaseTagUpdates: true,
			}),
		)
	})
})

describe('PUT /api/webadmin/mods/:modId/custom', () => {
	it('returns 403 for a moderator', async () => {
		const token = authAsModerator('mod-edit-1', 'Mod')
		const res = await request(app)
			.put('/api/webadmin/mods/Custom@Mod/custom')
			.set('Authorization', token)
			.send({ title: 'New Title' })

		expect(res.status).toBe(403)
		expect(modsGateway.updateCustomMod).not.toHaveBeenCalled()
	})

	it('returns 404 when the mod does not exist or is not custom', async () => {
		vi.mocked(modsGateway.updateCustomMod).mockResolvedValue(null)
		const token = authAsAdmin('admin-edit-1', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Nobody@Nothing/custom')
			.set('Authorization', token)
			.send({ title: 'New Title' })

		expect(res.status).toBe(404)
	})

	it('round-trips field edits, including the two new toggles, for an admin', async () => {
		vi.mocked(modsGateway.updateCustomMod).mockResolvedValue({
			id: 'Custom@Mod',
			title: 'New Title',
			isCustom: true,
			automaticVersionCheck: true,
			fixedReleaseTagUpdates: true,
		} as any)
		const token = authAsAdmin('admin-edit-2', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Custom@Mod/custom')
			.set('Authorization', token)
			.send({
				title: 'New Title',
				repoUrl: null,
				automaticVersionCheck: true,
				fixedReleaseTagUpdates: true,
			})

		expect(res.status).toBe(200)
		expect(res.body.title).toBe('New Title')
		expect(res.body.automaticVersionCheck).toBe(true)
		expect(modsGateway.updateCustomMod).toHaveBeenCalledWith(
			'Custom@Mod',
			expect.objectContaining({
				title: 'New Title',
				repoUrl: null,
				automaticVersionCheck: true,
				fixedReleaseTagUpdates: true,
			}),
		)
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

describe('PUT /api/webadmin/mods/profiles/:id/entries/:modId', () => {
	it('returns 403 for a moderator', async () => {
		const token = authAsModerator('mod-entry-1', 'Mod')
		const res = await request(app)
			.put('/api/webadmin/mods/profiles/profile-1/entries/Author@Mod')
			.set('Authorization', token)
			.send({ versionMode: 'latest', allowed: true })

		expect(res.status).toBe(403)
		expect(modsGateway.upsertProfileEntry).not.toHaveBeenCalled()
	})

	it('returns 400 for an unrecognized versionMode', async () => {
		const token = authAsAdmin('admin-entry-1', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/profiles/profile-1/entries/Author@Mod')
			.set('Authorization', token)
			.send({ versionMode: 'min:1.0.0', allowed: true })

		expect(res.status).toBe(400)
		expect(modsGateway.upsertProfileEntry).not.toHaveBeenCalled()
	})

	it('returns 400 when versionMode is exact but pinnedVersion is missing', async () => {
		const token = authAsAdmin('admin-entry-2', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/profiles/profile-1/entries/Author@Mod')
			.set('Authorization', token)
			.send({ versionMode: 'exact', allowed: true })

		expect(res.status).toBe(400)
		expect(modsGateway.upsertProfileEntry).not.toHaveBeenCalled()
	})

	it('upserts a latestRanked entry, ignoring any stray pinnedVersion', async () => {
		vi.mocked(modsGateway.upsertProfileEntry).mockResolvedValue({} as any)
		const token = authAsAdmin('admin-entry-3', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/profiles/profile-1/entries/Author@Mod')
			.set('Authorization', token)
			.send({
				versionMode: 'latestRanked',
				pinnedVersion: '9.9.9',
				allowed: true,
			})

		expect(res.status).toBe(200)
		expect(modsGateway.upsertProfileEntry).toHaveBeenCalledWith({
			profileId: 'profile-1',
			modId: 'Author@Mod',
			versionMode: 'latestRanked',
			pinnedVersion: null,
			allowed: true,
		})
	})

	it('upserts an exact entry with its pinnedVersion', async () => {
		vi.mocked(modsGateway.upsertProfileEntry).mockResolvedValue({} as any)
		const token = authAsAdmin('admin-entry-4', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/profiles/profile-1/entries/Author@Mod')
			.set('Authorization', token)
			.send({ versionMode: 'exact', pinnedVersion: '1.2.3', allowed: false })

		expect(res.status).toBe(200)
		expect(modsGateway.upsertProfileEntry).toHaveBeenCalledWith({
			profileId: 'profile-1',
			modId: 'Author@Mod',
			versionMode: 'exact',
			pinnedVersion: '1.2.3',
			allowed: false,
		})
	})
})
