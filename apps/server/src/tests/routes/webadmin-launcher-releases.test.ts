import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import * as githubReleases from '../../features/launcher-releases/launcher-github-releases.service.js'
import * as launcherReleasesGateway from '../../infrastructure/gateways/launcher-releases.gateway.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

vi.mock('../../infrastructure/gateways/launcher-releases.gateway.js', () => ({
	listReleases: vi.fn(),
	getReleaseWithAssetsById: vi.fn(),
	upsertRelease: vi.fn(),
	upsertAsset: vi.fn(),
	deleteRelease: vi.fn(),
	deleteAssetRow: vi.fn(),
}))

// biome-ignore format: vi.mock's path argument must stay a literal on the
// same call as vi.mock( for Vitest's static hoisting to find it -- wrapping
// this call across lines breaks the mock silently (throws "no export
// defined on the mock" at request time instead of at import time).
vi.mock('../../features/launcher-releases/launcher-github-releases.service.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../features/launcher-releases/launcher-github-releases.service.js')>()
	return {
		...actual,
		listRecentReleases: vi.fn(),
		resolveReleaseByTag: vi.fn(),
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

describe('GET /api/webadmin/launcher-releases/github-releases', () => {
	it('flags tags already imported into this server', async () => {
		vi.mocked(githubReleases.listRecentReleases).mockResolvedValue([
			{ tag: 'v0.2.0', name: 'v0.2.0', publishedAt: '2026-08-20', body: null },
			{ tag: 'v0.1.4', name: 'v0.1.4', publishedAt: '2026-08-19', body: null },
		])
		vi.mocked(launcherReleasesGateway.listReleases).mockResolvedValue([
			{
				id: 1,
				version: '0.1.4',
				githubReleaseTag: 'v0.1.4',
				notes: null,
				createdAt: new Date(),
				updatedAt: new Date(),
				assets: [],
			},
		])

		const token = authAsModerator('mod-view', 'Mod')
		const res = await request(app)
			.get('/api/webadmin/launcher-releases/github-releases')
			.set('Authorization', token)

		expect(res.status).toBe(200)
		expect(res.body.releases).toEqual([
			{
				tag: 'v0.2.0',
				name: 'v0.2.0',
				publishedAt: '2026-08-20',
				body: null,
				alreadyImported: false,
			},
			{
				tag: 'v0.1.4',
				name: 'v0.1.4',
				publishedAt: '2026-08-19',
				body: null,
				alreadyImported: true,
			},
		])
	})
})

describe('POST /api/webadmin/launcher-releases/from-github', () => {
	it('returns 403 for a moderator', async () => {
		const token = authAsModerator('mod-1', 'Mod')
		const res = await request(app)
			.post('/api/webadmin/launcher-releases/from-github')
			.set('Authorization', token)
			.send({ tag: 'v1.0.0' })

		expect(res.status).toBe(403)
		expect(launcherReleasesGateway.upsertRelease).not.toHaveBeenCalled()
	})

	it('returns 400 when tag is missing', async () => {
		const token = authAsAdmin('admin-1', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/launcher-releases/from-github')
			.set('Authorization', token)
			.send({})

		expect(res.status).toBe(400)
	})

	it('returns 404 for a tag with no matching GitHub release', async () => {
		vi.mocked(githubReleases.resolveReleaseByTag).mockResolvedValue(null)
		const token = authAsAdmin('admin-2', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/launcher-releases/from-github')
			.set('Authorization', token)
			.send({ tag: 'v9.9.9' })

		expect(res.status).toBe(404)
	})

	it('returns 400 when the release has no recognized platform assets', async () => {
		vi.mocked(githubReleases.resolveReleaseByTag).mockResolvedValue({
			version: '1.0.0',
			notes: null,
			assets: [],
		})
		const token = authAsAdmin('admin-3', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/launcher-releases/from-github')
			.set('Authorization', token)
			.send({ tag: 'v1.0.0' })

		expect(res.status).toBe(400)
	})

	it('imports a release and upserts one asset row per matched platform', async () => {
		vi.mocked(githubReleases.resolveReleaseByTag).mockResolvedValue({
			version: '1.0.0',
			notes: 'changelog',
			assets: [
				{
					platform: 'windows',
					githubAssetId: 111,
					originalFilename: 'BET-Setup.exe',
					fileSize: 12,
					sha256: 'a'.repeat(64),
				},
				{
					platform: 'mac',
					githubAssetId: 222,
					originalFilename: 'BET.dmg',
					fileSize: 9,
					sha256: 'b'.repeat(64),
				},
			],
		})
		vi.mocked(launcherReleasesGateway.upsertRelease).mockResolvedValue({
			id: 1,
			version: '1.0.0',
			githubReleaseTag: 'v1.0.0',
			notes: 'changelog',
			createdAt: new Date(),
			updatedAt: new Date(),
		} as any)
		vi.mocked(
			launcherReleasesGateway.getReleaseWithAssetsById,
		).mockResolvedValue({
			id: 1,
			version: '1.0.0',
			githubReleaseTag: 'v1.0.0',
			notes: 'changelog',
			createdAt: new Date(),
			updatedAt: new Date(),
			assets: [],
		})

		const token = authAsAdmin('admin-4', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/launcher-releases/from-github')
			.set('Authorization', token)
			.send({ tag: 'v1.0.0' })

		expect(res.status).toBe(201)
		expect(launcherReleasesGateway.upsertRelease).toHaveBeenCalledWith(
			'1.0.0',
			'v1.0.0',
			'changelog',
		)
		expect(launcherReleasesGateway.upsertAsset).toHaveBeenCalledWith(
			1,
			'windows',
			{
				githubAssetId: 111,
				originalFilename: 'BET-Setup.exe',
				fileSize: 12,
				sha256: 'a'.repeat(64),
			},
		)
		expect(launcherReleasesGateway.upsertAsset).toHaveBeenCalledWith(1, 'mac', {
			githubAssetId: 222,
			originalFilename: 'BET.dmg',
			fileSize: 9,
			sha256: 'b'.repeat(64),
		})
	})
})

describe('DELETE /api/webadmin/launcher-releases/:id', () => {
	it('returns 403 for a moderator', async () => {
		const token = authAsModerator('mod-2', 'Mod')
		const res = await request(app)
			.delete('/api/webadmin/launcher-releases/1')
			.set('Authorization', token)

		expect(res.status).toBe(403)
		expect(launcherReleasesGateway.deleteRelease).not.toHaveBeenCalled()
	})

	it('returns 404 when the release does not exist', async () => {
		vi.mocked(launcherReleasesGateway.deleteRelease).mockResolvedValue(null)
		const token = authAsAdmin('admin-6', 'Admin')
		const res = await request(app)
			.delete('/api/webadmin/launcher-releases/999')
			.set('Authorization', token)

		expect(res.status).toBe(404)
	})

	it('deletes the release row', async () => {
		vi.mocked(launcherReleasesGateway.deleteRelease).mockResolvedValue({
			id: 3,
			version: '3.0.0',
			githubReleaseTag: 'v3.0.0',
			notes: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		} as any)
		const token = authAsAdmin('admin-7', 'Admin')
		const res = await request(app)
			.delete('/api/webadmin/launcher-releases/3')
			.set('Authorization', token)

		expect(res.status).toBe(200)
	})
})

describe('DELETE /api/webadmin/launcher-releases/:id/:platform', () => {
	it('returns 400 for an invalid platform', async () => {
		const token = authAsAdmin('admin-8', 'Admin')
		const res = await request(app)
			.delete('/api/webadmin/launcher-releases/1/xbox')
			.set('Authorization', token)

		expect(res.status).toBe(400)
	})

	it('returns 404 when the asset does not exist', async () => {
		vi.mocked(launcherReleasesGateway.deleteAssetRow).mockResolvedValue(null)
		const token = authAsAdmin('admin-9', 'Admin')
		const res = await request(app)
			.delete('/api/webadmin/launcher-releases/1/windows')
			.set('Authorization', token)

		expect(res.status).toBe(404)
	})

	it('deletes just the one platform asset row', async () => {
		vi.mocked(launcherReleasesGateway.deleteAssetRow).mockResolvedValue({
			id: 1,
			releaseId: 1,
			platform: 'linux',
			githubAssetId: 333,
			originalFilename: 'BET-linux.AppImage',
			fileSize: 5,
			sha256: 'd'.repeat(64),
			createdAt: new Date(),
		} as any)
		const token = authAsAdmin('admin-10', 'Admin')
		const res = await request(app)
			.delete('/api/webadmin/launcher-releases/1/linux')
			.set('Authorization', token)

		expect(res.status).toBe(200)
	})
})
