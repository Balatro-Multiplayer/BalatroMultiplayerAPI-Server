import { AppError } from '../../shared/utils/errors.js'
import {
	type RepoInfo,
	canonicalRepoUrl,
	commitArchiveUrl,
	extractRepoInfo,
	fetchCommit,
	fetchLatestReleaseTag,
	githubGet,
	releaseAssetUrl,
	tagArchiveUrl,
} from './github-api.js'
import { classifyDownloadUrl } from './mod-source-classifier.js'

// TS port of BETModIndex's update_mod_versions.py, scoped to admin-created
// custom mods (mod_registry.is_custom rows) that opt into
// automaticVersionCheck -- Thunderstore mods get new versions from the
// Thunderstore sync instead, and a custom mod has no meta.json anywhere for
// that script to have run against.
export type VersionSource = 'latest_tag' | 'specific_tag' | 'head'

export interface VersionCheckInput {
	repoUrl: string | null
	latestVersion: string | null
	latestDownloadUrl: string | null
	fixedReleaseTagUpdates: boolean
}

export interface VersionCheckResult {
	newVersion: string
	// null means "leave latestDownloadUrl exactly as it is" (the HEAD case,
	// and the common LATEST_TAG case where the URL already points at
	// .../releases/latest/download/... and naturally serves the new
	// release's asset without needing to change).
	newDownloadUrl: string | null
	// Permanent URL for newVersion's own version row (a commit archive for a
	// branch head, the tag's asset or source archive for a release) -- what a
	// ranked pin on that version downloads, unlike the moving latest URL.
	versionDownloadUrl: string
	source: VersionSource
}

async function fetchSpecificTag(
	info: RepoInfo,
	tagName: string,
): Promise<{ version: string; assetName: string } | null> {
	const res = await githubGet(
		`/repos/${info.owner}/${info.repo}/releases/tags/${tagName}`,
	)
	if (!res || res.status === 404) return null
	const data = (await res.json()) as {
		assets?: Array<{ name: string; created_at: string }>
	}
	const assets = data.assets ?? []
	if (assets.length === 0) return null

	// Picks the asset with the lexicographically-latest created_at -- a plain
	// string comparison, not Date parsing, matching update_mod_versions.py's
	// own tie-break exactly (it works by coincidence of ISO8601's
	// lexicographic-equals-chronological ordering, not because it's doing
	// real date comparison -- kept as-is for behavioral parity, not "fixed").
	let latestCreatedAt = ''
	let latestAsset: string | null = null
	for (const asset of assets) {
		if (asset.created_at > latestCreatedAt) {
			latestCreatedAt = asset.created_at
			latestAsset = asset.name
		}
	}
	if (!latestAsset) return null

	// 2099-12-31T01:02:03Z -> 20991231_010203
	const [datePart, timePart] = latestCreatedAt.replace('Z', '').split('T')
	const version = `${datePart.replace(/-/g, '')}_${timePart.replace(/:/g, '')}`
	return { version, assetName: latestAsset }
}

const BRANCH_IN_URL = /\/archive\/refs\/heads\/(.+)\.zip$/
const LATEST_ASSET_IN_URL = /\/releases\/latest\/download\/([^/]+)$/

// The branch a branch-archive URL tracks, so its head is read from that
// branch rather than the repo's default one.
export function branchOfDownloadUrl(downloadUrl: string): string | undefined {
	return BRANCH_IN_URL.exec(downloadUrl)?.[1]
}

// Permanent URL for a release tag's version row: the same asset the moving
// "latest" link serves, pinned to that tag, or else the tag's source archive.
function tagVersionUrl(info: RepoInfo, tag: string, latestUrl: string) {
	const asset = LATEST_ASSET_IN_URL.exec(latestUrl)?.[1]
	return asset ? releaseAssetUrl(info, tag, asset) : tagArchiveUrl(info, tag)
}

export async function checkCustomModVersion(
	mod: VersionCheckInput,
): Promise<VersionCheckResult | null> {
	const info = extractRepoInfo(mod.repoUrl)
	if (!info) return null
	const downloadUrl = mod.latestDownloadUrl ?? ''

	let source: VersionSource
	let newVersion: string | null = null
	let newDownloadUrl: string | null = null
	let versionDownloadUrl: string | null = null

	const head = async (branch?: string) => {
		const commit = await fetchCommit(info, branch)
		if (!commit) return
		newVersion = commit.sha.slice(0, 7)
		versionDownloadUrl = commitArchiveUrl(info, commit.sha)
	}

	if (classifyDownloadUrl(downloadUrl) === 'branch') {
		source = 'head'
		await head(branchOfDownloadUrl(downloadUrl))
	} else if (
		mod.fixedReleaseTagUpdates &&
		downloadUrl.includes('/releases/download/')
	) {
		source = 'specific_tag'
		const parts = downloadUrl.split('/')
		const tagName = parts[parts.length - 2]
		const result = await fetchSpecificTag(info, tagName)
		if (!result) return null
		newVersion = result.version
		newDownloadUrl = releaseAssetUrl(info, tagName, result.assetName)
		versionDownloadUrl = newDownloadUrl
	} else {
		source = 'latest_tag'
		const tag = await fetchLatestReleaseTag(info)
		if (tag) {
			newVersion = tag
			if (downloadUrl.includes('/archive/refs/tags/')) {
				newDownloadUrl = `${canonicalRepoUrl(info)}/archive/refs/tags/${tag}.zip`
			}
			versionDownloadUrl = tagVersionUrl(info, tag, downloadUrl)
		} else {
			// Zero releases -- fall back to HEAD, same as update_mod_versions.py.
			source = 'head'
			await head()
		}
	}

	if (!newVersion || !versionDownloadUrl || newVersion === mod.latestVersion) {
		return null
	}
	return { newVersion, newDownloadUrl, versionDownloadUrl, source }
}

// Admin-facing counterpart to checkCustomModVersion above: that function
// re-checks an *existing* latestDownloadUrl for drift; this one constructs
// a fresh one from a structured "what kind of source is this" choice (see
// mods.route.ts's PATCH /mods/:modId and POST /mods, and mod-form-dialog.tsx
// on the client) instead of asking an admin to hand-type one of
// mod-source-classifier.ts's five regex-shaped URL conventions themselves -
// the actual root cause of a real bug where an admin's edit was technically
// valid but silently unpropagatable (see git history).
export type SourceInput =
	| { sourceType: 'branch'; repoUrl: string; branch: string }
	| { sourceType: 'release'; repoUrl: string }
	| { sourceType: 'custom'; url: string }

export interface ResolvedSource {
	latestDownloadUrl: string
	latestVersion: string | null
	// Permanent URL for latestVersion's own version row (see
	// VersionCheckResult.versionDownloadUrl); null for a raw custom URL.
	versionDownloadUrl: string | null
}

// Throws AppError (never returns null) - this runs synchronously inside an
// admin's save action, unlike checkCustomModVersion's best-effort/silent-
// skip shape meant for an unattended periodic job. An admin actively
// choosing "Branch" or "Release" needs to know immediately if the repo/
// branch/tag couldn't actually be resolved, not have the save silently
// succeed with a stale or empty URL.
export async function resolveSourceInput(
	input: SourceInput,
): Promise<ResolvedSource> {
	if (input.sourceType === 'custom') {
		return {
			latestDownloadUrl: input.url,
			latestVersion: null,
			versionDownloadUrl: null,
		}
	}

	const info = extractRepoInfo(input.repoUrl)
	if (!info) {
		throw new AppError(
			'repoUrl must be a github.com/<owner>/<repo> URL to resolve a branch or release source',
			400,
		)
	}
	const repoUrl = canonicalRepoUrl(info)

	if (input.sourceType === 'branch') {
		const commit = await fetchCommit(info, input.branch)
		if (!commit) {
			throw new AppError(
				`Couldn't find branch '${input.branch}' on ${repoUrl} - check the branch name and try again`,
				400,
			)
		}
		return {
			latestDownloadUrl: `${repoUrl}/archive/refs/heads/${input.branch}.zip`,
			latestVersion: commit.sha.slice(0, 7),
			versionDownloadUrl: commitArchiveUrl(info, commit.sha),
		}
	}

	// 'release'
	const tag = await fetchLatestReleaseTag(info)
	if (!tag) {
		throw new AppError(`No releases found on ${repoUrl}`, 400)
	}
	return {
		latestDownloadUrl: `${repoUrl}/archive/refs/tags/${tag}.zip`,
		latestVersion: tag,
		versionDownloadUrl: tagArchiveUrl(info, tag),
	}
}
