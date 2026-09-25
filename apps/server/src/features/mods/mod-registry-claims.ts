// Decides which mod_registry row each Thunderstore package writes to. Pure --
// no I/O -- so the whole claim policy is unit-testable on its own (see
// mod-registry-claims.test.ts).

export interface ExistingModRow {
	id: string
	thunderstoreFullName: string | null
	repoUrl: string | null
	// Admin-created custom rows are invisible to claiming: no package may
	// take one over, and none may be inserted under its id.
	isCustom?: boolean
}

export interface ClaimablePackage {
	fullName: string
	repoUrl: string | null
}

export type ModRowClaim =
	// A row this package already owns (a previous sync set its full name).
	| { kind: 'owned'; id: string }
	// A carried-over row without a package yet, taken over keeping its id.
	| { kind: 'claimed'; id: string }
	// No row to reuse: insert one with id = full name.
	| { kind: 'new'; id: string }
	// The id this package would get is already an admin-created custom mod:
	// skip the package rather than overwrite or collide with it.
	| { kind: 'skip'; id: string }

// Legacy ids whose repo URL doesn't lead to their Thunderstore package
// (moved repos, or a website_url that isn't the repo) but which clients
// hardcode, so they must keep resolving. Keyed by legacy id.
export const LEGACY_ID_ALIASES: Readonly<Record<string, string>> = {
	Multiplayer: 'BalatroMultiplayer-Multiplayer',
	MultiplayerAPI: 'BalatroMultiplayer-MultiplayerAPI',
	MultiplayerSPDRN: 'BalatroMultiplayer-MultiplayerSpeedrun',
	smods: 'Steamodded-Steamodded',
}

// Strips protocol/www./trailing slash/.git so "https://github.com/Foo/Bar",
// "http://www.github.com/Foo/Bar/" and "https://github.com/Foo/Bar.git" all
// match the same repo. No fuzzy name matching: two different mods can share
// a title, but not a repo.
export function normalizeRepoUrl(url: string | null): string | null {
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

// Returns one claim per package, keyed by full name. Precedence: a row the
// package already owns, then an alias, then a row whose id is the full name
// itself, then a repo-URL match. Each row is claimed by at most one package;
// when two packages share a repo URL the first in input order wins and the
// other gets a new row.
export function planModRowClaims(
	packages: ClaimablePackage[],
	rows: ExistingModRow[],
): Map<string, ModRowClaim> {
	const ownedByFullName = new Map<string, string>()
	const unclaimed = new Map<string, ExistingModRow>()
	const customIds = new Set<string>()
	for (const row of rows) {
		if (row.isCustom) {
			customIds.add(row.id)
		} else if (row.thunderstoreFullName) {
			ownedByFullName.set(row.thunderstoreFullName, row.id)
		} else {
			unclaimed.set(row.id, row)
		}
	}

	const aliasIdByFullName = new Map<string, string>()
	for (const [legacyId, fullName] of Object.entries(LEGACY_ID_ALIASES)) {
		aliasIdByFullName.set(fullName, legacyId)
	}

	const claims = new Map<string, ModRowClaim>()
	const take = (fullName: string, id: string) => {
		unclaimed.delete(id)
		claims.set(fullName, { kind: 'claimed', id })
	}

	// Owned rows first, then the explicit matches, so a repo-URL match can
	// never take a row an alias or exact id was meant to get.
	for (const pkg of packages) {
		const ownedId = ownedByFullName.get(pkg.fullName)
		if (ownedId) claims.set(pkg.fullName, { kind: 'owned', id: ownedId })
	}
	for (const pkg of packages) {
		if (claims.has(pkg.fullName)) continue
		const aliasId = aliasIdByFullName.get(pkg.fullName)
		if (aliasId && unclaimed.has(aliasId)) take(pkg.fullName, aliasId)
		else if (unclaimed.has(pkg.fullName)) take(pkg.fullName, pkg.fullName)
	}

	const unclaimedByRepoUrl = new Map<string, string>()
	for (const row of unclaimed.values()) {
		const normalized = normalizeRepoUrl(row.repoUrl)
		if (normalized && !unclaimedByRepoUrl.has(normalized)) {
			unclaimedByRepoUrl.set(normalized, row.id)
		}
	}

	for (const pkg of packages) {
		if (claims.has(pkg.fullName)) continue
		const normalized = normalizeRepoUrl(pkg.repoUrl)
		const repoMatchId = normalized
			? unclaimedByRepoUrl.get(normalized)
			: undefined
		if (repoMatchId && unclaimed.has(repoMatchId)) {
			take(pkg.fullName, repoMatchId)
		} else if (customIds.has(pkg.fullName)) {
			claims.set(pkg.fullName, { kind: 'skip', id: pkg.fullName })
		} else {
			claims.set(pkg.fullName, { kind: 'new', id: pkg.fullName })
		}
	}

	return claims
}
