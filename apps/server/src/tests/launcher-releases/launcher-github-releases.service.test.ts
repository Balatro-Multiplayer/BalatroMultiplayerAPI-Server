import { afterEach, describe, expect, it, vi } from 'vitest'

// GITHUB_TOKEN is read once at env.js's module-load time, same constraint
// the old launcher-release-storage.test.ts had for LAUNCHER_RELEASES_DIR --
// must be set (or deliberately left unset) before this module is ever
// imported, so every test that needs a different token state uses
// vi.resetModules() + a fresh dynamic import rather than a static top-level
// import.
// biome-ignore format: same `typeof import(...)` wrapping issue the old
// launcher-release-storage.test.ts's own ignore comment noted.
type ServiceModule =
	typeof import('../../features/launcher-releases/launcher-github-releases.service.js')

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status })
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string | URL, init?: RequestInit) =>
			handler(input.toString(), init),
		),
	)
}

async function loadWithToken(
	token: string | undefined,
): Promise<ServiceModule> {
	vi.resetModules()
	if (token === undefined) {
		// process.env is not a plain object - assigning undefined instead of
		// deleting would coerce to the *string* "undefined" (Node's
		// process.env always stringifies), which is truthy and would
		// silently defeat this test's whole point.
		// biome-ignore lint/performance/noDelete: see above
		delete process.env.GITHUB_TOKEN
	} else {
		process.env.GITHUB_TOKEN = token
	}
	return import(
		'../../features/launcher-releases/launcher-github-releases.service.js'
	)
}

describe('launcher-github-releases.service', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	describe('assertSafeVersion', () => {
		it('accepts a normal version string', async () => {
			const svc = await loadWithToken('test-token')
			expect(() => svc.assertSafeVersion('1.2.3')).not.toThrow()
		})

		it('rejects path traversal', async () => {
			// Message-based, not instanceof AppError -- loadWithToken's
			// vi.resetModules() gives this call's svc its own fresh copy of
			// errors.js, so an AppError thrown from inside svc is not an
			// instanceof the AppError this file would import at its own
			// top level.
			const svc = await loadWithToken('test-token')
			expect(() => svc.assertSafeVersion('../../etc/passwd')).toThrow(
				/1-64 characters/,
			)
		})

		it('rejects an empty string', async () => {
			const svc = await loadWithToken('test-token')
			expect(() => svc.assertSafeVersion('')).toThrow(/1-64 characters/)
		})
	})

	describe('without GITHUB_TOKEN configured', () => {
		it('resolveReleaseByTag throws a clear config error rather than an unauthenticated call', async () => {
			mockFetch(() => {
				throw new Error('fetch should never be called without a token')
			})
			const svc = await loadWithToken(undefined)
			await expect(svc.resolveReleaseByTag('v0.2.0')).rejects.toThrow(
				/GITHUB_TOKEN is not configured/,
			)
		})
	})

	describe('resolveReleaseByTag', () => {
		it('matches all three platforms by exact filename, strips the sha256: digest prefix, and derives version from the tag', async () => {
			mockFetch((url) => {
				expect(url).toContain(
					'/repos/Balatro-Multiplayer/new-launcher/releases/tags/v0.2.0',
				)
				return jsonResponse(200, {
					tag_name: 'v0.2.0',
					name: 'v0.2.0',
					body: 'release notes here',
					published_at: '2026-08-20T00:00:00Z',
					assets: [
						{
							id: 111,
							name: 'BET-Setup.exe',
							size: 36003236,
							digest: 'sha256:aaaa',
						},
						{ id: 222, name: 'BET.dmg', size: 35448950, digest: 'sha256:bbbb' },
						{
							id: 333,
							name: 'BET-linux.AppImage',
							size: 39762424,
							digest: 'sha256:cccc',
						},
					],
				})
			})

			const svc = await loadWithToken('test-token')
			const result = await svc.resolveReleaseByTag('v0.2.0')

			expect(result).toEqual({
				version: '0.2.0',
				notes: 'release notes here',
				assets: [
					{
						platform: 'windows',
						githubAssetId: 111,
						originalFilename: 'BET-Setup.exe',
						fileSize: 36003236,
						sha256: 'aaaa',
					},
					{
						platform: 'mac',
						githubAssetId: 222,
						originalFilename: 'BET.dmg',
						fileSize: 35448950,
						sha256: 'bbbb',
					},
					{
						platform: 'linux',
						githubAssetId: 333,
						originalFilename: 'BET-linux.AppImage',
						fileSize: 39762424,
						sha256: 'cccc',
					},
				],
			})
		})

		it('falls back to extension matching for a renamed asset', async () => {
			mockFetch(() =>
				jsonResponse(200, {
					tag_name: 'v0.2.0',
					name: null,
					body: null,
					published_at: '2026-08-20T00:00:00Z',
					assets: [
						{
							id: 999,
							name: 'BET-Windows-Installer.exe',
							size: 123,
							digest: 'sha256:dddd',
						},
					],
				}),
			)
			const svc = await loadWithToken('test-token')
			const result = await svc.resolveReleaseByTag('v0.2.0')
			expect(result?.assets).toEqual([
				{
					platform: 'windows',
					githubAssetId: 999,
					originalFilename: 'BET-Windows-Installer.exe',
					fileSize: 123,
					sha256: 'dddd',
				},
			])
		})

		it('skips an unrecognized asset without erroring', async () => {
			mockFetch(() =>
				jsonResponse(200, {
					tag_name: 'v0.2.0',
					name: null,
					body: null,
					published_at: '2026-08-20T00:00:00Z',
					assets: [
						{ id: 1, name: 'checksums.txt', size: 10, digest: 'sha256:eeee' },
					],
				}),
			)
			const svc = await loadWithToken('test-token')
			const result = await svc.resolveReleaseByTag('v0.2.0')
			expect(result?.assets).toEqual([])
		})

		it('throws if a matched platform asset has no sha256 digest', async () => {
			mockFetch(() =>
				jsonResponse(200, {
					tag_name: 'v0.2.0',
					name: null,
					body: null,
					published_at: '2026-08-20T00:00:00Z',
					assets: [{ id: 1, name: 'BET.dmg', size: 10, digest: null }],
				}),
			)
			const svc = await loadWithToken('test-token')
			await expect(svc.resolveReleaseByTag('v0.2.0')).rejects.toThrow(
				/no sha256 digest/,
			)
		})

		it('returns null for a tag that does not exist', async () => {
			mockFetch(() => jsonResponse(404, { message: 'Not Found' }))
			const svc = await loadWithToken('test-token')
			await expect(svc.resolveReleaseByTag('v9.9.9')).resolves.toBeNull()
		})
	})

	describe('resolveAssetDownloadStream', () => {
		it('follows the redirect and does NOT forward the GitHub auth header to the signed URL', async () => {
			let secondRequestHeaders: HeadersInit | undefined
			mockFetch((url, init) => {
				if (url.includes('/releases/assets/111')) {
					expect((init?.headers as Record<string, string>).Authorization).toBe(
						'token test-token',
					)
					return new Response(null, {
						status: 302,
						headers: { Location: 'https://signed.blob.example/asset111' },
					})
				}
				if (url === 'https://signed.blob.example/asset111') {
					secondRequestHeaders = init?.headers
					return new Response('binary content', { status: 200 })
				}
				throw new Error(`unexpected fetch: ${url}`)
			})

			const svc = await loadWithToken('test-token')
			const res = await svc.resolveAssetDownloadStream(111)
			expect(await res.text()).toBe('binary content')
			expect(secondRequestHeaders).toBeUndefined()
		})

		it('throws if GitHub does not redirect as expected', async () => {
			mockFetch(() => jsonResponse(401, { message: 'Bad credentials' }))
			const svc = await loadWithToken('test-token')
			await expect(svc.resolveAssetDownloadStream(111)).rejects.toThrow(
				/did not redirect/,
			)
		})
	})

	describe('listRecentReleases', () => {
		it('maps the GitHub releases list response', async () => {
			mockFetch((url) => {
				expect(url).toContain(
					'/repos/Balatro-Multiplayer/new-launcher/releases?per_page=20',
				)
				return jsonResponse(200, [
					{
						tag_name: 'v0.2.0',
						name: 'v0.2.0',
						body: 'notes',
						published_at: '2026-08-20T00:00:00Z',
						assets: [],
					},
				])
			})
			const svc = await loadWithToken('test-token')
			await expect(svc.listRecentReleases()).resolves.toEqual([
				{
					tag: 'v0.2.0',
					name: 'v0.2.0',
					publishedAt: '2026-08-20T00:00:00Z',
					body: 'notes',
				},
			])
		})
	})
})
