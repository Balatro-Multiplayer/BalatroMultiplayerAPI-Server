// Thunderstore's own Balatro community package list -- a single unauthenticated
// GET returns the whole catalog (~140 packages as of writing, confirmed live),
// no pagination, no token. This is the sole mod index source (see
// drizzle/0041_mod_registry_thunderstore_only.sql).
const PACKAGE_INDEX_URL = 'https://thunderstore.io/c/balatro/api/v1/package/'
const FETCH_TIMEOUT_MS = 60_000

// Dependency strings are "Owner-Name-Version". Steamodded is published under
// more than one owner (Steamodded-Steamodded, Steamopollys-Steamodded), so
// match on the package name alone.
const STEAMODDED_DEPENDENCY = /^[^-]+-Steamodded-/
// Talisman has no Thunderstore package today; kept so a future one counts.
const TALISMAN_DEPENDENCY = /^[^-]+-Talisman-/

export interface ModIndexVersionInput {
	version: string
	downloadUrl: string
	releasedAt: string | null
	dependencies: string[]
}

export interface ModIndexEntryInput {
	fullName: string
	title: string
	author: string
	categories: string[]
	requiresSteamodded: boolean
	requiresTalisman: boolean
	repoUrl: string | null
	thumbnailUrl: string | null
	description: string | null
	packageUrl: string | null
	donationLink: string | null
	latestVersion: string
	latestDownloadUrl: string
	sourceUpdatedAt: string | null
	// Active versions only, newest first.
	versions: ModIndexVersionInput[]
}

export interface ThunderstoreIndexResult {
	entries: ModIndexEntryInput[]
	// Deprecated packages, or packages with no is_active version at all.
	skipped: number
}

interface ThunderstoreVersion {
	description: string
	icon: string
	version_number: string
	dependencies: string[]
	download_url: string
	date_created: string
	website_url: string
	is_active: boolean
}

export interface ThunderstorePackage {
	name: string
	full_name: string
	owner: string
	categories: string[]
	package_url: string
	// Only present on packages that set one.
	donation_link?: string
	date_updated: string
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

// Maps one package to the row mods-sync.service.ts upserts, or null for a
// package that shouldn't be listed (deprecated, or nothing active). Versions
// are newest first in Thunderstore's own response order (confirmed live), so
// the first active one is the latest.
export function toModIndexEntry(
	pkg: ThunderstorePackage,
): ModIndexEntryInput | null {
	if (pkg.is_deprecated) return null
	const active = pkg.versions.filter((v) => v.is_active)
	const latest = active[0]
	if (!latest) return null

	const dependsOn = (pattern: RegExp) =>
		active.some((v) => v.dependencies.some((d) => pattern.test(d)))

	return {
		fullName: pkg.full_name,
		title: pkg.name,
		author: pkg.owner,
		categories: pkg.categories,
		requiresSteamodded: dependsOn(STEAMODDED_DEPENDENCY),
		requiresTalisman: dependsOn(TALISMAN_DEPENDENCY),
		repoUrl: latest.website_url || null,
		thumbnailUrl: latest.icon || null,
		description: latest.description || null,
		packageUrl: pkg.package_url || null,
		donationLink: pkg.donation_link || null,
		latestVersion: latest.version_number,
		latestDownloadUrl: latest.download_url,
		sourceUpdatedAt: pkg.date_updated || null,
		versions: active.map((v) => ({
			version: v.version_number,
			downloadUrl: v.download_url,
			releasedAt: v.date_created || null,
			dependencies: v.dependencies,
		})),
	}
}

export async function fetchThunderstoreModIndex(): Promise<ThunderstoreIndexResult> {
	const packages = await fetchPackageList()

	const entries: ModIndexEntryInput[] = []
	let skipped = 0
	for (const pkg of packages) {
		const entry = toModIndexEntry(pkg)
		if (entry) entries.push(entry)
		else skipped++
	}

	return { entries, skipped }
}

// Live per-package version list, used by webadmin/mods.route.ts to offer and
// validate an admin-supplied rankedVersion against what Thunderstore
// currently serves, and by mods.gateway.ts's setRankedVersion to resolve the
// exact downloadUrl to hash. Re-fetches the whole catalog rather than calling
// a single-package endpoint -- pinning is rare enough that the extra bytes
// don't matter.
export async function fetchThunderstorePackageVersions(
	fullName: string,
): Promise<Array<{ version: string; downloadUrl: string }>> {
	const packages = await fetchPackageList()
	const pkg = packages.find((p) => p.full_name === fullName)
	if (!pkg) return []

	return pkg.versions
		.filter((v) => v.is_active)
		.map((v) => ({ version: v.version_number, downloadUrl: v.download_url }))
}
