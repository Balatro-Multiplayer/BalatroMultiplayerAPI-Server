import { Readable } from 'node:stream'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import * as githubReleases from '../../features/launcher-releases/launcher-github-releases.service.js'
import * as launcherReleasesGateway from '../../infrastructure/gateways/launcher-releases.gateway.js'
import { createTestApp } from './app.js'

vi.mock('../../infrastructure/gateways/launcher-releases.gateway.js', () => ({
	getLatestRelease: vi.fn(),
	getReleaseByVersion: vi.fn(),
	getAsset: vi.fn(),
}))

// biome-ignore format: vi.mock's path argument must stay a literal on the
// same call as vi.mock( for Vitest's static hoisting to find it -- wrapping
// this call across lines breaks the mock silently (throws "no export
// defined on the mock" at request time instead of at import time).
vi.mock('../../features/launcher-releases/launcher-github-releases.service.js', async (importOriginal) => {
	const actual = await importOriginal<typeof import('../../features/launcher-releases/launcher-github-releases.service.js')>()
	return {
		...actual,
		resolveAssetDownloadStream: vi.fn(),
	}
})

const app = createTestApp()

describe('GET /api/launcher/latest', () => {
	it('returns 404 when no release has ever been imported', async () => {
		vi.mocked(launcherReleasesGateway.getLatestRelease).mockResolvedValue(null)
		const res = await request(app).get('/api/launcher/latest')
		expect(res.status).toBe(404)
	})

	it('returns all three platforms, null for ones with no binary yet', async () => {
		vi.mocked(launcherReleasesGateway.getLatestRelease).mockResolvedValue({
			id: 1,
			version: '1.2.0',
			githubReleaseTag: 'v1.2.0',
			notes: null,
			createdAt: new Date('2026-08-10T12:00:00Z'),
			updatedAt: new Date('2026-08-10T12:00:00Z'),
			assets: [
				{
					platform: 'windows',
					githubAssetId: 111,
					originalFilename: 'launcher.exe',
					fileSize: 100,
					sha256: 'a'.repeat(64),
				},
			],
		})

		const res = await request(app).get('/api/launcher/latest')
		expect(res.status).toBe(200)
		expect(res.body.version).toBe('1.2.0')
		expect(res.body.platforms.windows).toEqual({
			downloadUrl: '/api/launcher/download/1.2.0/windows',
			sha256: 'a'.repeat(64),
			fileSize: 100,
			filename: 'launcher.exe',
		})
		expect(res.body.platforms.mac).toBeNull()
		expect(res.body.platforms.linux).toBeNull()
	})
})

describe('GET /api/launcher/download/:version/:platform', () => {
	it('returns 400 for an invalid platform', async () => {
		const res = await request(app).get('/api/launcher/download/1.0.0/xbox')
		expect(res.status).toBe(400)
	})

	it('returns 400 for an unsafe version', async () => {
		const res = await request(app).get(
			'/api/launcher/download/..%2F..%2Fetc/windows',
		)
		expect(res.status).toBe(400)
	})

	it('returns 404 when the version does not exist', async () => {
		vi.mocked(launcherReleasesGateway.getReleaseByVersion).mockResolvedValue(
			null,
		)
		const res = await request(app).get('/api/launcher/download/9.9.9/windows')
		expect(res.status).toBe(404)
	})

	it('returns 404 when the version exists but has no binary for that platform', async () => {
		vi.mocked(launcherReleasesGateway.getReleaseByVersion).mockResolvedValue({
			id: 1,
			version: '1.0.0',
			githubReleaseTag: 'v1.0.0',
			notes: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		} as any)
		vi.mocked(launcherReleasesGateway.getAsset).mockResolvedValue(null)
		const res = await request(app).get('/api/launcher/download/1.0.0/linux')
		expect(res.status).toBe(404)
	})

	it('streams the proxied GitHub asset with the right headers', async () => {
		vi.mocked(launcherReleasesGateway.getReleaseByVersion).mockResolvedValue({
			id: 1,
			version: '1.0.0',
			githubReleaseTag: 'v1.0.0',
			notes: null,
			createdAt: new Date(),
			updatedAt: new Date(),
		} as any)
		vi.mocked(launcherReleasesGateway.getAsset).mockResolvedValue({
			id: 1,
			releaseId: 1,
			platform: 'windows',
			githubAssetId: 111,
			originalFilename: 'balatro-multiplayer-launcher.exe',
			fileSize: 5,
			sha256: 'a'.repeat(64),
			createdAt: new Date(),
		} as any)
		vi.mocked(githubReleases.resolveAssetDownloadStream).mockResolvedValue({
			body: Readable.toWeb(Readable.from([Buffer.from('hello')])),
		} as Response)

		const res = await request(app).get('/api/launcher/download/1.0.0/windows')
		expect(res.status).toBe(200)
		expect(res.headers['content-disposition']).toContain(
			'balatro-multiplayer-launcher.exe',
		)
		expect(res.headers['content-length']).toBe('5')
		expect(res.text).toBe('hello')
	})
})
