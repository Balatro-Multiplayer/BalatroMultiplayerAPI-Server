import AdmZip from 'adm-zip'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchUpstreamModIndex } from '../../features/mods/upstream-mod-index.service.js'

const RAW_BASE =
	'https://raw.githubusercontent.com/skyline69/balatro-mod-index/main'

// Mirrors GitHub codeload's zip shape: a single "<repo>-<branch>/" wrapper
// folder, with mods/<slug>/<file> underneath -- exactly what
// fetchUpstreamModIndex() expects to unzip and walk.
function buildFixtureZip(): Buffer {
	const zip = new AdmZip()
	const put = (relPath: string, contents: string) =>
		zip.addFile(
			`balatro-mod-index-main/${relPath}`,
			Buffer.from(contents, 'utf-8'),
		)

	// Happy path: meta.json + description.md + thumbnail.jpg, no explicit id.
	put(
		'mods/Alice@NormalMod/meta.json',
		JSON.stringify({
			title: 'Normal Mod',
			author: 'Alice',
			'requires-steamodded': true,
			'requires-talisman': false,
			categories: ['Content'],
			repo: 'https://github.com/Alice/NormalMod',
			downloadURL:
				'https://github.com/Alice/NormalMod/releases/latest/download/mod.zip',
			version: '1.2.3',
			'last-updated': 1700000000,
		}),
	)
	put('mods/Alice@NormalMod/description.md', '  A normal mod.  \n')
	put('mods/Alice@NormalMod/thumbnail.jpg', 'not-really-a-jpeg')

	// Minimal: meta.json only, requires-steamodded/talisman omitted entirely
	// -- exercises the true/false defaults.
	put(
		'mods/Bob@MinimalMod/meta.json',
		JSON.stringify({
			title: 'Minimal Mod',
			author: 'Bob',
			repo: 'https://github.com/Bob/MinimalMod',
			downloadURL:
				'https://github.com/Bob/MinimalMod/releases/latest/download/mod.zip',
			version: '0.1.0',
		}),
	)

	// Explicit meta.id overriding the folder-derived fallback.
	put(
		'mods/Carol@ExplicitId/meta.json',
		JSON.stringify({
			id: 'carol-explicit-id',
			title: 'Explicit Id Mod',
			author: 'Carol',
			repo: 'https://github.com/Carol/ExplicitId',
			downloadURL:
				'https://github.com/Carol/ExplicitId/releases/latest/download/mod.zip',
			version: '2.0.0',
		}),
	)

	// Two folders resolving to the same id ("Collide", via the Modname-half
	// fallback) -- Dave sorts before Eve, so Dave should win.
	put(
		'mods/Dave@Collide/meta.json',
		JSON.stringify({
			title: 'Dave Collide',
			author: 'Dave',
			repo: 'https://github.com/Dave/Collide',
			downloadURL:
				'https://github.com/Dave/Collide/releases/latest/download/mod.zip',
			version: '1.0.0',
		}),
	)
	put(
		'mods/Eve@Collide/meta.json',
		JSON.stringify({
			title: 'Eve Collide',
			author: 'Eve',
			repo: 'https://github.com/Eve/Collide',
			downloadURL:
				'https://github.com/Eve/Collide/releases/latest/download/mod.zip',
			version: '1.0.0',
		}),
	)

	// Malformed JSON -- skipped, not thrown.
	put('mods/BadJSON@Broken/meta.json', '{ "title": "Broken", }')

	// No "@" in the folder name at all -- id and author both fall back to the
	// full slug (matches Python's str.partition("@") behavior: pathAuthor
	// becomes the whole string, pathModName becomes "").
	put(
		'mods/NoAtSignFolder/meta.json',
		JSON.stringify({
			title: 'No At Sign',
			repo: 'https://github.com/Someone/NoAtSignFolder',
			downloadURL:
				'https://github.com/Someone/NoAtSignFolder/releases/latest/download/mod.zip',
			version: '3.0.0',
		}),
	)

	return zip.toBuffer()
}

describe('fetchUpstreamModIndex', () => {
	beforeEach(() => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => new Response(buildFixtureZip(), { status: 200 })),
		)
	})

	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('parses the happy-path mod with all three files', async () => {
		const { entries } = await fetchUpstreamModIndex()
		const mod = entries.find((e) => e.id === 'NormalMod')
		expect(mod).toMatchObject({
			id: 'NormalMod',
			title: 'Normal Mod',
			author: 'Alice',
			categories: ['Content'],
			requiresSteamodded: true,
			requiresTalisman: false,
			repoUrl: 'https://github.com/Alice/NormalMod',
			thumbnailUrl: `${RAW_BASE}/mods/Alice@NormalMod/thumbnail.jpg`,
			description: 'A normal mod.',
			latestVersion: '1.2.3',
			latestDownloadUrl:
				'https://github.com/Alice/NormalMod/releases/latest/download/mod.zip',
		})
		expect(mod?.versions).toEqual([
			{
				version: '1.2.3',
				downloadUrl:
					'https://github.com/Alice/NormalMod/releases/latest/download/mod.zip',
				releasedAt: new Date(1700000000 * 1000).toISOString(),
			},
		])
	})

	it('defaults requiresSteamodded/requiresTalisman and nulls out missing description/thumbnail', async () => {
		const { entries } = await fetchUpstreamModIndex()
		const mod = entries.find((e) => e.id === 'MinimalMod')
		expect(mod).toMatchObject({
			requiresSteamodded: true,
			requiresTalisman: false,
			description: null,
			thumbnailUrl: null,
		})
	})

	it('prefers an explicit meta.id over the folder-derived fallback', async () => {
		const { entries } = await fetchUpstreamModIndex()
		expect(entries.some((e) => e.id === 'carol-explicit-id')).toBe(true)
		expect(entries.some((e) => e.id === 'ExplicitId')).toBe(false)
	})

	it('dedupes id collisions, keeping the alphabetically-first folder', async () => {
		const { entries, idCollisions } = await fetchUpstreamModIndex()
		const collideEntries = entries.filter((e) => e.id === 'Collide')
		expect(collideEntries).toHaveLength(1)
		expect(collideEntries[0].author).toBe('Dave')
		expect(idCollisions).toBe(1)
	})

	it('skips a mod with malformed JSON instead of throwing', async () => {
		const { entries, skipped } = await fetchUpstreamModIndex()
		expect(entries.some((e) => e.title === 'Broken')).toBe(false)
		expect(skipped).toBe(1)
	})

	it('falls back to the full slug for id and author when the folder has no "@"', async () => {
		const { entries } = await fetchUpstreamModIndex()
		const mod = entries.find((e) => e.id === 'NoAtSignFolder')
		expect(mod).toMatchObject({
			id: 'NoAtSignFolder',
			author: 'NoAtSignFolder',
		})
	})
})
