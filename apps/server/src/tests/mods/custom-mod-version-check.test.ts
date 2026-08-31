import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppError } from '../../shared/utils/errors.js'
import {
	checkCustomModVersion,
	resolveSourceInput,
} from '../../features/mods/custom-mod-version-check.service.js'

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), { status })
}

function mockFetch(handler: (url: string) => Response) {
	vi.stubGlobal(
		'fetch',
		vi.fn(async (input: string | URL) => handler(input.toString())),
	)
}

describe('checkCustomModVersion', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('resolves via latest-release-tag when no special URL pattern applies', async () => {
		mockFetch((url) => {
			if (url.endsWith('/repos/Alice/Mod/releases/latest')) {
				return jsonResponse(200, { tag_name: 'v2.0.0' })
			}
			throw new Error(`unexpected fetch: ${url}`)
		})

		const result = await checkCustomModVersion({
			repoUrl: 'https://github.com/Alice/Mod',
			latestVersion: 'v1.0.0',
			latestDownloadUrl:
				'https://github.com/Alice/Mod/releases/latest/download/mod.zip',
			fixedReleaseTagUpdates: false,
		})

		expect(result).toEqual({
			newVersion: 'v2.0.0',
			newDownloadUrl: null,
			source: 'latest_tag',
		})
	})

	it('falls back to HEAD when the repo has zero releases', async () => {
		mockFetch((url) => {
			if (url.endsWith('/repos/Bob/Mod/releases/latest')) {
				return jsonResponse(404, {})
			}
			if (url.endsWith('/repos/Bob/Mod/commits')) {
				return jsonResponse(200, [{ sha: 'abcdef1234567890' }])
			}
			throw new Error(`unexpected fetch: ${url}`)
		})

		const result = await checkCustomModVersion({
			repoUrl: 'https://github.com/Bob/Mod',
			latestVersion: 'old-sha',
			latestDownloadUrl:
				'https://github.com/Bob/Mod/releases/latest/download/mod.zip',
			fixedReleaseTagUpdates: false,
		})

		expect(result).toEqual({
			newVersion: 'abcdef1',
			newDownloadUrl: null,
			source: 'head',
		})
	})

	it('resolves via the specific release asset tag, tie-breaking by created_at string comparison', async () => {
		mockFetch((url) => {
			if (url.endsWith('/repos/Carol/Mod/releases/tags/v1.5.0')) {
				return jsonResponse(200, {
					assets: [
						{ name: 'mod-old.zip', created_at: '2026-01-01T00:00:00Z' },
						{ name: 'mod-new.zip', created_at: '2026-06-01T00:00:00Z' },
					],
				})
			}
			throw new Error(`unexpected fetch: ${url}`)
		})

		const result = await checkCustomModVersion({
			repoUrl: 'https://github.com/Carol/Mod',
			latestVersion: null,
			latestDownloadUrl:
				'https://github.com/Carol/Mod/releases/download/v1.5.0/mod-old.zip',
			fixedReleaseTagUpdates: true,
		})

		expect(result).toEqual({
			newVersion: '20260601_000000',
			newDownloadUrl:
				'https://github.com/Carol/Mod/releases/download/v1.5.0/mod-new.zip',
			source: 'specific_tag',
		})
	})

	it('resolves via HEAD when latestDownloadUrl points at a branch archive', async () => {
		mockFetch((url) => {
			if (url.endsWith('/repos/Dave/Mod/commits')) {
				return jsonResponse(200, [{ sha: '1234567890abcdef' }])
			}
			throw new Error(`unexpected fetch: ${url}`)
		})

		const result = await checkCustomModVersion({
			repoUrl: 'https://github.com/Dave/Mod',
			latestVersion: 'old-sha',
			latestDownloadUrl:
				'https://github.com/Dave/Mod/archive/refs/heads/main.zip',
			fixedReleaseTagUpdates: false,
		})

		expect(result).toEqual({
			newVersion: '1234567',
			newDownloadUrl: null,
			source: 'head',
		})
	})

	it('returns null when the resolved version matches the current one', async () => {
		mockFetch((url) => {
			if (url.endsWith('/repos/Alice/Mod/releases/latest')) {
				return jsonResponse(200, { tag_name: 'v1.0.0' })
			}
			throw new Error(`unexpected fetch: ${url}`)
		})

		const result = await checkCustomModVersion({
			repoUrl: 'https://github.com/Alice/Mod',
			latestVersion: 'v1.0.0',
			latestDownloadUrl:
				'https://github.com/Alice/Mod/releases/latest/download/mod.zip',
			fixedReleaseTagUpdates: false,
		})

		expect(result).toBeNull()
	})

	it('returns null when repoUrl is missing', async () => {
		mockFetch(() => {
			throw new Error('should not fetch')
		})

		const result = await checkCustomModVersion({
			repoUrl: null,
			latestVersion: null,
			latestDownloadUrl: null,
			fixedReleaseTagUpdates: false,
		})

		expect(result).toBeNull()
	})

	it('returns null (not throw) when GitHub responds rate-limited', async () => {
		const rateLimited = () =>
			new Response('rate limit exceeded', {
				status: 403,
				headers: { 'x-ratelimit-remaining': '0' },
			})
		mockFetch((url) => {
			// LATEST_TAG's primary call is rate-limited, so it falls back to HEAD
			// (same as a zero-releases 404 would) -- which is rate-limited too,
			// so the end-to-end result is still "no update this cycle", not a
			// thrown error.
			if (url.endsWith('/repos/Alice/Mod/releases/latest')) return rateLimited()
			if (url.endsWith('/repos/Alice/Mod/commits')) return rateLimited()
			throw new Error(`unexpected fetch: ${url}`)
		})

		const result = await checkCustomModVersion({
			repoUrl: 'https://github.com/Alice/Mod',
			latestVersion: 'v1.0.0',
			latestDownloadUrl:
				'https://github.com/Alice/Mod/releases/latest/download/mod.zip',
			fixedReleaseTagUpdates: false,
		})

		expect(result).toBeNull()
	})
})

describe('resolveSourceInput', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('branch: resolves that specific branch\'s own HEAD, not the default branch\'s', async () => {
		mockFetch((url) => {
			// /commits/{ref} (a single commit object), not /commits (an array) -
			// the whole point is this must ask for the named branch specifically.
			if (url.endsWith('/repos/Alice/Mod/commits/dev')) {
				return jsonResponse(200, { sha: 'aaaaaaaaaaaaaaaa' })
			}
			throw new Error(`unexpected fetch: ${url}`)
		})

		const result = await resolveSourceInput({
			sourceType: 'branch',
			repoUrl: 'https://github.com/Alice/Mod',
			branch: 'dev',
		})

		expect(result).toEqual({
			latestDownloadUrl: 'https://github.com/Alice/Mod/archive/refs/heads/dev.zip',
			latestVersion: 'aaaaaaa',
		})
	})

	it("branch: throws when the branch doesn't resolve", async () => {
		mockFetch(() => jsonResponse(404, {}))

		await expect(
			resolveSourceInput({
				sourceType: 'branch',
				repoUrl: 'https://github.com/Alice/Mod',
				branch: 'nonexistent',
			}),
		).rejects.toThrow(AppError)
	})

	it('release: resolves the latest tag into an archive/refs/tags URL', async () => {
		mockFetch((url) => {
			if (url.endsWith('/repos/Bob/Mod/releases/latest')) {
				return jsonResponse(200, { tag_name: 'v3.0.0' })
			}
			throw new Error(`unexpected fetch: ${url}`)
		})

		const result = await resolveSourceInput({
			sourceType: 'release',
			repoUrl: 'https://github.com/Bob/Mod',
		})

		expect(result).toEqual({
			latestDownloadUrl: 'https://github.com/Bob/Mod/archive/refs/tags/v3.0.0.zip',
			latestVersion: 'v3.0.0',
		})
	})

	it('release: throws when the repo has zero releases', async () => {
		mockFetch(() => jsonResponse(404, {}))

		await expect(
			resolveSourceInput({
				sourceType: 'release',
				repoUrl: 'https://github.com/Bob/Mod',
			}),
		).rejects.toThrow(AppError)
	})

	it('branch/release: throws on a repoUrl that is not a github.com URL', async () => {
		mockFetch(() => {
			throw new Error('should not fetch')
		})

		await expect(
			resolveSourceInput({
				sourceType: 'release',
				repoUrl: 'https://example.com/not-github',
			}),
		).rejects.toThrow(AppError)
	})

	it('custom: passes the URL through untouched with no network call at all', async () => {
		mockFetch(() => {
			throw new Error('should not fetch')
		})

		const result = await resolveSourceInput({
			sourceType: 'custom',
			url: 'https://example.com/mod.zip',
		})

		expect(result).toEqual({
			latestDownloadUrl: 'https://example.com/mod.zip',
			latestVersion: null,
		})
	})
})
