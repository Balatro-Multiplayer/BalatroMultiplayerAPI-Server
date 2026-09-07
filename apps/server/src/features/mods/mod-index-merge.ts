import type { ModIndexSource } from '../../infrastructure/db/schema.js'
import type { ModIndexEntryInput } from '../../infrastructure/gateways/mods.gateway.js'

// This run's Thunderstore fetch result, as mods-sync.service.ts's runSync()
// observed it -- ok:false means the fetch itself threw (a real outage), not
// "Thunderstore has zero mods right now" (which is ok:true, entries:[], and
// is treated as a real, intentional result -- see computeMergedIndex's
// pruneKeepIds doc comment below).
export interface ThunderstoreOutcome {
	ok: boolean
	entries: ModIndexEntryInput[]
}

export interface MergedModIndex {
	toUpsert: Array<{ entry: ModIndexEntryInput; source: ModIndexSource }>
	pruneKeepIds: string[]
	// Thunderstore packages folded into an existing GitHub-sourced entry
	// (repoUrl match) rather than becoming their own row.
	matched: number
}

// Strips protocol/www./trailing slash/.git so "https://github.com/Foo/Bar",
// "http://www.github.com/Foo/Bar/" and "https://github.com/Foo/Bar.git" all
// match the same repo -- no fuzzy name/author matching, since that risks
// false-positive merges across two genuinely different mods that happen to
// share a common title.
function normalizeRepoUrl(url: string | null): string | null {
	if (!url) return null
	const normalized = url
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, '')
		.replace(/^www\./, '')
		.replace(/\.git$/, '')
		.replace(/\/+$/, '')
	return normalized || null
}

// Pure merge of the two sources -- no I/O, so this is unit-testable on its
// own (see mod-index-merge.test.ts) without mocking fetch or a database.
//
// Merge rule (confirmed with the user): when a Thunderstore package's
// repoUrl matches an existing GitHub-sourced entry, Thunderstore's fields win
// wholesale for that mod -- except requiresSteamodded/requiresTalisman,
// which are OR'd across both sources rather than overwritten. Reason:
// Thunderstore can prove requiresTalisman true (a dependency string
// referencing it) but never prove it false, since Talisman has no package on
// Thunderstore's Balatro community to depend on at all (confirmed live) --
// letting Thunderstore's always-false value overwrite a real
// requires-talisman:true from GitHub's meta.json would be a silent
// regression. The merged row keeps the *GitHub* entry's id, not a
// Thunderstore-derived one, so ranked pins/hash history/anything else keyed
// by that id aren't orphaned.
export function computeMergedIndex(
	githubEntries: ModIndexEntryInput[],
	thunderstore: ThunderstoreOutcome,
	previousThunderstoreIds: string[],
): MergedModIndex {
	const githubByRepoUrl = new Map<string, ModIndexEntryInput>()
	for (const entry of githubEntries) {
		const normalized = normalizeRepoUrl(entry.repoUrl)
		if (normalized) githubByRepoUrl.set(normalized, entry)
	}

	const matchedGithubIds = new Set<string>()
	const toUpsert: MergedModIndex['toUpsert'] = []
	const thunderstoreIds: string[] = []
	let matched = 0

	// A failed fetch (ok: false) always carries entries: [] anyway (see
	// mods-sync.service.ts's catch block), but guard explicitly rather than
	// relying on that -- entries from a run whose fetch itself threw must
	// never be upserted, only previousThunderstoreIds (below) should
	// influence anything in that case.
	const thunderstoreEntries = thunderstore.ok ? thunderstore.entries : []

	for (const tsEntry of thunderstoreEntries) {
		const normalized = normalizeRepoUrl(tsEntry.repoUrl)
		const githubMatch = normalized ? githubByRepoUrl.get(normalized) : undefined
		if (githubMatch) {
			matched++
			matchedGithubIds.add(githubMatch.id)
			toUpsert.push({
				entry: {
					...tsEntry,
					id: githubMatch.id,
					requiresSteamodded:
						tsEntry.requiresSteamodded || githubMatch.requiresSteamodded,
					requiresTalisman:
						tsEntry.requiresTalisman || githubMatch.requiresTalisman,
				},
				source: 'thunderstore',
			})
		} else {
			toUpsert.push({ entry: tsEntry, source: 'thunderstore' })
			thunderstoreIds.push(tsEntry.id)
		}
	}

	for (const entry of githubEntries) {
		if (matchedGithubIds.has(entry.id)) continue
		toUpsert.push({ entry, source: 'github' })
	}

	const pruneKeepIds = [
		...githubEntries.map((e) => e.id),
		...(thunderstore.ok ? thunderstoreIds : previousThunderstoreIds),
	]

	return { toUpsert, pruneKeepIds, matched }
}
