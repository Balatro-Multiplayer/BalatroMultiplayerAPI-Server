import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { signJwt } from '../../features/auth/jwt.js'
import * as storage from '../../features/launcher-releases/launcher-release-storage.js'
import * as launcherReleasesGateway from '../../infrastructure/gateways/launcher-releases.gateway.js'
import * as playerGateway from '../../infrastructure/gateways/player.gateway.js'
import { createSession } from '../../state/index.js'
import { createTestApp } from './app.js'

vi.mock('../../infrastructure/gateways/launcher-releases.gateway.js', () => ({
	listReleases: vi.fn(),
	getAsset: vi.fn(),
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
vi.mock('../../features/launcher-releases/launcher-release-storage.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../features/launcher-releases/launcher-release-storage.js')>()
	return {
		...actual,
		writeAsset: vi.fn(),
		deleteAsset: vi.fn(),
		deleteVersionDir: vi.fn(),
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

describe('POST /api/webadmin/launcher-releases', () => {
	it('returns 403 for a moderator', async () => {
		const token = authAsModerator('mod-1', 'Mod')
		const res = await request(app)
			.post('/api/webadmin/launcher-releases')
			.set('Authorization', token)
			.field('version', '1.0.0')
			.attach('windows', Buffer.from('exe contents'), 'launcher.exe')

		expect(res.status).toBe(403)
		expect(launcherReleasesGateway.upsertRelease).not.toHaveBeenCalled()
	})

	it('returns 400 when version is missing', async () => {
		const token = authAsAdmin('admin-1', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/launcher-releases')
			.set('Authorization', token)
			.attach('windows', Buffer.from('exe contents'), 'launcher.exe')

		expect(res.status).toBe(400)
	})

	it('returns 400 when no platform file is attached', async () => {
		const token = authAsAdmin('admin-2', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/launcher-releases')
			.set('Authorization', token)
			.field('version', '1.0.0')

		expect(res.status).toBe(400)
	})

	it('returns 400 for an unsafe version string', async () => {
		const token = authAsAdmin('admin-3', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/launcher-releases')
			.set('Authorization', token)
			.field('version', '../../etc')
			.attach('windows', Buffer.from('exe contents'), 'launcher.exe')

		expect(res.status).toBe(400)
	})

	it('uploads a single platform binary and upserts the release/asset', async () => {
		vi.mocked(launcherReleasesGateway.upsertRelease).mockResolvedValue({
			id: 1,
			version: '1.0.0',
			notes: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		} as any)
		vi.mocked(launcherReleasesGateway.getAsset).mockResolvedValue(null)
		vi.mocked(storage.writeAsset).mockResolvedValue({
			storagePath: '1.0.0/windows.exe',
			sha256: 'a'.repeat(64),
			fileSize: 12,
		})
		vi.mocked(
			launcherReleasesGateway.getReleaseWithAssetsById,
		).mockResolvedValue({
			id: 1,
			version: '1.0.0',
			notes: null,
			createdAt: new Date(),
			updatedAt: new Date(),
			assets: [],
		})

		const token = authAsAdmin('admin-4', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/launcher-releases')
			.set('Authorization', token)
			.field('version', '1.0.0')
			.attach('windows', Buffer.from('exe contents'), 'launcher.exe')

		expect(res.status).toBe(201)
		expect(launcherReleasesGateway.upsertRelease).toHaveBeenCalledWith(
			'1.0.0',
			undefined,
		)
		expect(storage.writeAsset).toHaveBeenCalledWith(
			'1.0.0',
			'windows',
			'.exe',
			expect.any(String),
		)
		expect(launcherReleasesGateway.upsertAsset).toHaveBeenCalledWith(
			1,
			'windows',
			{
				storagePath: '1.0.0/windows.exe',
				originalFilename: 'launcher.exe',
				fileSize: 12,
				sha256: 'a'.repeat(64),
			},
		)
	})

	it('deletes the old file when replacing a platform with a different extension', async () => {
		vi.mocked(launcherReleasesGateway.upsertRelease).mockResolvedValue({
			id: 2,
			version: '2.0.0',
			notes: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		} as any)
		vi.mocked(launcherReleasesGateway.getAsset).mockResolvedValue({
			id: 1,
			releaseId: 2,
			platform: 'mac',
			storagePath: '2.0.0/mac.zip',
			originalFilename: 'old.zip',
			fileSize: 5,
			sha256: 'b'.repeat(64),
			createdAt: new Date(),
		} as any)
		vi.mocked(storage.writeAsset).mockResolvedValue({
			storagePath: '2.0.0/mac.dmg',
			sha256: 'c'.repeat(64),
			fileSize: 9,
		})
		vi.mocked(
			launcherReleasesGateway.getReleaseWithAssetsById,
		).mockResolvedValue({
			id: 2,
			version: '2.0.0',
			notes: null,
			createdAt: new Date(),
			updatedAt: new Date(),
			assets: [],
		})

		const token = authAsAdmin('admin-5', 'Admin')
		const res = await request(app)
			.post('/api/webadmin/launcher-releases')
			.set('Authorization', token)
			.field('version', '2.0.0')
			.attach('mac', Buffer.from('dmg contents'), 'launcher.dmg')

		expect(res.status).toBe(201)
		expect(storage.deleteAsset).toHaveBeenCalledWith('2.0.0/mac.zip')
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

	it('deletes the release row and its version directory', async () => {
		vi.mocked(launcherReleasesGateway.deleteRelease).mockResolvedValue({
			id: 3,
			version: '3.0.0',
			notes: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		} as any)
		const token = authAsAdmin('admin-7', 'Admin')
		const res = await request(app)
			.delete('/api/webadmin/launcher-releases/3')
			.set('Authorization', token)

		expect(res.status).toBe(200)
		expect(storage.deleteVersionDir).toHaveBeenCalledWith('3.0.0')
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

	it('deletes just the one platform asset', async () => {
		vi.mocked(launcherReleasesGateway.deleteAssetRow).mockResolvedValue({
			id: 1,
			releaseId: 1,
			platform: 'linux',
			storagePath: '1.0.0/linux.AppImage',
			originalFilename: 'launcher.AppImage',
			fileSize: 5,
			sha256: 'd'.repeat(64),
			createdAt: new Date(),
		} as any)
		const token = authAsAdmin('admin-10', 'Admin')
		const res = await request(app)
			.delete('/api/webadmin/launcher-releases/1/linux')
			.set('Authorization', token)

		expect(res.status).toBe(200)
		expect(storage.deleteAsset).toHaveBeenCalledWith('1.0.0/linux.AppImage')
	})
})
