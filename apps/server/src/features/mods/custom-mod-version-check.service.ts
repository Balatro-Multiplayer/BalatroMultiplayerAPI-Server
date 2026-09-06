import { env } from '../../env.js'
import { AppError } from '../../shared/utils/errors.js'
import { classifyDownloadUrl } from './mod-source-classifier.js'

// TS port of BETModIndex's update_mod_versions.py, scoped to admin-created
// custom mods (mod_registry.isCustom rows) that opt into
// automaticVersionCheck -- upstream mods get this for free from that same
// script running on the real skyline69/balatro-mod-index repo, but a custom
// mod has no meta.json anywhere for it to have already run against. Also
// home to resolveCommitPinnedDownloadUrl() below, which both this module's
// own HEAD-tracking callers and mods-sync.service.ts's upstream-index sync
// share -- see that function's doc comment.
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
	source: VersionSource
}

const GITHUB_API_BASE = 'https://api.github.com'
const GITHUB_FETCH_TIMEOUT_MS = 15_000

function githubHeaders(): HeadersInit {
	const headers: Record<string, string> = {
		Accept: 'application/vnd.github+json',
	}
	if (env.GITHUB_TOKEN) headers.Authorization = `token ${env.GITHUB_TOKEN}`
	return headers
}

// Every GitHub call in this module is best-effort: a 403/429 (rate limited),
// a 5xx, or a network error just means "no update detected this cycle, try
// again next hour" -- not a hard failure that should abort the rest of the
// sync. Mirrors computePreparedZipHash's existing best-effort pattern in
// mods-sync.service.ts. Deliberately no retry/backoff loop (unlike the
// Python original's up-to-30-minute wait) -- this runs inside the same
// blocking startup sync as everything else in mods-sync.service.ts.
async function githubGet(path: string): Promise<Response | null> {
	try {
		const res = await fetch(`${GITHUB_API_BASE}${path}`, {
			headers: githubHeaders(),
			signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
		})
		if (!res.ok && res.status !== 404) {
			console.warn(`[custom-mod-version-check] GET ${path} -> ${res.status}`)
			return null
		}
		return res
	} catch (err) {
		console.warn(`[custom-mod-version-check] GET ${path} failed:`, err)
		return null
	}
}

function extractRepoInfo(
	repoUrl: string,
): { owner: string; repo: string } | null {
	const match = /github\.com\/([^/]+)\/([^/]+)/.exec(repoUrl)
	if (!match) return null
	return { owner: match[1], repo: match[2].replace(/\.git$/, '') }
}

async function fetchLatestTag(
	owner: string,
	repo: string,
): Promise<string | null> {
	const res = await githubGet(`/repos/${owner}/${repo}/releases/latest`)
	if (!res || res.status === 404) return null
	const data = (await res.json()) as { tag_name?: string }
	return data.tag_name ?? null
}

// ref omitted -> the default branch's most recent commit (GitHub returns an
// array from /commits with no ref - existing checkCustomModVersion() 'head'
// callers rely on exactly this shape, since a mod's stored branch-archive
// URL doesn't get its branch name extracted/passed through there today).
// ref given -> that specific branch/sha's own commit (GitHub returns a
// single object from /commits/{ref}, a different shape) - used by
// resolveSourceInput()'s Branch mode below, which does know the exact
// branch name and would otherwise silently resolve the wrong branch's HEAD
// whenever it isn't the repo's default.
async function fetchHeadSha(
	owner: string,
	repo: string,
	ref?: string,
): Promise<string | null> {
	const path = ref
		? `/repos/${owner}/${repo}/commits/${ref}`
		: `/repos/${owner}/${repo}/commits`
	const res = await githubGet(path)
	if (!res || res.status === 404) return null
	if (ref) {
		const data = (await res.json()) as { sha?: string }
		return data.sha ? data.sha.slice(0, 7) : null
	}
	const data = (await res.json()) as Array<{ sha: string }>
	if (!Array.isArray(data) || data.length === 0) return null
	return data[0].sha.slice(0, 7)
}

// A short (7-char, matching what update_mod_versions.py/fetchHeadSha above
// both write) or full (40-char) git commit SHA.
const GIT_SHA_LIKE = /^[0-9a-f]{7,40}$/i

// Branch-tracked mods (no GitHub releases -- downloadUrl classifies as
// 'branch') get their `version` bumped by update_mod_versions.py to the
// *whole repo's* latest commit SHA on any commit anywhere in the repo, but
// that script only ever rewrites `downloadURL` for its tag/release cases --
// never for the HEAD case (see that script: the `if`/`elif` guarding
// `meta['downloadURL'] = ...` has no branch for `VersionSource.HEAD` at
// all). So every version ever recorded for such a mod carries the exact
// same URL: the branch's own live-HEAD archive link. Downloading it always
// fetches "whatever's on the branch right now", never the specific commit
// the version label names -- confirmed live via
// skyline69/balatro-mod-index's Aikoyori@Aikoyoris-Shenanigans, whose
// mod_registry_versions history has a dozen distinct commit-hash version
// labels all sharing one identical downloadUrl and (whenever the branch
// hadn't actually moved between two of those label bumps) identical sha256.
// The real cost isn't the duplication itself -- it's that an *older* label
// becomes permanently unfetchable once the branch advances past it: nothing
// in this pipeline can ever again produce that label's original bytes,
// which silently breaks any profile (a Ranked rankedVersion pin, or a user
// manually pinning an older entry from the version dropdown) sitting on it.
//
// This resolves the label to a real, permanently-fetchable commit-pinned
// codeload URL instead -- one extra GitHub API call, made only the first
// time a given (modId, version) is about to be hashed and stored (see
// mods-sync.service.ts's pinBranchVersionIfNew()), never on every sync,
// since a version already hashed/stored is never re-resolved. Returns null
// (falls back to the literal branch URL -- exactly today's behavior)
// whenever resolution isn't possible: the URL isn't a branch-archive shape,
// the version string doesn't look like a git SHA at all (a custom mod's own
// hand-typed version string, say), or the GitHub lookup fails/rate-limits --
// never a hard failure that should abort the sync over one mod.
export async function resolveCommitPinnedDownloadUrl(
	downloadUrl: string,
	version: string,
): Promise<string | null> {
	if (classifyDownloadUrl(downloadUrl) !== 'branch') return null
	if (!GIT_SHA_LIKE.test(version)) return null

	const repoInfo = extractRepoInfo(downloadUrl)
	if (!repoInfo) return null
	const { owner, repo } = repoInfo

	const res = await githubGet(`/repos/${owner}/${repo}/commits/${version}`)
	if (!res || res.status === 404) return null
	const data = (await res.json()) as { sha?: string }
	if (!data.sha) return null

	return `https://codeload.github.com/${owner}/${repo}/zip/${data.sha}`
}

async function fetchSpecificTag(
	owner: string,
	repo: string,
	tagName: string,
): Promise<{ version: string; assetName: string } | null> {
	const res = await githubGet(
		`/repos/${owner}/${repo}/releases/tags/${tagName}`,
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

export async function checkCustomModVersion(
	mod: VersionCheckInput,
): Promise<VersionCheckResult | null> {
	if (!mod.repoUrl) return null
	const repoInfo = extractRepoInfo(mod.repoUrl)
	if (!repoInfo) return null
	const { owner, repo } = repoInfo
	const canonicalRepoUrl = `https://github.com/${owner}/${repo}`
	const downloadUrl = mod.latestDownloadUrl ?? ''

	let source: VersionSource
	let newVersion: string | null = null
	let newDownloadUrl: string | null = null

	if (classifyDownloadUrl(downloadUrl) === 'branch') {
		source = 'head'
		newVersion = await fetchHeadSha(owner, repo)
	} else if (
		mod.fixedReleaseTagUpdates &&
		downloadUrl.includes('/releases/download/')
	) {
		source = 'specific_tag'
		const parts = downloadUrl.split('/')
		const tagName = parts[parts.length - 2]
		const result = await fetchSpecificTag(owner, repo, tagName)
		if (!result) return null
		newVersion = result.version
		newDownloadUrl = `${canonicalRepoUrl}/releases/download/${tagName}/${result.assetName}`
	} else {
		source = 'latest_tag'
		const tag = await fetchLatestTag(owner, repo)
		if (tag) {
			newVersion = tag
			if (downloadUrl.includes('/archive/refs/tags/')) {
				newDownloadUrl = `${canonicalRepoUrl}/archive/refs/tags/${tag}.zip`
			}
		} else {
			// Zero releases -- fall back to HEAD, same as update_mod_versions.py.
			source = 'head'
			newVersion = await fetchHeadSha(owner, repo)
		}
	}

	if (!newVersion || newVersion === mod.latestVersion) return null
	return { newVersion, newDownloadUrl, source }
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
		return { latestDownloadUrl: input.url, latestVersion: null }
	}

	const repoInfo = extractRepoInfo(input.repoUrl)
	if (!repoInfo) {
		throw new AppError(
			'repoUrl must be a github.com/<owner>/<repo> URL to resolve a branch or release source',
			400,
		)
	}
	const { owner, repo } = repoInfo
	const canonicalRepoUrl = `https://github.com/${owner}/${repo}`

	if (input.sourceType === 'branch') {
		const sha = await fetchHeadSha(owner, repo, input.branch)
		if (!sha) {
			throw new AppError(
				`Couldn't find branch '${input.branch}' on ${canonicalRepoUrl} - check the branch name and try again`,
				400,
			)
		}
		return {
			latestDownloadUrl: `${canonicalRepoUrl}/archive/refs/heads/${input.branch}.zip`,
			latestVersion: sha,
		}
	}

	// 'release'
	const tag = await fetchLatestTag(owner, repo)
	if (!tag) {
		throw new AppError(`No releases found on ${canonicalRepoUrl}`, 400)
	}
	return {
		latestDownloadUrl: `${canonicalRepoUrl}/archive/refs/tags/${tag}.zip`,
		latestVersion: tag,
	}
}
