import { afterEach, describe, expect, it, vi } from 'vitest'
import {
	listGithubVersions,
	resolveCommitVersion,
	toPermanentUrl,
} from '../../features/mods/github-mod-versions.service.js'
import { checkDownloadAvailable } from '../../features/mods/ranked-pin-health.js'

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status })
}

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
	const fn = vi.fn(async (input: string | URL, init?: RequestInit) =>
		handler(input.toString(), init),
	)
	vi.stubGlobal('fetch', fn)
	return fn
}

afterEach(() => {
	vi.unstubAllGlobals()
})

const REPO = 'https://github.com/o/r'

describe('listGithubVersions', () => {
	it('lists releases then leftover tags, each with a permanent URL', async () => {
		mockFetch((url) => {
			if (url.endsWith('/repos/o/r/releases?per_page=100')) {
				return jsonResponse(200, [
					{
						tag_name: 'v2.0.0',
						draft: false,
						published_at: '2026-09-01T00:00:00Z',
						assets: [{ name: 'Mod.zip' }],
					},
					{ tag_name: 'v3.0.0', draft: true, published_at: null, assets: [] },
				])
			}
			if (url.endsWith('/repos/o/r/tags?per_page=100')) {
				return jsonResponse(200, [{ name: 'v2.0.0' }, { name: 'v1.0.0' }])
			}
			throw new Error(`unexpected fetch: ${url}`)
		})

		const versions = await listGithubVersions(
			REPO,
			`${REPO}/releases/latest/download/Mod.zip`,
		)

		expect(versions).toEqual([
			{
				name: 'v2.0.0',
				ref: 'v2.0.0',
				downloadUrl: `${REPO}/releases/download/v2.0.0/Mod.zip`,
				releasedAt: '2026-09-01T00:00:00Z',
			},
			{
				name: 'v1.0.0',
				ref: 'v1.0.0',
				downloadUrl: 'https://codeload.github.com/o/r/zip/refs/tags/v1.0.0',
				releasedAt: null,
			},
		])
	})

	it("uses the tag's source archive when the mod doesn't deploy a release asset", async () => {
		mockFetch((url) => {
			if (url.includes('/releases?')) {
				return jsonResponse(200, [
					{
						tag_name: 'v2.0.0',
						draft: false,
						published_at: null,
						assets: [{ name: 'Mod.zip' }],
					},
				])
			}
			return jsonResponse(200, [])
		})

		const versions = await listGithubVersions(REPO, null)

		expect(versions?.[0].downloadUrl).toBe(
			'https://codeload.github.com/o/r/zip/refs/tags/v2.0.0',
		)
	})

	it('returns null when GitHub cannot be read, and for a non-GitHub repo', async () => {
		mockFetch(() => new Response('rate limited', { status: 403 }))
		expect(await listGithubVersions(REPO, null)).toBeNull()
		expect(
			await listGithubVersions('https://codeberg.org/o/r', null),
		).toBeNull()
	})
})

describe('resolveCommitVersion', () => {
	it('resolves a SHA prefix to its full commit and archive URL', async () => {
		mockFetch((url) => {
			if (url.endsWith('/repos/o/r/commits/abc1234')) {
				return jsonResponse(200, {
					sha: 'abc1234def5678',
					commit: { committer: { date: '2026-09-10T00:00:00Z' } },
				})
			}
			throw new Error(`unexpected fetch: ${url}`)
		})

		expect(await resolveCommitVersion(REPO, 'abc1234')).toEqual({
			name: 'abc1234',
			ref: 'abc1234def5678',
			downloadUrl: 'https://codeload.github.com/o/r/zip/abc1234def5678',
			releasedAt: '2026-09-10T00:00:00Z',
		})
	})

	it('rejects a malformed SHA without calling GitHub', async () => {
		const fetchMock = mockFetch(() => {
			throw new Error('should not fetch')
		})
		expect(await resolveCommitVersion(REPO, 'main; rm -rf')).toBeNull()
		expect(fetchMock).not.toHaveBeenCalled()
	})
})

describe('toPermanentUrl', () => {
	it('passes Thunderstore and already-permanent GitHub URLs through', async () => {
		const fetchMock = mockFetch(() => {
			throw new Error('should not fetch')
		})
		for (const url of [
			'https://thunderstore.io/package/download/A/B/1.0.0/',
			'https://codeload.github.com/o/r/zip/abc1234def',
			`${REPO}/releases/download/v1.0.0/Mod.zip`,
		]) {
			expect(await toPermanentUrl(url, REPO, null)).toBe(url)
		}
		expect(fetchMock).not.toHaveBeenCalled()
	})

	it('turns a branch archive into the commit archive of its head (or of the known ref)', async () => {
		mockFetch((url) => {
			if (url.endsWith('/repos/o/r/commits/dev')) {
				return jsonResponse(200, { sha: 'feedface0001' })
			}
			throw new Error(`unexpected fetch: ${url}`)
		})
		expect(
			await toPermanentUrl(`${REPO}/archive/refs/heads/dev.zip`, REPO, null),
		).toBe('https://codeload.github.com/o/r/zip/feedface0001')
		expect(
			await toPermanentUrl(
				`${REPO}/archive/refs/heads/dev.zip`,
				REPO,
				'cafe01',
			),
		).toBe('https://codeload.github.com/o/r/zip/cafe01')
	})

	it('pins a "latest release" asset to the tag it currently resolves to', async () => {
		mockFetch((url) => {
			if (url.endsWith('/repos/o/r/releases/latest')) {
				return jsonResponse(200, { tag_name: 'v4.0.0' })
			}
			throw new Error(`unexpected fetch: ${url}`)
		})
		expect(
			await toPermanentUrl(
				`${REPO}/releases/latest/download/Mod.zip`,
				REPO,
				null,
			),
		).toBe(`${REPO}/releases/download/v4.0.0/Mod.zip`)
	})

	it('maps tag archives (and version-like legacy ones) to codeload tags', async () => {
		mockFetch(() => {
			throw new Error('should not fetch')
		})
		expect(
			await toPermanentUrl(`${REPO}/archive/refs/tags/v1.2.zip`, REPO, null),
		).toBe('https://codeload.github.com/o/r/zip/refs/tags/v1.2')
		expect(await toPermanentUrl(`${REPO}/archive/v1.2.zip`, REPO, null)).toBe(
			'https://codeload.github.com/o/r/zip/refs/tags/v1.2',
		)
	})

	it('returns null when a moving URL cannot be resolved right now', async () => {
		mockFetch(() => jsonResponse(404, {}))
		expect(
			await toPermanentUrl(`${REPO}/archive/refs/heads/gone.zip`, REPO, null),
		).toBeNull()
	})
})

describe('checkDownloadAvailable', () => {
	it('is ok on a 2xx and unavailable on a 404', async () => {
		mockFetch(
			(url) =>
				new Response(null, { status: url.endsWith('/gone') ? 404 : 200 }),
		)
		expect(await checkDownloadAvailable('https://x/ok')).toBe('ok')
		expect(await checkDownloadAvailable('https://x/gone')).toBe('unavailable')
	})

	it('falls back to a ranged GET when HEAD is refused', async () => {
		const fetchMock = mockFetch(
			(_url, init) =>
				new Response(null, { status: init?.method === 'HEAD' ? 405 : 206 }),
		)
		expect(await checkDownloadAvailable('https://x/file')).toBe('ok')
		expect(fetchMock).toHaveBeenCalledTimes(2)
	})

	it('is unknown (null) on a 5xx or network error, so a transient outage never flips a pin', async () => {
		mockFetch(() => new Response(null, { status: 503 }))
		expect(await checkDownloadAvailable('https://x/file')).toBeNull()
		mockFetch(() => {
			throw new Error('ECONNRESET')
		})
		expect(await checkDownloadAvailable('https://x/file')).toBeNull()
	})
})
