import type { ModIndexEntryInput } from '../../infrastructure/gateways/mods.gateway.js'

// Thunderstore's own Balatro community package list -- a single unauthenticated
// GET returns the whole catalog (120 packages as of writing, confirmed live),
// no pagination, no token, same "plain HTTPS GET, no API rate-limit games"
// philosophy this project already applies to the GitHub index (see
// upstream-mod-index.service.ts's header comment).
const PACKAGE_INDEX_URL = 'https://thunderstore.io/c/balatro/api/v1/package/'
const FETCH_TIMEOUT_MS = 60_000

// Confirmed live against a real response: Steamodded's own package
// (owner="Steamodded", name="Steamodded") produces dependency strings shaped
// like "Steamodded-Steamodded-0.9.8" on any mod that depends on it.
const STEAMODDED_DEPENDENCY_PREFIX = 'Steamodded-Steamodded-'

export interface ThunderstoreIndexResult {
	entries: ModIndexEntryInput[]
	// Deprecated packages, or packages with no is_active version at all.
	skipped: number
}

interface ThunderstoreVersion {
	name: string
	full_name: string
	description: string
	icon: string
	version_number: string
	dependencies: string[]
	download_url: string
	date_created: string
	website_url: string
	is_active: boolean
}

interface ThunderstorePackage {
	name: string
	full_name: string
	owner: string
	categories: string[]
	is_deprecated: boolean
	versions: ThunderstoreVersion[]
}

// Fetches thunderstore.io/c/balatro's package list and transforms it into the
// same ModIndexEntryInput shape upstream-mod-index.service.ts produces, so
// mods-sync.service.ts can merge the two (see mod-index-merge.ts) before
// upserting. Every entry's id is a placeholder ("thunderstore:<full_name>")
// -- mod-index-merge.ts is the only place that decides whether that id is
// actually used, or replaced by an existing GitHub-sourced mod's id on a
// repoUrl match.
export async function fetchThunderstoreModIndex(): Promise<ThunderstoreIndexResult> {
	const res = await fetch(PACKAGE_INDEX_URL, {
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	})
	if (!res.ok) {
		throw new Error(`thunderstore package index fetch failed: ${res.status}`)
	}
	const packages = (await res.json()) as ThunderstorePackage[]

	const entries: ModIndexEntryInput[] = []
	let skipped = 0
	for (const pkg of packages) {
		if (pkg.is_deprecated) {
			skipped++
			continue
		}
		const activeVersions = pkg.versions.filter((v) => v.is_active)
		if (activeVersions.length === 0) {
			skipped++
			continue
		}
		entries.push(buildEntry(pkg, activeVersions))
	}

	return { entries, skipped }
}

// activeVersions is assumed newest-first (Thunderstore's own response order,
// confirmed live) -- activeVersions[0] is this package's latest.
function buildEntry(
	pkg: ThunderstorePackage,
	activeVersions: ThunderstoreVersion[],
): ModIndexEntryInput {
	const latest = activeVersions[0]

	return {
		id: `thunderstore:${pkg.full_name}`,
		title: pkg.name,
		author: pkg.owner,
		categories: pkg.categories,
		requiresSteamodded: activeVersions.some((v) =>
			v.dependencies.some((d) => d.startsWith(STEAMODDED_DEPENDENCY_PREFIX)),
		),
		// Talisman has no package on Thunderstore's Balatro community at all
		// (confirmed live: searched every package name/owner and every
		// version's dependency strings, zero matches) -- there is nothing a
		// dependency string could ever reference to prove this true, so it's
		// always false here. mod-index-merge.ts ORs this against the
		// GitHub-sourced value on a match rather than trusting this false as
		// a real "does not require Talisman" signal.
		requiresTalisman: false,
		repoUrl: latest.website_url || null,
		thumbnailUrl: latest.icon || null,
		description: latest.description || null,
		latestVersion: latest.version_number,
		latestDownloadUrl: latest.download_url,
		versions: activeVersions.map((v) => ({
			version: v.version_number,
			downloadUrl: v.download_url,
			releasedAt: v.date_created || null,
		})),
	}
}
