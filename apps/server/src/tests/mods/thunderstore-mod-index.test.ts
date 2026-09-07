import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchThunderstoreModIndex } from '../../features/mods/thunderstore-mod-index.service.js'

function pkg(overrides: Record<string, unknown>) {
	return {
		name: 'NormalMod',
		full_name: 'Alice-NormalMod',
		owner: 'Alice',
		categories: ['Content'],
		is_deprecated: false,
		versions: [
			{
				name: 'NormalMod',
				full_name: 'Alice-NormalMod-1.2.0',
				description: 'A normal mod.',
				icon: 'https://gcdn.thunderstore.io/live/repository/icons/Alice-NormalMod.png',
				version_number: '1.2.0',
				dependencies: ['Steamodded-Steamodded-0.9.8'],
				download_url:
					'https://thunderstore.io/package/download/Alice/NormalMod/1.2.0/',
				date_created: '2024-01-01T00:00:00Z',
				website_url: 'https://github.com/Alice/NormalMod',
				is_active: true,
			},
		],
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
	it('maps a normal active package into a ModIndexEntryInput', async () => {
		stubResponse([pkg({})])

		const { entries, skipped } = await fetchThunderstoreModIndex()

		expect(skipped).toBe(0)
		expect(entries).toHaveLength(1)
		expect(entries[0]).toEqual({
			id: 'thunderstore:Alice-NormalMod',
			title: 'NormalMod',
			author: 'Alice',
			categories: ['Content'],
			requiresSteamodded: true,
			requiresTalisman: false,
			repoUrl: 'https://github.com/Alice/NormalMod',
			thumbnailUrl:
				'https://gcdn.thunderstore.io/live/repository/icons/Alice-NormalMod.png',
			description: 'A normal mod.',
			latestVersion: '1.2.0',
			latestDownloadUrl:
				'https://thunderstore.io/package/download/Alice/NormalMod/1.2.0/',
			versions: [
				{
					version: '1.2.0',
					downloadUrl:
						'https://thunderstore.io/package/download/Alice/NormalMod/1.2.0/',
					releasedAt: '2024-01-01T00:00:00Z',
				},
			],
		})
	})

	it('excludes a deprecated package and counts it as skipped', async () => {
		stubResponse([pkg({ is_deprecated: true })])

		const { entries, skipped } = await fetchThunderstoreModIndex()

		expect(entries).toHaveLength(0)
		expect(skipped).toBe(1)
	})

	it('excludes a package whose only version is inactive, counted as skipped', async () => {
		stubResponse([
			pkg({
				versions: [
					{
						...pkg({}).versions[0],
						is_active: false,
					},
				],
			}),
		])

		const { entries, skipped } = await fetchThunderstoreModIndex()

		expect(entries).toHaveLength(0)
		expect(skipped).toBe(1)
	})

	it('uses the first active version for latest fields and drops inactive versions', async () => {
		stubResponse([
			pkg({
				versions: [
					{
						name: 'NormalMod',
						full_name: 'Alice-NormalMod-2.0.0',
						description: 'Newer.',
						icon: 'https://gcdn.thunderstore.io/live/repository/icons/Alice-NormalMod.png',
						version_number: '2.0.0',
						dependencies: [],
						download_url:
							'https://thunderstore.io/package/download/Alice/NormalMod/2.0.0/',
						date_created: '2024-06-01T00:00:00Z',
						website_url: 'https://github.com/Alice/NormalMod',
						is_active: true,
					},
					{
						name: 'NormalMod',
						full_name: 'Alice-NormalMod-1.5.0',
						description: 'Withdrawn.',
						icon: 'https://gcdn.thunderstore.io/live/repository/icons/Alice-NormalMod.png',
						version_number: '1.5.0',
						dependencies: [],
						download_url:
							'https://thunderstore.io/package/download/Alice/NormalMod/1.5.0/',
						date_created: '2024-03-01T00:00:00Z',
						website_url: 'https://github.com/Alice/NormalMod',
						is_active: false,
					},
					{
						name: 'NormalMod',
						full_name: 'Alice-NormalMod-1.0.0',
						description: 'Original.',
						icon: 'https://gcdn.thunderstore.io/live/repository/icons/Alice-NormalMod.png',
						version_number: '1.0.0',
						dependencies: [],
						download_url:
							'https://thunderstore.io/package/download/Alice/NormalMod/1.0.0/',
						date_created: '2024-01-01T00:00:00Z',
						website_url: 'https://github.com/Alice/NormalMod',
						is_active: true,
					},
				],
			}),
		])

		const { entries } = await fetchThunderstoreModIndex()

		expect(entries).toHaveLength(1)
		expect(entries[0].latestVersion).toBe('2.0.0')
		expect(entries[0].versions.map((v) => v.version)).toEqual([
			'2.0.0',
			'1.0.0',
		])
	})

	it('sets requiresSteamodded/requiresTalisman false when no dependency matches', async () => {
		stubResponse([
			pkg({
				versions: [{ ...pkg({}).versions[0], dependencies: ['Other-Dep-1.0.0'] }],
			}),
		])

		const { entries } = await fetchThunderstoreModIndex()

		expect(entries[0].requiresSteamodded).toBe(false)
		expect(entries[0].requiresTalisman).toBe(false)
	})
})
