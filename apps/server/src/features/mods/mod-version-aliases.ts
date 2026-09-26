// Version naming across sources. Thunderstore versions are bare semver
// ("1.2.0"); the same release on GitHub is usually a tag like "v1.2.0", and
// Steamodded's GitHub tags are "1.0.0-beta-1814a" where Thunderstore has
// "1.1814.0" (the tag's letter is the patch number: 1606b is 1.1606.1, 0827c
// is 1.827.2). A mod's merged version list keeps only the Thunderstore name
// and records the GitHub spellings as aliases, so a profile pinned under the
// old name still resolves (see new-launcher THUNDERSTORE_MIGRATION_PLAN.md
// section 3, "Version names and aliases").

export type VersionSource = 'thunderstore' | 'github'

const STEAMODDED_FULL_NAME = /-Steamodded$/
const STEAMODDED_TS_VERSION = /^1\.(\d+)\.(\d+)$/
const STEAMODDED_GH_TAG = /^1\.0\.0-beta-(\d+)([a-z])?$/

export function isSteamodded(thunderstoreFullName: string | null): boolean {
	return (
		!!thunderstoreFullName && STEAMODDED_FULL_NAME.test(thunderstoreFullName)
	)
}

// The key two spellings of one release share: lowercase, no leading "v",
// and Steamodded's beta tags mapped onto their Thunderstore number.
export function canonicalVersionKey(name: string, steamodded: boolean): string {
	let key = name
		.trim()
		.toLowerCase()
		.replace(/^v(?=\d)/, '')
	const beta = steamodded ? STEAMODDED_GH_TAG.exec(key) : null
	if (beta) {
		const patch = beta[2] ? beta[2].charCodeAt(0) - 97 : 0
		key = `1.${Number(beta[1])}.${patch}`
	}
	return key
}

// The GitHub tag Steamodded used for a Thunderstore build number
// ("1.1620.0" -> "1.0.0-beta-1620a", "1.827.2" -> "1.0.0-beta-0827c"), or
// null when the version isn't one of those builds.
export function steamoddedGithubTag(version: string): string | null {
	const beta = STEAMODDED_TS_VERSION.exec(version)
	if (!beta) return null
	const patch = Number(beta[2])
	if (patch > 25) return null
	return `1.0.0-beta-${beta[1].padStart(4, '0')}${String.fromCharCode(97 + patch)}`
}

// Rule-based aliases every Thunderstore version gets, whether or not the mod
// tracks GitHub -- enough for GitHub-era pins to keep resolving.
export function thunderstoreAliases(
	thunderstoreFullName: string | null,
	version: string,
): string[] {
	const aliases = [`v${version}`]
	const tag = isSteamodded(thunderstoreFullName)
		? steamoddedGithubTag(version)
		: null
	if (tag) {
		aliases.push(tag)
		// "1.0.0-beta-0827" (no letter) also names the .0 build.
		if (tag.endsWith('a')) aliases.push(tag.slice(0, -1))
	}
	return aliases
}

export interface GithubVersionCandidate {
	name: string
}

// Splits GitHub versions into those that are the same release as a
// Thunderstore version (folded in as an alias of it) and those that are
// GitHub-only (listed on their own).
export function foldGithubVersions<T extends GithubVersionCandidate>(
	thunderstoreVersions: string[],
	githubVersions: T[],
	steamodded: boolean,
): { aliases: Map<string, string[]>; githubOnly: T[] } {
	const tsByKey = new Map<string, string>()
	for (const version of thunderstoreVersions) {
		tsByKey.set(canonicalVersionKey(version, steamodded), version)
	}
	const aliases = new Map<string, string[]>()
	const githubOnly: T[] = []
	for (const gh of githubVersions) {
		const match = tsByKey.get(canonicalVersionKey(gh.name, steamodded))
		if (match === undefined) {
			githubOnly.push(gh)
		} else if (gh.name !== match) {
			aliases.set(match, [...(aliases.get(match) ?? []), gh.name])
		}
	}
	return { aliases, githubOnly }
}

// Whether `name` refers to a version row (by its own name or an alias).
// Case-insensitive, same as the launcher's lookup.
export function matchesVersion(
	row: { version: string; aliases: string[] },
	name: string,
): boolean {
	const wanted = name.toLowerCase()
	return (
		row.version.toLowerCase() === wanted ||
		row.aliases.some((alias) => alias.toLowerCase() === wanted)
	)
}
