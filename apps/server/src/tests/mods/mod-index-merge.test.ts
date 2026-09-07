import { describe, expect, it } from 'vitest'
import { computeMergedIndex } from '../../features/mods/mod-index-merge.js'
import type { ModIndexEntryInput } from '../../infrastructure/gateways/mods.gateway.js'

function githubEntry(overrides: Partial<ModIndexEntryInput> = {}): ModIndexEntryInput {
	return {
		id: 'Alice@NormalMod',
		title: 'Normal Mod',
		author: 'Alice',
		categories: ['Content'],
		requiresSteamodded: true,
		requiresTalisman: false,
		repoUrl: 'https://github.com/Alice/NormalMod',
		thumbnailUrl: null,
		description: 'From GitHub.',
		latestVersion: '1.0.0',
		latestDownloadUrl: 'https://github.com/Alice/NormalMod/releases/latest/download/mod.zip',
		versions: [],
		...overrides,
	}
}

function thunderstoreEntry(
	overrides: Partial<ModIndexEntryInput> = {},
): ModIndexEntryInput {
	return {
		id: 'thunderstore:Alice-NormalMod',
		title: 'NormalMod',
		author: 'Alice',
		categories: ['Content'],
		requiresSteamodded: true,
		requiresTalisman: false,
		repoUrl: 'https://github.com/Alice/NormalMod',
		thumbnailUrl: 'https://gcdn.thunderstore.io/icon.png',
		description: 'From Thunderstore.',
		latestVersion: '1.1.0',
		latestDownloadUrl: 'https://thunderstore.io/package/download/Alice/NormalMod/1.1.0/',
		versions: [],
		...overrides,
	}
}

describe('computeMergedIndex', () => {
	it('folds a matched Thunderstore entry into the GitHub id, Thunderstore fields winning', () => {
		const github = [githubEntry()]
		const ts = [thunderstoreEntry()]

		const merged = computeMergedIndex(github, { ok: true, entries: ts }, [])

		expect(merged.matched).toBe(1)
		expect(merged.toUpsert).toHaveLength(1)
		expect(merged.toUpsert[0].source).toBe('thunderstore')
		expect(merged.toUpsert[0].entry.id).toBe('Alice@NormalMod')
		expect(merged.toUpsert[0].entry.title).toBe('NormalMod')
		expect(merged.toUpsert[0].entry.description).toBe('From Thunderstore.')
		expect(merged.pruneKeepIds).toEqual(['Alice@NormalMod'])
		expect(merged.pruneKeepIds).not.toContain('thunderstore:Alice-NormalMod')
	})

	it('matches across http/https, www., and trailing-slash repoUrl variants', () => {
		const github = [githubEntry({ repoUrl: 'https://github.com/Alice/NormalMod' })]
		const ts = [
			thunderstoreEntry({ repoUrl: 'http://www.github.com/Alice/NormalMod/' }),
		]

		const merged = computeMergedIndex(github, { ok: true, entries: ts }, [])

		expect(merged.matched).toBe(1)
		expect(merged.toUpsert[0].entry.id).toBe('Alice@NormalMod')
	})

	it('ORs requiresSteamodded/requiresTalisman across both sources on a match', () => {
		const github = [
			githubEntry({ requiresSteamodded: false, requiresTalisman: true }),
		]
		const ts = [
			thunderstoreEntry({ requiresSteamodded: true, requiresTalisman: false }),
		]

		const merged = computeMergedIndex(github, { ok: true, entries: ts }, [])

		expect(merged.toUpsert[0].entry.requiresSteamodded).toBe(true)
		expect(merged.toUpsert[0].entry.requiresTalisman).toBe(true)
	})

	it('adds an unmatched Thunderstore entry as its own row, kept for pruning', () => {
		const github = [githubEntry()]
		const ts = [
			thunderstoreEntry({
				id: 'thunderstore:Bob-OtherMod',
				repoUrl: 'https://github.com/Bob/OtherMod',
			}),
		]

		const merged = computeMergedIndex(github, { ok: true, entries: ts }, [])

		expect(merged.matched).toBe(0)
		expect(merged.toUpsert).toHaveLength(2)
		const tsUpsert = merged.toUpsert.find((u) => u.source === 'thunderstore')
		expect(tsUpsert?.entry.id).toBe('thunderstore:Bob-OtherMod')
		expect(merged.pruneKeepIds).toContain('thunderstore:Bob-OtherMod')
		expect(merged.pruneKeepIds).toContain('Alice@NormalMod')
	})

	it('passes through an unmatched GitHub entry unchanged', () => {
		const github = [githubEntry()]

		const merged = computeMergedIndex(github, { ok: true, entries: [] }, [])

		expect(merged.toUpsert).toEqual([{ entry: github[0], source: 'github' }])
		expect(merged.pruneKeepIds).toEqual(['Alice@NormalMod'])
	})

	it('falls back to previousThunderstoreIds and ignores entries when the fetch failed', () => {
		const github = [githubEntry()]
		// Even though this run "found" a Thunderstore entry, ok:false means the
		// fetch itself threw -- its entries must be entirely ignored.
		const ts = [
			thunderstoreEntry({
				id: 'thunderstore:Should-Be-Ignored',
				repoUrl: 'https://github.com/Should/BeIgnored',
			}),
		]

		const merged = computeMergedIndex(
			github,
			{ ok: false, entries: ts },
			['thunderstore:Previously-Synced'],
		)

		expect(merged.matched).toBe(0)
		expect(merged.toUpsert).toEqual([{ entry: github[0], source: 'github' }])
		expect(merged.pruneKeepIds).toEqual([
			'Alice@NormalMod',
			'thunderstore:Previously-Synced',
		])
		expect(merged.pruneKeepIds).not.toContain('thunderstore:Should-Be-Ignored')
	})
})
