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
		createCustomMod: vi.fn(),
		updateCustomMod: vi.fn(),
		deleteCustomMod: vi.fn(),
		listVersionsForMod: vi.fn(),
		pinCommit: vi.fn(),
		setTrackGithub: vi.fn(),
		listPublicMods: vi.fn(),
		findModByIdOrFullName: vi.fn(),
		setModFlags: vi.fn(),
		setRankedVersion: vi.fn(),
	}
})

vi.mock('../../features/mods/custom-mod-version-check.service.js', () => ({
	resolveSourceInput: vi.fn(),
}))

import { resolveSourceInput } from '../../features/mods/custom-mod-version-check.service.js'

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
		expect(modsGateway.listVersionsForMod).not.toHaveBeenCalled()
	})

	it('serves the merged Thunderstore + GitHub list for an admin', async () => {
		const versions = [
			{ version: '1.0.0', source: 'thunderstore', aliases: ['v1.0.0'] },
			{ version: 'abc1234', source: 'github', aliases: [] },
		]
		vi.mocked(modsGateway.listVersionsForMod).mockResolvedValue(versions as any)

		const token = authAsAdmin('admin-ver-1', 'Admin')
		const res = await request(app)
			.get('/api/webadmin/mods/Author-Mod/versions')
			.set('Authorization', token)

		expect(res.status).toBe(200)
		expect(res.body).toEqual(versions)
		expect(modsGateway.listVersionsForMod).toHaveBeenCalledWith('Author-Mod')
	})

	it('returns 404 for an unknown mod', async () => {
		vi.mocked(modsGateway.listVersionsForMod).mockResolvedValue(null)

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

	it.each([
		'version-not-found',
		'download-unresolvable',
		'hash-failed',
	] as const)('maps %s from the gateway to a 400', async (reason) => {
		vi.mocked(modsGateway.setRankedVersion).mockResolvedValue({
			ok: false,
			reason,
		})

		const token = authAsAdmin(`admin-put-2-${reason}`, 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author-Mod')
			.set('Authorization', token)
			.send({ rankedVersion: '9.9.9' })

		expect(res.status).toBe(400)
	})

	it('calls setRankedVersion(null) to ban a mod', async () => {
		vi.mocked(modsGateway.setRankedVersion).mockResolvedValue({ ok: true })

		const token = authAsAdmin('admin-put-3', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author-Mod')
			.set('Authorization', token)
			.send({ rankedVersion: null })

		expect(res.status).toBe(200)
		expect(modsGateway.setRankedVersion).toHaveBeenCalledWith(
			'Author@Mod',
			null,
		)
	})

	it('pins any version (by name or alias) through the gateway', async () => {
		vi.mocked(modsGateway.setRankedVersion).mockResolvedValue({ ok: true })

		const token = authAsAdmin('admin-put-4', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author-Mod')
			.set('Authorization', token)
			.send({ rankedVersion: '1.0.0' })

		expect(res.status).toBe(200)
		expect(res.body).toEqual({ ok: true })
		expect(modsGateway.setRankedVersion).toHaveBeenCalledWith(
			'Author@Mod',
			'1.0.0',
		)
	})

	it('pins a commit by SHA', async () => {
		vi.mocked(modsGateway.pinCommit).mockResolvedValue({ ok: true })

		const token = authAsAdmin('admin-put-commit-1', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author-Mod')
			.set('Authorization', token)
			.send({ rankedCommit: ' abc1234 ' })

		expect(res.status).toBe(200)
		expect(modsGateway.pinCommit).toHaveBeenCalledWith('Author@Mod', 'abc1234')
		expect(modsGateway.setRankedVersion).not.toHaveBeenCalled()
	})

	it.each(['no-github-repo', 'commit-not-found'] as const)(
		'maps a commit pin failure (%s) to a 400',
		async (reason) => {
			vi.mocked(modsGateway.pinCommit).mockResolvedValue({ ok: false, reason })

			const token = authAsAdmin(`admin-put-commit-${reason}`, 'Admin')
			const res = await request(app)
				.put('/api/webadmin/mods/Author-Mod')
				.set('Authorization', token)
				.send({ rankedCommit: 'abc1234' })

			expect(res.status).toBe(400)
		},
	)

	it('refuses rankedVersion and rankedCommit together', async () => {
		const token = authAsAdmin('admin-put-commit-both', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author-Mod')
			.set('Authorization', token)
			.send({ rankedVersion: '1.0.0', rankedCommit: 'abc1234' })

		expect(res.status).toBe(400)
		expect(modsGateway.setRankedVersion).not.toHaveBeenCalled()
		expect(modsGateway.pinCommit).not.toHaveBeenCalled()
	})

	it('toggles GitHub tracking on a Thunderstore mod', async () => {
		vi.mocked(modsGateway.setTrackGithub).mockResolvedValue(true)

		const token = authAsAdmin('admin-put-track-1', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author-Mod')
			.set('Authorization', token)
			.send({ trackGithub: true })

		expect(res.status).toBe(200)
		expect(modsGateway.setTrackGithub).toHaveBeenCalledWith('Author@Mod', true)
	})

	it('returns 404 when the gateway reports the mod does not exist', async () => {
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

const customRow = { id: 'Partner', thunderstoreFullName: null, isCustom: true }

describe('custom mod admin routes', () => {
	it('POST /mods is admin-only', async () => {
		const token = authAsModerator('cm-post-1', 'Mod')
		const res = await request(app)
			.post('/api/webadmin/mods')
			.set('Authorization', token)
			.send({ id: 'Partner', title: 'P', author: 'a' })

		expect(res.status).toBe(403)
		expect(modsGateway.createCustomMod).not.toHaveBeenCalled()
	})

	it('POST /mods requires id, title and author', async () => {
		const token = authAsAdmin('cm-post-2', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/mods')
			.set('Authorization', token)
			.send({ id: 'Partner', title: 'P' })

		expect(res.status).toBe(400)
	})

	it('POST /mods creates from a raw url with no GitHub resolution', async () => {
		vi.mocked(modsGateway.createCustomMod).mockResolvedValue(customRow as any)

		const token = authAsAdmin('cm-post-3', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/mods')
			.set('Authorization', token)
			.send({
				id: 'Partner',
				title: 'P',
				author: 'a',
				latestVersion: 'v1',
				latestDownloadUrl: 'https://example.com/p.zip',
			})

		expect(res.status).toBe(201)
		expect(resolveSourceInput).not.toHaveBeenCalled()
		expect(modsGateway.createCustomMod).toHaveBeenCalledWith(
			expect.objectContaining({
				id: 'Partner',
				latestVersion: 'v1',
				latestDownloadUrl: 'https://example.com/p.zip',
			}),
		)
	})

	it('POST /mods with a branch sourceInput resolves it and turns auto-check on', async () => {
		vi.mocked(resolveSourceInput).mockResolvedValue({
			latestDownloadUrl: 'https://github.com/o/r/archive/refs/heads/dev.zip',
			latestVersion: 'abc1234',
		})
		vi.mocked(modsGateway.createCustomMod).mockResolvedValue(customRow as any)

		const token = authAsAdmin('cm-post-4', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/mods')
			.set('Authorization', token)
			.send({
				id: 'Partner',
				title: 'P',
				author: 'a',
				sourceInput: {
					sourceType: 'branch',
					repoUrl: 'https://github.com/o/r',
					branch: 'dev',
				},
			})

		expect(res.status).toBe(201)
		expect(resolveSourceInput).toHaveBeenCalledWith({
			sourceType: 'branch',
			repoUrl: 'https://github.com/o/r',
			branch: 'dev',
		})
		expect(modsGateway.createCustomMod).toHaveBeenCalledWith(
			expect.objectContaining({
				latestDownloadUrl: 'https://github.com/o/r/archive/refs/heads/dev.zip',
				latestVersion: 'abc1234',
				automaticVersionCheck: true,
			}),
		)
	})

	it('POST /mods rejects a sourceInput without a branch', async () => {
		const token = authAsAdmin('cm-post-5', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/mods')
			.set('Authorization', token)
			.send({
				id: 'Partner',
				title: 'P',
				author: 'a',
				sourceInput: {
					sourceType: 'branch',
					repoUrl: 'https://github.com/o/r',
				},
			})

		expect(res.status).toBe(400)
	})

	it('POST /mods returns 409 when the id is taken', async () => {
		vi.mocked(modsGateway.createCustomMod).mockResolvedValue(null)

		const token = authAsAdmin('cm-post-6', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/mods')
			.set('Authorization', token)
			.send({ id: 'Taken', title: 'P', author: 'a' })

		expect(res.status).toBe(409)
	})

	it('PUT /mods/:modId/custom edits a custom mod', async () => {
		vi.mocked(modsGateway.updateCustomMod).mockResolvedValue(customRow as any)

		const token = authAsAdmin('cm-put-1', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Partner/custom')
			.set('Authorization', token)
			.send({ description: 'new', thumbnailUrl: null })

		expect(res.status).toBe(200)
		expect(modsGateway.updateCustomMod).toHaveBeenCalledWith(
			'Partner',
			expect.objectContaining({ description: 'new', thumbnailUrl: null }),
		)
	})

	it('PUT /mods/:modId/custom 404s for a Thunderstore mod (gateway refuses non-custom rows)', async () => {
		vi.mocked(modsGateway.updateCustomMod).mockResolvedValue(null)

		const token = authAsAdmin('cm-put-2', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Author-Mod/custom')
			.set('Authorization', token)
			.send({ title: 'hijacked' })

		expect(res.status).toBe(404)
	})

	it('DELETE /mods/:modId deletes a custom mod', async () => {
		vi.mocked(modsGateway.findModByIdOrFullName).mockResolvedValue(
			customRow as any,
		)
		vi.mocked(modsGateway.deleteCustomMod).mockResolvedValue(true)

		const token = authAsAdmin('cm-del-1', 'Admin')
		const res = await request(app)
			.delete('/api/webadmin/mods/Partner')
			.set('Authorization', token)

		expect(res.status).toBe(200)
		expect(modsGateway.deleteCustomMod).toHaveBeenCalledWith('Partner')
	})

	it('DELETE /mods/:modId refuses a Thunderstore mod', async () => {
		const token = authAsAdmin('cm-del-2', 'Admin')
		const res = await request(app)
			.delete('/api/webadmin/mods/Author@Mod')
			.set('Authorization', token)

		expect(res.status).toBe(400)
		expect(modsGateway.deleteCustomMod).not.toHaveBeenCalled()
	})

	it('PUT /mods/:modId refuses trackGithub on a custom mod (always tracked)', async () => {
		vi.mocked(modsGateway.findModByIdOrFullName).mockResolvedValue(
			customRow as any,
		)

		const token = authAsAdmin('cm-track-1', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Partner')
			.set('Authorization', token)
			.send({ trackGithub: false })

		expect(res.status).toBe(400)
		expect(modsGateway.setTrackGithub).not.toHaveBeenCalled()
	})

	it('PUT /mods/:modId pins a custom mod without any Thunderstore lookup', async () => {
		vi.mocked(modsGateway.findModByIdOrFullName).mockResolvedValue(
			customRow as any,
		)
		vi.mocked(modsGateway.setRankedVersion).mockResolvedValue({ ok: true })

		const token = authAsAdmin('cm-pin-1', 'Admin')
		const res = await request(app)
			.put('/api/webadmin/mods/Partner')
			.set('Authorization', token)
			.send({ rankedVersion: 'v1' })

		expect(res.status).toBe(200)
		expect(modsGateway.setRankedVersion).toHaveBeenCalledWith('Partner', 'v1')
	})

	it.each(['version-not-found', 'download-unresolvable'] as const)(
		'PUT /mods/:modId maps %s to a 400',
		async (reason) => {
			vi.mocked(modsGateway.findModByIdOrFullName).mockResolvedValue(
				customRow as any,
			)
			vi.mocked(modsGateway.setRankedVersion).mockResolvedValue({
				ok: false,
				reason,
			})

			const token = authAsAdmin(`cm-pin-${reason}`, 'Admin')
			const res = await request(app)
				.put('/api/webadmin/mods/Partner')
				.set('Authorization', token)
				.send({ rankedVersion: 'v0' })

			expect(res.status).toBe(400)
		},
	)
})
