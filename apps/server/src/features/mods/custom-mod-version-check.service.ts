import { env } from '../../env.js'

// TS port of BETModIndex's update_mod_versions.py, scoped to admin-created
// custom mods (mod_registry.isCustom rows) that opt into
// automaticVersionCheck -- upstream mods get this for free from that same
// script running on the real skyline69/balatro-mod-index repo, but a custom
// mod has no meta.json anywhere for it to have already run against.
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

async function fetchHeadSha(
	owner: string,
	repo: string,
): Promise<string | null> {
	const res = await githubGet(`/repos/${owner}/${repo}/commits`)
	if (!res || res.status === 404) return null
	const data = (await res.json()) as Array<{ sha: string }>
	if (!Array.isArray(data) || data.length === 0) return null
	return data[0].sha.slice(0, 7)
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

	if (downloadUrl.includes('/archive/refs/heads/')) {
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
