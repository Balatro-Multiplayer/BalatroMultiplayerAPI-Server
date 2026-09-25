// Thunderstore's own Balatro community package list -- a single unauthenticated
// GET returns the whole catalog (120 packages as of writing, confirmed live),
// no pagination, no token, same "plain HTTPS GET, no API rate-limit games"
// philosophy this project already applies elsewhere. This is now the sole
// mod index source (see drizzle/0039_mod_registry_thunderstore_only.sql's
// own comment for why the second, GitHub-sourced index was dropped).
const PACKAGE_INDEX_URL = 'https://thunderstore.io/c/balatro/api/v1/package/'
const FETCH_TIMEOUT_MS = 60_000

export interface ModIndexEntryInput {
	id: string
	title: string
	author: string
}

export interface ThunderstoreIndexResult {
	entries: ModIndexEntryInput[]
	// Deprecated packages, or packages with no is_active version at all.
	skipped: number
}

export interface ThunderstorePackageVersion {
	version: string
	downloadUrl: string
}

interface ThunderstoreVersion {
	version_number: string
	download_url: string
	is_active: boolean
}

interface ThunderstorePackage {
	name: string
	full_name: string
	owner: string
	is_deprecated: boolean
	versions: ThunderstoreVersion[]
}

async function fetchPackageList(): Promise<ThunderstorePackage[]> {
	const res = await fetch(PACKAGE_INDEX_URL, {
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	})
	if (!res.ok) {
		throw new Error(`thunderstore package index fetch failed: ${res.status}`)
	}
	return (await res.json()) as ThunderstorePackage[]
}

// Fetches thunderstore.io/c/balatro's package list and transforms it into the
// minimal shape mods-sync.service.ts upserts into mod_registry -- id/title/
// author only. id is Thunderstore's own full_name ("Owner-ModName") verbatim,
// unprefixed -- there's no second source left to disambiguate against.
export async function fetchThunderstoreModIndex(): Promise<ThunderstoreIndexResult> {
	const packages = await fetchPackageList()

	const entries: ModIndexEntryInput[] = []
	let skipped = 0
	for (const pkg of packages) {
		if (pkg.is_deprecated || !pkg.versions.some((v) => v.is_active)) {
			skipped++
			continue
		}
		entries.push({ id: pkg.full_name, title: pkg.name, author: pkg.owner })
	}

	return { entries, skipped }
}

// Live per-mod version list, used by webadmin/mods.route.ts's PUT handler to
// validate an admin-supplied rankedVersion against what Thunderstore actually
// currently serves, and by mods.gateway.ts's setRankedVersion to resolve the
// exact downloadUrl to hash. Re-fetches the whole catalog rather than calling
// a hypothetical single-package endpoint -- this is the one Thunderstore
// endpoint already confirmed live and working (fetchThunderstoreModIndex
// above uses it too), and admin-triggered ranked-version pinning is rare
// enough that the extra bytes don't matter.
export async function fetchThunderstorePackageVersions(
	modId: string,
): Promise<ThunderstorePackageVersion[]> {
	const packages = await fetchPackageList()
	const pkg = packages.find((p) => p.full_name === modId)
	if (!pkg) return []

	return pkg.versions
		.filter((v) => v.is_active)
		.map((v) => ({ version: v.version_number, downloadUrl: v.download_url }))
}
