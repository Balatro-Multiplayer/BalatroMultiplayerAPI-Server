import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	fetchThunderstoreModIndex,
	fetchThunderstorePackageVersions,
} from '../../features/mods/thunderstore-mod-index.service.js'

function pkg(overrides: Record<string, unknown>) {
	return {
		name: 'NormalMod',
		full_name: 'Alice-NormalMod',
		owner: 'Alice',
		is_deprecated: false,
		versions: [
			{
				version_number: '1.2.0',
				download_url:
					'https://thunderstore.io/package/download/Alice/NormalMod/1.2.0/',
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
	it('maps a normal active package into id/title/author', async () => {
		stubResponse([pkg({})])

		const { entries, skipped } = await fetchThunderstoreModIndex()

		expect(skipped).toBe(0)
		expect(entries).toEqual([
			{ id: 'Alice-NormalMod', title: 'NormalMod', author: 'Alice' },
		])
	})

	it('excludes a deprecated package and counts it as skipped', async () => {
		stubResponse([pkg({ is_deprecated: true })])

		const { entries, skipped } = await fetchThunderstoreModIndex()

		expect(entries).toHaveLength(0)
		expect(skipped).toBe(1)
	})

	it('excludes a package whose only version is inactive, counted as skipped', async () => {
		stubResponse([
			pkg({ versions: [{ ...pkg({}).versions[0], is_active: false }] }),
		])

		const { entries, skipped } = await fetchThunderstoreModIndex()

		expect(entries).toHaveLength(0)
		expect(skipped).toBe(1)
	})
})

describe('fetchThunderstorePackageVersions', () => {
	it('returns only active versions for the matching package', async () => {
		stubResponse([
			pkg({
				versions: [
					{
						version_number: '2.0.0',
						download_url:
							'https://thunderstore.io/package/download/Alice/NormalMod/2.0.0/',
						is_active: true,
					},
					{
						version_number: '1.5.0',
						download_url:
							'https://thunderstore.io/package/download/Alice/NormalMod/1.5.0/',
						is_active: false,
					},
				],
			}),
		])

		const versions = await fetchThunderstorePackageVersions('Alice-NormalMod')

		expect(versions).toEqual([
			{
				version: '2.0.0',
				downloadUrl:
					'https://thunderstore.io/package/download/Alice/NormalMod/2.0.0/',
			},
		])
	})

	it('returns an empty array when no package matches', async () => {
		stubResponse([pkg({})])

		const versions = await fetchThunderstorePackageVersions('Bob-Nonexistent')

		expect(versions).toEqual([])
	})
})
