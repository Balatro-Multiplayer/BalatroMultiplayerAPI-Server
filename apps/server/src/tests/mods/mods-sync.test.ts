import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../env.js', () => ({ env: { MOD_INDEX_SYNC_ENABLED: true } }))
vi.mock('../../infrastructure/gateways/mods.gateway.js', () => ({
	applyDetectedVersion: vi.fn(),
	clearRankedPin: vi.fn(),
	getCustomPinDownloadUrl: vi.fn(),
	listCustomModsForVersionCheck: vi.fn(),
	listModRowsForClaims: vi.fn(),
	listRankedPins: vi.fn(),
	pruneModsNotIn: vi.fn(),
	storeRankedPinHash: vi.fn(),
	writeModFromIndex: vi.fn(),
}))
vi.mock('../../features/mods/thunderstore-mod-index.service.js', () => ({
	fetchThunderstoreModIndex: vi.fn(),
}))
vi.mock('../../features/mods/custom-mod-version-check.service.js', () => ({
	checkCustomModVersion: vi.fn(),
}))
vi.mock('../../features/mods/mod-version-hash.js', () => ({
	computeModFolderHashForRelease: vi.fn(),
}))

import { checkCustomModVersion } from '../../features/mods/custom-mod-version-check.service.js'
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
	vi.mocked(gateway.listCustomModsForVersionCheck).mockResolvedValue([])
	vi.mocked(gateway.applyDetectedVersion).mockResolvedValue({
		pinCleared: false,
	})
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
				isCustom: false,
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
				isCustom: false,
				thunderstoreFullName: 'Steamodded-Steamodded',
				rankedVersion: '1.1620.0',
				rankedVersionSha256: null,
			},
			{
				id: 'Alice-Mod',
				isCustom: false,
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
				isCustom: false,
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

	describe('custom mods', () => {
		beforeEach(() => {
			vi.mocked(fetchThunderstoreModIndex).mockResolvedValue({
				entries: [entry('Alice-Mod', ['2.0.0'])],
				skipped: 0,
			})
		})

		it('skips a package whose id is an admin-created custom mod', async () => {
			vi.mocked(gateway.listModRowsForClaims).mockResolvedValue([
				{
					id: 'Alice-Mod',
					thunderstoreFullName: null,
					repoUrl: null,
					isCustom: true,
				},
			])

			const summary = await syncModRegistry()

			expect(gateway.writeModFromIndex).not.toHaveBeenCalled()
			expect(summary.skipped).toBe(1)
		})

		it('records a detected custom version and counts a cleared pin', async () => {
			vi.mocked(gateway.listCustomModsForVersionCheck).mockResolvedValue([
				{
					id: 'Partner',
					repoUrl: 'https://github.com/o/r',
					latestVersion: 'aaa1111',
					latestDownloadUrl:
						'https://github.com/o/r/archive/refs/heads/main.zip',
					fixedReleaseTagUpdates: false,
				},
			])
			vi.mocked(checkCustomModVersion).mockResolvedValue({
				newVersion: 'bbb2222',
				newDownloadUrl: null,
				source: 'head',
			})
			vi.mocked(gateway.applyDetectedVersion).mockResolvedValue({
				pinCleared: true,
			})

			const summary = await syncModRegistry()

			expect(gateway.applyDetectedVersion).toHaveBeenCalledWith('Partner', {
				version: 'bbb2222',
				downloadUrl: null,
			})
			expect(summary).toMatchObject({
				customVersionsDetected: 1,
				pinsCleared: 1,
			})
		})

		it('still syncs Thunderstore when one custom mod check throws', async () => {
			vi.mocked(gateway.listCustomModsForVersionCheck).mockResolvedValue([
				{
					id: 'Partner',
					repoUrl: null,
					latestVersion: null,
					latestDownloadUrl: null,
					fixedReleaseTagUpdates: false,
				},
			])
			vi.mocked(checkCustomModVersion).mockRejectedValue(new Error('boom'))

			const summary = await syncModRegistry()

			expect(summary.customVersionsDetected).toBe(0)
			expect(gateway.writeModFromIndex).toHaveBeenCalledTimes(1)
		})

		it('hashes a custom pin from its own version row, never clearing it for not being on Thunderstore', async () => {
			vi.mocked(gateway.listRankedPins).mockResolvedValue([
				{
					id: 'Partner',
					isCustom: true,
					thunderstoreFullName: null,
					rankedVersion: 'v1',
					rankedVersionSha256: null,
				},
			])
			vi.mocked(gateway.getCustomPinDownloadUrl).mockResolvedValue(
				'https://example.com/partner-v1.zip',
			)
			vi.mocked(computeModFolderHashForRelease).mockResolvedValue(
				'd'.repeat(64),
			)

			const summary = await syncModRegistry()

			expect(computeModFolderHashForRelease).toHaveBeenCalledWith(
				'Partner',
				'v1',
				'https://example.com/partner-v1.zip',
			)
			expect(gateway.storeRankedPinHash).toHaveBeenCalledWith(
				'Partner',
				'v1',
				'd'.repeat(64),
			)
			expect(gateway.clearRankedPin).not.toHaveBeenCalled()
			expect(summary.pinsHashed).toBe(1)
		})

		it('clears a custom pin whose version row is gone', async () => {
			vi.mocked(gateway.listRankedPins).mockResolvedValue([
				{
					id: 'Partner',
					isCustom: true,
					thunderstoreFullName: null,
					rankedVersion: 'v1',
					rankedVersionSha256: null,
				},
			])
			vi.mocked(gateway.getCustomPinDownloadUrl).mockResolvedValue(null)

			await syncModRegistry()

			expect(gateway.clearRankedPin).toHaveBeenCalledWith('Partner', 'v1')
		})
	})
})
