import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../env.js', () => ({ env: { MOD_INDEX_SYNC_ENABLED: true } }))
vi.mock('../../infrastructure/gateways/mods.gateway.js', () => ({
	applyDetectedVersion: vi.fn(),
	listCustomModsForVersionCheck: vi.fn(),
	listGithubTrackedMods: vi.fn(),
	listModRowsForClaims: vi.fn(),
	listRankedPins: vi.fn(),
	mergeGithubVersions: vi.fn(),
	pruneModsNotIn: vi.fn(),
	resolvePinTarget: vi.fn(),
	setRankedPinStatus: vi.fn(),
	storeRankedPin: vi.fn(),
	writeModFromIndex: vi.fn(),
}))
vi.mock('../../features/mods/thunderstore-mod-index.service.js', () => ({
	fetchThunderstoreModIndex: vi.fn(),
}))
vi.mock('../../features/mods/custom-mod-version-check.service.js', () => ({
	checkCustomModVersion: vi.fn(),
}))
vi.mock('../../features/mods/github-mod-versions.service.js', () => ({
	listGithubVersions: vi.fn(),
}))
vi.mock('../../features/mods/mod-version-hash.js', () => ({
	computeModFolderHashForRelease: vi.fn(),
}))
vi.mock('../../features/mods/ranked-pin-health.js', () => ({
	checkDownloadAvailable: vi.fn(),
}))

import { checkCustomModVersion } from '../../features/mods/custom-mod-version-check.service.js'
import { listGithubVersions } from '../../features/mods/github-mod-versions.service.js'
import { computeModFolderHashForRelease } from '../../features/mods/mod-version-hash.js'
import { syncModRegistry } from '../../features/mods/mods-sync.service.js'
import { checkDownloadAvailable } from '../../features/mods/ranked-pin-health.js'
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

type Pin = Awaited<ReturnType<typeof gateway.listRankedPins>>[number]

function pin(overrides: Partial<Pin> = {}): Pin {
	return {
		id: 'Alice-Mod',
		thunderstoreFullName: 'Alice-Mod',
		repoUrl: null,
		rankedVersion: '2.0.0',
		rankedVersionSha256: 'b'.repeat(64),
		rankedDownloadUrl: 'https://ts/Alice-Mod/2.0.0/',
		rankedSource: 'thunderstore',
		rankedDownloadStatus: 'ok',
		...overrides,
	}
}

beforeEach(() => {
	vi.mocked(gateway.listModRowsForClaims).mockResolvedValue([])
	vi.mocked(gateway.listRankedPins).mockResolvedValue([])
	vi.mocked(gateway.pruneModsNotIn).mockResolvedValue(0)
	vi.mocked(gateway.listCustomModsForVersionCheck).mockResolvedValue([])
	vi.mocked(gateway.listGithubTrackedMods).mockResolvedValue([])
	vi.mocked(gateway.applyDetectedVersion).mockResolvedValue(true)
	vi.mocked(fetchThunderstoreModIndex).mockResolvedValue({
		entries: [entry('Alice-Mod', ['2.0.0'])],
		skipped: 0,
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

	describe('ranked pins are never cleared or changed by the sync', () => {
		it('treats a still-listed Thunderstore pin as ok without a request', async () => {
			vi.mocked(gateway.listRankedPins).mockResolvedValue([pin()])

			await syncModRegistry()

			expect(checkDownloadAvailable).not.toHaveBeenCalled()
			expect(gateway.setRankedPinStatus).not.toHaveBeenCalled()
			expect(gateway.storeRankedPin).not.toHaveBeenCalled()
		})

		it('flags a pin whose version left Thunderstore and whose download is gone', async () => {
			vi.mocked(gateway.listRankedPins).mockResolvedValue([
				pin({
					rankedVersion: '1.0.0',
					rankedDownloadUrl: 'https://ts/Alice-Mod/1.0.0/',
				}),
			])
			vi.mocked(checkDownloadAvailable).mockResolvedValue('unavailable')

			const summary = await syncModRegistry()

			expect(checkDownloadAvailable).toHaveBeenCalledWith(
				'https://ts/Alice-Mod/1.0.0/',
			)
			expect(gateway.setRankedPinStatus).toHaveBeenCalledWith(
				'Alice-Mod',
				'1.0.0',
				'unavailable',
			)
			expect(gateway.storeRankedPin).not.toHaveBeenCalled()
			expect(summary.pinsUnavailable).toBe(1)
		})

		it('keeps an unlisted pin ok while its permanent URL still downloads', async () => {
			vi.mocked(gateway.listRankedPins).mockResolvedValue([
				pin({
					rankedVersion: '1.0.0',
					rankedDownloadUrl: 'https://ts/Alice-Mod/1.0.0/',
				}),
			])
			vi.mocked(checkDownloadAvailable).mockResolvedValue('ok')

			const summary = await syncModRegistry()

			expect(gateway.setRankedPinStatus).not.toHaveBeenCalled()
			expect(summary.pinsUnavailable).toBe(0)
		})

		it('restores ok on a previously unavailable GitHub pin that downloads again', async () => {
			vi.mocked(gateway.listRankedPins).mockResolvedValue([
				pin({
					id: 'Partner',
					thunderstoreFullName: null,
					rankedVersion: 'abc1234',
					rankedDownloadUrl: 'https://codeload.github.com/o/r/zip/abc1234def',
					rankedSource: 'github',
					rankedDownloadStatus: 'unavailable',
				}),
			])
			vi.mocked(checkDownloadAvailable).mockResolvedValue('ok')

			await syncModRegistry()

			expect(gateway.setRankedPinStatus).toHaveBeenCalledWith(
				'Partner',
				'abc1234',
				'ok',
			)
		})

		it('leaves the status alone when availability is unknown (transient failure)', async () => {
			vi.mocked(gateway.listRankedPins).mockResolvedValue([
				pin({ rankedVersion: '1.0.0', rankedSource: 'github' }),
			])
			vi.mocked(checkDownloadAvailable).mockResolvedValue(null)

			await syncModRegistry()

			expect(gateway.setRankedPinStatus).not.toHaveBeenCalled()
		})

		it('resolves and hashes a carried-over pin that has no permanent URL yet', async () => {
			vi.mocked(gateway.listRankedPins).mockResolvedValue([
				pin({ rankedDownloadUrl: null, rankedSource: null }),
			])
			vi.mocked(gateway.resolvePinTarget).mockResolvedValue({
				version: '2.0.0',
				source: 'thunderstore',
				downloadUrl: 'https://ts/Alice-Mod/2.0.0/',
			})
			vi.mocked(computeModFolderHashForRelease).mockResolvedValue(
				'c'.repeat(64),
			)

			const summary = await syncModRegistry()

			expect(computeModFolderHashForRelease).toHaveBeenCalledWith(
				'Alice-Mod',
				'2.0.0',
				'https://ts/Alice-Mod/2.0.0/',
				'thunderstore',
			)
			expect(gateway.storeRankedPin).toHaveBeenCalledWith(
				'Alice-Mod',
				{
					version: '2.0.0',
					downloadUrl: 'https://ts/Alice-Mod/2.0.0/',
					source: 'thunderstore',
					hash: 'c'.repeat(64),
				},
				'2.0.0',
			)
			expect(summary.pinsHashed).toBe(1)
		})

		it('flags (not clears) a carried-over pin whose hash fails, for the next sync to retry', async () => {
			vi.mocked(gateway.listRankedPins).mockResolvedValue([
				pin({ rankedDownloadUrl: null, rankedVersionSha256: null }),
			])
			vi.mocked(gateway.resolvePinTarget).mockResolvedValue({
				version: '2.0.0',
				source: 'thunderstore',
				downloadUrl: 'https://ts/Alice-Mod/2.0.0/',
			})
			vi.mocked(computeModFolderHashForRelease).mockResolvedValue(null)

			const summary = await syncModRegistry()

			expect(gateway.storeRankedPin).not.toHaveBeenCalled()
			expect(gateway.setRankedPinStatus).toHaveBeenCalledWith(
				'Alice-Mod',
				'2.0.0',
				'unavailable',
			)
			expect(summary).toMatchObject({ pinsHashed: 0, pinsUnavailable: 1 })
		})

		it('flags a carried-over pin whose version row no longer exists', async () => {
			vi.mocked(gateway.listRankedPins).mockResolvedValue([
				pin({ rankedVersion: '1.0.0-beta-1620a', rankedDownloadUrl: null }),
			])
			vi.mocked(gateway.resolvePinTarget).mockResolvedValue(null)

			await syncModRegistry()

			expect(computeModFolderHashForRelease).not.toHaveBeenCalled()
			expect(gateway.setRankedPinStatus).toHaveBeenCalledWith(
				'Alice-Mod',
				'1.0.0-beta-1620a',
				'unavailable',
			)
		})
	})

	describe('GitHub versions', () => {
		it('merges releases/tags for every GitHub-tracked mod', async () => {
			vi.mocked(gateway.listGithubTrackedMods).mockResolvedValue([
				{
					id: 'Partner',
					thunderstoreFullName: null,
					repoUrl: 'https://github.com/o/r',
					latestDownloadUrl:
						'https://github.com/o/r/archive/refs/heads/main.zip',
				},
			])
			const versions = [
				{
					name: 'v1.0.0',
					ref: 'v1.0.0',
					downloadUrl: 'https://codeload.github.com/o/r/zip/refs/tags/v1.0.0',
					releasedAt: null,
				},
			]
			vi.mocked(listGithubVersions).mockResolvedValue(versions)

			const summary = await syncModRegistry()

			expect(gateway.mergeGithubVersions).toHaveBeenCalledWith(
				'Partner',
				null,
				versions,
			)
			expect(summary.githubTrackedMods).toBe(1)
		})

		it('skips a mod GitHub could not answer for, and keeps going after a failure', async () => {
			vi.mocked(gateway.listGithubTrackedMods).mockResolvedValue([
				{
					id: 'A',
					thunderstoreFullName: null,
					repoUrl: null,
					latestDownloadUrl: null,
				},
				{
					id: 'B',
					thunderstoreFullName: null,
					repoUrl: null,
					latestDownloadUrl: null,
				},
				{
					id: 'C',
					thunderstoreFullName: null,
					repoUrl: null,
					latestDownloadUrl: null,
				},
			])
			vi.mocked(listGithubVersions)
				.mockResolvedValueOnce(null)
				.mockRejectedValueOnce(new Error('boom'))
				.mockResolvedValueOnce([])

			const summary = await syncModRegistry()

			expect(gateway.mergeGithubVersions).toHaveBeenCalledTimes(1)
			expect(gateway.mergeGithubVersions).toHaveBeenCalledWith('C', null, [])
			expect(summary.githubTrackedMods).toBe(1)
		})
	})

	describe('custom mods', () => {
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

		it('records a detected custom version with its permanent version URL', async () => {
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
				versionDownloadUrl: 'https://codeload.github.com/o/r/zip/bbb2222ffff',
				source: 'head',
			})

			const summary = await syncModRegistry()

			expect(gateway.applyDetectedVersion).toHaveBeenCalledWith('Partner', {
				version: 'bbb2222',
				downloadUrl: null,
				versionDownloadUrl: 'https://codeload.github.com/o/r/zip/bbb2222ffff',
			})
			expect(summary.customVersionsDetected).toBe(1)
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
	})
})
