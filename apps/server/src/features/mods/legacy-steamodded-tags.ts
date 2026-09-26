// TEMPORARY compatibility shim for launchers (BET) that still pin Steamodded
// by its old GitHub tag ("1.0.0-beta-1620a") in saved profiles and in the
// ranked legacy-Multiplayer override. Thunderstore spells the same releases
// "1.<build>.<letter index>" (1620a -> 1.1620.0, 1606b -> 1.1606.1), so the
// launcher's exact-tag lookup misses and its GitHub fallback can't run
// (repoUrl is smods.dev). Remove once launchers with the alias-aware
// resolver (new-launcher 1537ea6) are what players run.

export const STEAMODDED_FULL_NAME = 'Steamodded-Steamodded'

const THUNDERSTORE_BUILD = /^1\.(\d{3,4})\.(\d{1,2})$/

export function legacySteamoddedTag(version: string): string | null {
	const m = THUNDERSTORE_BUILD.exec(version)
	if (!m) return null
	const letterIndex = Number(m[2])
	if (letterIndex > 25) return null
	const letter = letterIndex === 0 ? 'a' : String.fromCharCode(97 + letterIndex)
	return `1.0.0-beta-${m[1]}${letter}`
}

// Appends a legacy-tagged twin (same download, same hash) after the real
// versions, so versions[0] stays the true latest.
export function withLegacySteamoddedTags<
	T extends { version: string; sha256: string | null },
>(fullName: string | null, versions: T[]): T[] {
	if (fullName !== STEAMODDED_FULL_NAME) return versions
	const twins = versions.flatMap((v) => {
		const tag = legacySteamoddedTag(v.version)
		return tag ? [{ ...v, version: tag }] : []
	})
	return [...versions, ...twins]
}
