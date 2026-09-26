import { env } from '../../env.js'

// Minimal GitHub REST helpers shared by the custom-mod version check, the
// GitHub version listing and commit pinning. Authenticated with GITHUB_TOKEN
// when set (5000 req/h instead of 60).

const GITHUB_API_BASE = 'https://api.github.com'
const GITHUB_FETCH_TIMEOUT_MS = 15_000

function githubHeaders(): HeadersInit {
	const headers: Record<string, string> = {
		Accept: 'application/vnd.github+json',
	}
	if (env.GITHUB_TOKEN) headers.Authorization = `token ${env.GITHUB_TOKEN}`
	return headers
}

// Returns the response for a 2xx or 404 (callers check status), null for any
// other failure -- every caller treats GitHub as best-effort.
export async function githubGet(apiPath: string): Promise<Response | null> {
	try {
		const res = await fetch(`${GITHUB_API_BASE}${apiPath}`, {
			headers: githubHeaders(),
			signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
		})
		if (!res.ok && res.status !== 404) {
			console.warn(`[github-api] GET ${apiPath} -> ${res.status}`)
			return null
		}
		return res
	} catch (err) {
		console.warn(`[github-api] GET ${apiPath} failed:`, err)
		return null
	}
}

export interface RepoInfo {
	owner: string
	repo: string
}

export function extractRepoInfo(repoUrl: string | null): RepoInfo | null {
	if (!repoUrl) return null
	const match = /github\.com\/([^/]+)\/([^/#?]+)/.exec(repoUrl)
	if (!match) return null
	return { owner: match[1], repo: match[2].replace(/\.git$/, '') }
}

export const canonicalRepoUrl = ({ owner, repo }: RepoInfo) =>
	`https://github.com/${owner}/${repo}`

// Permanent archive URLs. codeload serves a commit or tag archive directly;
// a commit archive can never change, a tag archive only if the tag is
// re-pointed upstream (caught by the launcher's post-download hash check).
export const commitArchiveUrl = ({ owner, repo }: RepoInfo, sha: string) =>
	`https://codeload.github.com/${owner}/${repo}/zip/${sha}`
export const tagArchiveUrl = ({ owner, repo }: RepoInfo, tag: string) =>
	`https://codeload.github.com/${owner}/${repo}/zip/refs/tags/${tag}`
export const releaseAssetUrl = (info: RepoInfo, tag: string, asset: string) =>
	`${canonicalRepoUrl(info)}/releases/download/${tag}/${asset}`

export async function fetchLatestReleaseTag(
	info: RepoInfo,
): Promise<string | null> {
	const res = await githubGet(
		`/repos/${info.owner}/${info.repo}/releases/latest`,
	)
	if (!res || res.status === 404) return null
	const data = (await res.json()) as { tag_name?: string }
	return data.tag_name ?? null
}

// Full commit SHA and date for a ref (branch, tag or SHA prefix), or for the
// default branch's head when ref is omitted.
export async function fetchCommit(
	info: RepoInfo,
	ref?: string,
): Promise<{ sha: string; date: string | null } | null> {
	const apiPath = ref
		? `/repos/${info.owner}/${info.repo}/commits/${encodeURIComponent(ref)}`
		: `/repos/${info.owner}/${info.repo}/commits`
	const res = await githubGet(apiPath)
	if (!res || res.status === 404) return null
	type Commit = { sha?: string; commit?: { committer?: { date?: string } } }
	const data = (await res.json()) as Commit | Commit[]
	const commit = Array.isArray(data) ? data[0] : data
	if (!commit?.sha) return null
	return { sha: commit.sha, date: commit.commit?.committer?.date ?? null }
}
