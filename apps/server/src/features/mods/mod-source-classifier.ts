// Classifies a mod's download URL (mod_registry.latest_download_url /
// mod_registry_versions.download_url) into one of three source types, so
// the server (and, mirrored in C++, the launcher -- see new-launcher's
// src/mods/modsourceclassifier.h/.cpp) can construct its own reliable fetch
// URL for the two types where that's possible, instead of trusting the
// literal stored URL. This exists because github.com/<owner>/<repo>/
// archive/refs/heads/<branch>.zip and its own codeload.github.com redirect
// target were confirmed (live, repeatedly) to serve genuinely different,
// each internally-consistent zip byte-streams for the identical commit --
// GitHub's branch-archive endpoint isn't a stable, cacheable artifact, so a
// hash computed from one fetch can permanently disagree with a hash
// computed from another. A survey of all 432 production
// mod_registry.latest_download_url values found the exact same risk on tag
// archives too (a moving tag could technically be re-pointed, though this
// is far rarer in practice than the redirect-target problem above), while
// real uploaded release assets are a stable, static-file CDN mechanism and
// need no reconstruction.
//
// A pure function of the URL string, with no DB column/API field of its
// own -- computed independently wherever a fetch URL is needed, same as
// relocateModRoot()/ZipWriter's "kept in lockstep across TS and C++"
// pattern.
export type ModSourceType = 'branch' | 'release' | 'custom'

const BRANCH_ARCHIVE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/archive\/refs\/heads\/(.+)\.zip$/

const RELEASE_ASSET_LATEST = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/latest\/download\/(.+)$/
const RELEASE_ASSET_TAGGED = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/releases\/download\/([^/]+)\/(.+)$/
const TAG_ARCHIVE = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/archive\/refs\/tags\/(.+)\.zip$/
// Legacy shape (no "refs/" prefix) -- still present on some older mods.
const TAG_ARCHIVE_LEGACY = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/archive\/(.+)\.zip$/
const TAG_ARCHIVE_CODELOAD = /^https:\/\/codeload\.github\.com\/([^/]+)\/([^/]+)\/zip\/refs\/tags\/(.+)$/

export function classifyDownloadUrl(url: string): ModSourceType {
	if (BRANCH_ARCHIVE.test(url)) return 'branch'
	if (
		RELEASE_ASSET_LATEST.test(url) ||
		RELEASE_ASSET_TAGGED.test(url) ||
		TAG_ARCHIVE.test(url) ||
		TAG_ARCHIVE_LEGACY.test(url) ||
		TAG_ARCHIVE_CODELOAD.test(url)
	) {
		return 'release'
	}
	return 'custom'
}

// Returns the URL to actually fetch from: reconstructed via
// codeload.github.com for the two source shapes confirmed unreliable
// (branch archives and tag archives), used as-is for a real release asset
// (releases/download/... -- GitHub's release CDN, not subject to the same
// instability) or a Custom URL (nothing to reconstruct against).
export function resolveReliableDownloadUrl(url: string): string {
	const branchMatch = url.match(BRANCH_ARCHIVE)
	if (branchMatch) {
		const [, owner, repo, branch] = branchMatch
		return `https://codeload.github.com/${owner}/${repo}/zip/refs/heads/${branch}`
	}

	const tagMatch =
		url.match(TAG_ARCHIVE) ?? url.match(TAG_ARCHIVE_LEGACY) ?? url.match(TAG_ARCHIVE_CODELOAD)
	if (tagMatch) {
		const [, owner, repo, tag] = tagMatch
		return `https://codeload.github.com/${owner}/${repo}/zip/refs/tags/${tag}`
	}

	// Real release asset or Custom -- the literal URL is already the
	// reliable one (or the only one we have).
	return url
}
