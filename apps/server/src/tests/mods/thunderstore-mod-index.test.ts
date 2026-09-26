import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchThunderstoreModIndex } from '../../features/mods/thunderstore-mod-index.service.js'

function version(overrides: Record<string, unknown> = {}) {
	return {
		version_number: '1.2.0',
		download_url:
			'https://thunderstore.io/package/download/Alice/NormalMod/1.2.0/',
		description: 'A normal mod',
		icon: 'https://gcdn.thunderstore.io/live/repository/icons/Alice-NormalMod-1.2.0.png',
		website_url: 'https://github.com/Alice/NormalMod',
		dependencies: ['Thunderstore-lovely-0.7.1'],
		date_created: '2026-09-01T00:00:00Z',
		is_active: true,
		...overrides,
	}
}

function pkg(overrides: Record<string, unknown>) {
	return {
		name: 'NormalMod',
		full_name: 'Alice-NormalMod',
		owner: 'Alice',
		categories: ['Jokers'],
		package_url: 'https://thunderstore.io/c/balatro/p/Alice/NormalMod/',
		date_updated: '2026-09-02T00:00:00Z',
		is_deprecated: false,
		versions: [version()],
		...overrides,
	}
}

beforeEach(() => {
	vi.stubGlobal('fetch', vi.fn())
})

afterEach(() => {
	vi.unstubAllGlobals()
})

function stubResponse(packages: unknown[]) {
	;(fetch as any).mockResolvedValue(
		new Response(JSON.stringify(packages), { status: 200 }),
	)
}

describe('fetchThunderstoreModIndex', () => {
	it('maps a normal active package from its latest active version', async () => {
		stubResponse([
			pkg({
				donation_link: 'https://ko-fi.com/alice',
				versions: [
					version({ version_number: '1.3.0', is_active: false }),
					version(),
					version({
						version_number: '1.1.0',
						download_url:
							'https://thunderstore.io/package/download/Alice/NormalMod/1.1.0/',
						date_created: '2026-08-01T00:00:00Z',
					}),
				],
			}),
		])

		const { entries, skipped } = await fetchThunderstoreModIndex()

		expect(skipped).toBe(0)
		expect(entries).toEqual([
			{
				fullName: 'Alice-NormalMod',
				title: 'NormalMod',
				author: 'Alice',
				categories: ['Jokers'],
				requiresSteamodded: false,
				requiresTalisman: false,
				repoUrl: 'https://github.com/Alice/NormalMod',
				thumbnailUrl:
					'https://gcdn.thunderstore.io/live/repository/icons/Alice-NormalMod-1.2.0.png',
				description: 'A normal mod',
				packageUrl: 'https://thunderstore.io/c/balatro/p/Alice/NormalMod/',
				donationLink: 'https://ko-fi.com/alice',
				latestVersion: '1.2.0',
				latestDownloadUrl:
					'https://thunderstore.io/package/download/Alice/NormalMod/1.2.0/',
				sourceUpdatedAt: '2026-09-02T00:00:00Z',
				versions: [
					{
						version: '1.2.0',
						downloadUrl:
							'https://thunderstore.io/package/download/Alice/NormalMod/1.2.0/',
						releasedAt: '2026-09-01T00:00:00Z',
						dependencies: ['Thunderstore-lovely-0.7.1'],
					},
					{
						version: '1.1.0',
						downloadUrl:
							'https://thunderstore.io/package/download/Alice/NormalMod/1.1.0/',
						releasedAt: '2026-08-01T00:00:00Z',
						dependencies: ['Thunderstore-lovely-0.7.1'],
					},
				],
			},
		])
	})

	it('serves null for a missing donation link and empty website/icon', async () => {
		stubResponse([pkg({ versions: [version({ website_url: '', icon: '' })] })])

		const { entries } = await fetchThunderstoreModIndex()

		expect(entries[0]).toMatchObject({
			donationLink: null,
			repoUrl: null,
			thumbnailUrl: null,
		})
	})

	it('derives requires-flags from any active version, whatever the owner', async () => {
		stubResponse([
			pkg({
				versions: [
					version(),
					version({
						version_number: '1.0.0',
						dependencies: [
							'Steamopollys-Steamodded-1.0.0',
							'Someone-Talisman-2.0.0',
						],
					}),
				],
			}),
		])

		const { entries } = await fetchThunderstoreModIndex()

		expect(entries[0]).toMatchObject({
			requiresSteamodded: true,
			requiresTalisman: true,
		})
	})

	it('excludes a deprecated package and counts it as skipped', async () => {
		stubResponse([pkg({ is_deprecated: true })])

		const { entries, skipped } = await fetchThunderstoreModIndex()

		expect(entries).toHaveLength(0)
		expect(skipped).toBe(1)
	})

	it('excludes a package whose only version is inactive, counted as skipped', async () => {
		stubResponse([pkg({ versions: [version({ is_active: false })] })])

		const { entries, skipped } = await fetchThunderstoreModIndex()

		expect(entries).toHaveLength(0)
		expect(skipped).toBe(1)
	})
})
