import {
	type RepoInfo,
	commitArchiveUrl,
	extractRepoInfo,
	fetchCommit,
	fetchLatestReleaseTag,
	githubGet,
	releaseAssetUrl,
	tagArchiveUrl,
} from './github-api.js'
import { branchOfDownloadUrl } from './custom-mod-version-check.service.js'

// GitHub releases/tags as versions, each with a permanent download URL. Used
// for custom mods and for Thunderstore mods an admin set to "also track
// GitHub". Commits aren't listed -- an admin pins one by SHA (pinCommit).

export interface GithubVersion {
	name: string
	ref: string
	downloadUrl: string
	releasedAt: string | null
}

const PER_PAGE = 100
const RELEASE_ASSET_NAME =
	/\/releases\/(?:latest\/download|download\/[^/]+)\/([^/]+)$/

// A release keeps the asset the mod's own latest URL points at (same file
// name), so its versions deploy the same kind of archive; otherwise the tag's
// source archive.
export async function listGithubVersions(
	repoUrl: string | null,
	latestDownloadUrl: string | null,
): Promise<GithubVersion[] | null> {
	const info = extractRepoInfo(repoUrl)
	if (!info) return null
	const preferredAsset = latestDownloadUrl
		? RELEASE_ASSET_NAME.exec(latestDownloadUrl)?.[1]
		: undefined

	const releasesRes = await githubGet(
		`/repos/${info.owner}/${info.repo}/releases?per_page=${PER_PAGE}`,
	)
	const tagsRes = await githubGet(
		`/repos/${info.owner}/${info.repo}/tags?per_page=${PER_PAGE}`,
	)
	if (!releasesRes || !tagsRes) return null

	type Release = {
		tag_name: string
		draft: boolean
		published_at: string | null
		assets: Array<{ name: string }>
	}
	const releases =
		releasesRes.status === 404 ? [] : ((await releasesRes.json()) as Release[])
	const tags =
		tagsRes.status === 404
			? []
			: ((await tagsRes.json()) as Array<{ name: string }>)

	const out: GithubVersion[] = []
	const seen = new Set<string>()
	for (const release of releases) {
		if (release.draft || seen.has(release.tag_name)) continue
		seen.add(release.tag_name)
		const asset =
			preferredAsset &&
			release.assets.find((a) => a.name === preferredAsset)?.name
		out.push({
			name: release.tag_name,
			ref: release.tag_name,
			downloadUrl: asset
				? releaseAssetUrl(info, release.tag_name, asset)
				: tagArchiveUrl(info, release.tag_name),
			releasedAt: release.published_at,
		})
	}
	for (const tag of tags) {
		if (seen.has(tag.name)) continue
		seen.add(tag.name)
		out.push({
			name: tag.name,
			ref: tag.name,
			downloadUrl: tagArchiveUrl(info, tag.name),
			releasedAt: null,
		})
	}
	return out
}

// A commit an admin wants to pin, resolved to its full SHA and permanent URL.
export async function resolveCommitVersion(
	repoUrl: string | null,
	sha: string,
): Promise<GithubVersion | null> {
	const info = extractRepoInfo(repoUrl)
	if (!info || !/^[0-9a-f]{7,40}$/i.test(sha)) return null
	const commit = await fetchCommit(info, sha)
	if (!commit) return null
	return {
		name: commit.sha.slice(0, 7),
		ref: commit.sha,
		downloadUrl: commitArchiveUrl(info, commit.sha),
		releasedAt: commit.date,
	}
}

const BRANCH_ARCHIVE =
	/^https:\/\/github\.com\/[^/]+\/[^/]+\/archive\/refs\/heads\//
const LATEST_ASSET = /\/releases\/latest\/download\/([^/]+)$/
const TAG_ARCHIVE =
	/^https:\/\/github\.com\/[^/]+\/[^/]+\/archive\/refs\/tags\/(.+)\.zip$/
// Legacy github.com/<o>/<r>/archive/<ref>.zip: a tag or a branch.
const LEGACY_ARCHIVE =
	/^https:\/\/github\.com\/[^/]+\/[^/]+\/archive\/(.+)\.zip$/
const VERSION_LIKE_REF = /^[vV]?\d+(\.\d+)*$/

// Turns a version row's stored URL into one that can't move, at pin time:
// a branch head becomes that commit's archive, a "latest release" asset
// becomes the same asset on the tag it currently resolves to, and a
// github.com tag archive becomes codeload's. Thunderstore URLs and permanent
// GitHub URLs pass through. A raw non-GitHub URL also passes through -- it
// can't be made permanent, and the launcher's post-download hash check is
// what guards it. Null when a moving URL can't be resolved right now.
export async function toPermanentUrl(
	downloadUrl: string,
	repoUrl: string | null,
	ref: string | null,
): Promise<string | null> {
	const info: RepoInfo | null = extractRepoInfo(repoUrl ?? downloadUrl)
	if (!info) return downloadUrl

	if (BRANCH_ARCHIVE.test(downloadUrl)) {
		// A head version row already knows its commit (ref); otherwise take the
		// branch's head right now.
		const commit = ref
			? { sha: ref }
			: await fetchCommit(info, branchOfDownloadUrl(downloadUrl))
		return commit ? commitArchiveUrl(info, commit.sha) : null
	}
	const latestAsset = LATEST_ASSET.exec(downloadUrl)
	if (latestAsset) {
		const tag = ref ?? (await fetchLatestReleaseTag(info))
		return tag ? releaseAssetUrl(info, tag, latestAsset[1]) : null
	}
	const tagArchive = TAG_ARCHIVE.exec(downloadUrl)
	if (tagArchive) return tagArchiveUrl(info, tagArchive[1])
	const legacy = LEGACY_ARCHIVE.exec(downloadUrl)
	if (legacy) {
		if (VERSION_LIKE_REF.test(legacy[1])) return tagArchiveUrl(info, legacy[1])
		const commit = ref ? { sha: ref } : await fetchCommit(info, legacy[1])
		return commit ? commitArchiveUrl(info, commit.sha) : null
	}
	return downloadUrl
}
