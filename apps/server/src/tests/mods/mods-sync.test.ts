import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../env.js', () => ({ env: { MOD_INDEX_SYNC_ENABLED: true } }))
vi.mock('../../infrastructure/gateways/mods.gateway.js', () => ({
	clearRankedPin: vi.fn(),
	listModRowsForClaims: vi.fn(),
	listRankedPins: vi.fn(),
	pruneModsNotIn: vi.fn(),
	storeRankedPinHash: vi.fn(),
	writeModFromIndex: vi.fn(),
}))
vi.mock('../../features/mods/thunderstore-mod-index.service.js', () => ({
	fetchThunderstoreModIndex: vi.fn(),
}))
vi.mock('../../features/mods/mod-version-hash.js', () => ({
	computeModFolderHashForRelease: vi.fn(),
}))

import { computeModFolderHashForRelease } from '../../features/mods/mod-version-hash.js'
import { syncModRegistry } from '../../features/mods/mods-sync.service.js'
import { fetchThunderstoreModIndex } from '../../features/mods/thunderstore-mod-index.service.js'
import * as gateway from '../../infrastructure/gateways/mods.gateway.js'

function entry(
	fullName: string,
	versions: string[],
	repoUrl: string | null = null,
) {
	return {
		fullName,
		title: fullName.split('-')[1],
		author: fullName.split('-')[0],
		categories: [],
		requiresSteamodded: true,
		requiresTalisman: false,
		repoUrl,
		thumbnailUrl: null,
		description: null,
		packageUrl: null,
		donationLink: null,
		latestVersion: versions[0],
		latestDownloadUrl: `https://ts/${fullName}/${versions[0]}/`,
		sourceUpdatedAt: null,
		versions: versions.map((version) => ({
			version,
			downloadUrl: `https://ts/${fullName}/${version}/`,
			releasedAt: null,
			dependencies: [],
		})),
	}
}

beforeEach(() => {
	vi.mocked(gateway.listModRowsForClaims).mockResolvedValue([])
	vi.mocked(gateway.listRankedPins).mockResolvedValue([])
	vi.mocked(gateway.pruneModsNotIn).mockResolvedValue(0)
})

describe('syncModRegistry', () => {
	it('writes claimed and new packages into the rows the planner picks', async () => {
		vi.mocked(fetchThunderstoreModIndex).mockResolvedValue({
			entries: [
				entry('Steamodded-Steamodded', ['1.1814.0']),
				entry('Carol-New', ['1.0.0']),
			],
			skipped: 0,
		})
		vi.mocked(gateway.listModRowsForClaims).mockResolvedValue([
			{
				id: 'smods',
				thunderstoreFullName: null,
				repoUrl: 'https://github.com/Steamodded/smods',
			},
		])

		const summary = await syncModRegistry()

		expect(gateway.writeModFromIndex).toHaveBeenCalledWith(
			{ kind: 'claimed', id: 'smods' },
			expect.objectContaining({ fullName: 'Steamodded-Steamodded' }),
		)
		expect(gateway.writeModFromIndex).toHaveBeenCalledWith(
			{ kind: 'new', id: 'Carol-New' },
			expect.objectContaining({ fullName: 'Carol-New' }),
		)
		expect(gateway.pruneModsNotIn).toHaveBeenCalledWith([
			'Steamodded-Steamodded',
			'Carol-New',
		])
		expect(summary).toMatchObject({ modsSynced: 2, claimed: 1 })
	})

	it('writes and prunes nothing when the fetch fails', async () => {
		vi.mocked(fetchThunderstoreModIndex).mockRejectedValue(new Error('503'))

		await expect(syncModRegistry()).rejects.toThrow('503')

		expect(gateway.writeModFromIndex).not.toHaveBeenCalled()
		expect(gateway.pruneModsNotIn).not.toHaveBeenCalled()
	})

	it('clears a ranked pin whose version is not on Thunderstore', async () => {
		vi.mocked(fetchThunderstoreModIndex).mockResolvedValue({
			entries: [entry('Steamodded-Steamodded', ['1.1814.0'])],
			skipped: 0,
		})
		vi.mocked(gateway.listRankedPins).mockResolvedValue([
			{
				id: 'smods',
				thunderstoreFullName: 'Steamodded-Steamodded',
				rankedVersion: '1.0.0-beta-1620a',
				rankedVersionSha256: 'old',
			},
		])

		const summary = await syncModRegistry()

		expect(gateway.clearRankedPin).toHaveBeenCalledWith(
			'smods',
			'1.0.0-beta-1620a',
		)
		expect(computeModFolderHashForRelease).not.toHaveBeenCalled()
		expect(summary.pinsCleared).toBe(1)
	})

	it('hashes a ranked pin that has no hash yet, and leaves hashed pins alone', async () => {
		vi.mocked(fetchThunderstoreModIndex).mockResolvedValue({
			entries: [
				entry('Steamodded-Steamodded', ['1.1814.0', '1.1620.0']),
				entry('Alice-Mod', ['2.0.0']),
			],
			skipped: 0,
		})
		vi.mocked(gateway.listRankedPins).mockResolvedValue([
			{
				id: 'smods',
				thunderstoreFullName: 'Steamodded-Steamodded',
				rankedVersion: '1.1620.0',
				rankedVersionSha256: null,
			},
			{
				id: 'Alice-Mod',
				thunderstoreFullName: 'Alice-Mod',
				rankedVersion: '2.0.0',
				rankedVersionSha256: 'b'.repeat(64),
			},
		])
		vi.mocked(computeModFolderHashForRelease).mockResolvedValue('c'.repeat(64))

		const summary = await syncModRegistry()

		expect(computeModFolderHashForRelease).toHaveBeenCalledTimes(1)
		expect(computeModFolderHashForRelease).toHaveBeenCalledWith(
			'smods',
			'1.1620.0',
			'https://ts/Steamodded-Steamodded/1.1620.0/',
		)
		expect(gateway.storeRankedPinHash).toHaveBeenCalledWith(
			'smods',
			'1.1620.0',
			'c'.repeat(64),
		)
		expect(gateway.clearRankedPin).not.toHaveBeenCalled()
		expect(summary.pinsHashed).toBe(1)
	})

	it('keeps an unhashed pin for the next sync when hashing fails', async () => {
		vi.mocked(fetchThunderstoreModIndex).mockResolvedValue({
			entries: [entry('Alice-Mod', ['2.0.0'])],
			skipped: 0,
		})
		vi.mocked(gateway.listRankedPins).mockResolvedValue([
			{
				id: 'Alice-Mod',
				thunderstoreFullName: 'Alice-Mod',
				rankedVersion: '2.0.0',
				rankedVersionSha256: null,
			},
		])
		vi.mocked(computeModFolderHashForRelease).mockResolvedValue(null)

		const summary = await syncModRegistry()

		expect(gateway.storeRankedPinHash).not.toHaveBeenCalled()
		expect(gateway.clearRankedPin).not.toHaveBeenCalled()
		expect(summary.pinsHashed).toBe(0)
	})
})
