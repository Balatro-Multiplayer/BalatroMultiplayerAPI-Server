// TEMPORARY compatibility shim for launchers (BET) that still pin Steamodded
// by its old GitHub tag ("1.0.0-beta-1620a") in saved profiles and in the
// ranked legacy-Multiplayer override. Thunderstore spells the same releases
// "1.<build>.<letter index>" (1620a -> 1.1620.0, 1606b -> 1.1606.1), so the
// launcher's exact-tag lookup misses and its GitHub fallback can't run
// (repoUrl is smods.dev). Remove once launchers with the alias-aware
// resolver are what players run.
//
// Each twin names the real version in legacyAliasOf, so alias-aware
// launchers can skip it (they already match the same name through the real
// version's aliases).

import { steamoddedGithubTag } from './mod-version-aliases.js'

export const STEAMODDED_FULL_NAME = 'Steamodded-Steamodded'

export const legacySteamoddedTag = steamoddedGithubTag

// Appends a legacy-tagged twin (same download, same hash) after the real
// versions, so versions[0] stays the true latest.
export function withLegacySteamoddedTags<
	T extends { version: string; sha256: string | null },
>(
	fullName: string | null,
	versions: T[],
): (T | (T & { legacyAliasOf: string }))[] {
	if (fullName !== STEAMODDED_FULL_NAME) return versions
	const twins = versions.flatMap((v) => {
		const tag = legacySteamoddedTag(v.version)
		return tag
			? [{ ...v, version: tag, aliases: [], legacyAliasOf: v.version }]
			: []
	})
	return [...versions, ...twins]
}
