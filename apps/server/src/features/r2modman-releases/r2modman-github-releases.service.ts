import { env } from '../../env.js'
import { AppError } from '../../shared/utils/errors.js'

// Proxies bmp-r2modman's electron-updater feed off the private GitHub repo's
// own Releases, the same reason launcher-releases/launcher-github-releases.service.ts
// exists for new-launcher -- electron-updater's "generic" provider expects
// exactly latest.yml/latest-mac.yml/latest-linux.yml plus the installer/
// blockmap files those reference, served from a static URL, with no way for
// end users to safely carry a token for GitHub's private-release API
// themselves. Small local copy of the githubHeaders()/GITHUB_API_BASE
// pattern rather than importing from the launcher-releases feature --
// self-contained per-feature modules is this repo's existing convention
// (see that launcher-releases file's own comment on the same choice).

const GITHUB_API_BASE = 'https://api.github.com'
const GITHUB_FETCH_TIMEOUT_MS = 15_000
const REPO_OWNER = 'Balatro-Multiplayer'
const REPO_NAME = 'bmp-r2modman'

// The three sidecar files electron-builder's per-platform jobs each write on
// their own (release.yml's linux/win/osx matrix) -- their presence is what
// this module uses to decide a release is fully uploaded, see
// resolveLatestCompleteRelease() below.
const CHANNEL_FILES = ['latest.yml', 'latest-mac.yml', 'latest-linux.yml']

function githubHeaders(): HeadersInit {
	if (!env.GITHUB_TOKEN) {
		throw new AppError(
			'GITHUB_TOKEN is not configured on this server - required to read releases from the private bmp-r2modman repo',
			500,
		)
	}
	return {
		Accept: 'application/vnd.github+json',
		Authorization: `token ${env.GITHUB_TOKEN}`,
	}
}

async function githubGet(path: string): Promise<Response> {
	try {
		return await fetch(`${GITHUB_API_BASE}${path}`, {
			headers: githubHeaders(),
			signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
		})
	} catch (err) {
		throw new AppError(`GitHub request failed: ${(err as Error).message}`, 502)
	}
}

interface GitHubReleaseAsset {
	id: number
	name: string
}

interface GitHubRelease {
	tag_name: string
	assets: GitHubReleaseAsset[]
}

export interface ResolvedRelease {
	tag: string
	assetsByName: Map<string, number> // filename -> GitHub asset id
}

let cache: ResolvedRelease | null = null
let cacheAt = 0
const CACHE_TTL_MS = 60_000

// `release: created` fires (and GitHub's /releases/latest starts returning
// the new tag) the instant a maintainer creates the release - before any of
// release.yml's three platform jobs have even started building. Serving that
// half-uploaded release would hand a client a latest.yml referencing an
// installer that isn't there yet, or 404 a platform whose job just hasn't
// finished. So "latest" here means "newest release where all three
// platforms' jobs have finished uploading", falling back to the next
// release down until that's true - not a straight /releases/latest call.
async function resolveLatestCompleteRelease(): Promise<ResolvedRelease | null> {
	const res = await githubGet(`/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=5`)
	if (!res.ok) {
		throw new AppError(`GitHub releases list request failed (${res.status})`, 502)
	}
	const releases = (await res.json()) as GitHubRelease[]

	for (const release of releases) {
		const assetsByName = new Map(release.assets.map((a) => [a.name, a.id]))
		if (CHANNEL_FILES.every((name) => assetsByName.has(name))) {
			return { tag: release.tag_name, assetsByName }
		}
	}
	return null
}

export async function getLatestRelease(): Promise<ResolvedRelease | null> {
	const now = Date.now()
	if (cache && now - cacheAt < CACHE_TTL_MS) {
		return cache
	}

	const resolved = await resolveLatestCompleteRelease()
	// Deliberately not caching a null result at the same TTL as a real one -
	// a release mid-upload should start serving as soon as it completes,
	// not wait out a full stale cache window on top of the build time it's
	// already taking.
	if (!resolved) return null

	cache = resolved
	cacheAt = now
	return resolved
}

// Resolves a release asset's actual download bytes, forwarding an optional
// client Range header (electron-updater's differential/blockmap downloads
// need partial-content support to avoid falling back to a full download
// every time). GitHub's asset-download endpoint 302-redirects to a
// time-limited signed blob URL when asked for application/octet-stream -
// this must be fetched with redirect: 'manual' to capture that Location
// header, then followed with a SECOND, unauthenticated request (forwarding
// the GitHub Authorization header to the signed URL makes the CDN reject the
// request outright) - same two-hop shape as launcher-releases' own
// resolveAssetDownloadStream. Range is only ever forwarded on that second
// hop; the first is just resolving a redirect and its own response body is
// never used.
export async function resolveAssetDownloadStream(
	githubAssetId: number,
	rangeHeader?: string,
): Promise<Response> {
	const redirectRes = await fetch(
		`${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/releases/assets/${githubAssetId}`,
		{
			headers: {
				...githubHeaders(),
				Accept: 'application/octet-stream',
			},
			redirect: 'manual',
			signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
		},
	)
	const location = redirectRes.headers.get('location')
	if (redirectRes.status !== 302 || !location) {
		throw new AppError(
			`GitHub asset download did not redirect as expected (status ${redirectRes.status})`,
			502,
		)
	}

	const assetRes = await fetch(location, {
		headers: rangeHeader ? { Range: rangeHeader } : undefined,
	})
	if (!assetRes.ok || !assetRes.body) {
		throw new AppError(
			`Fetching the redirected asset URL failed (${assetRes.status})`,
			502,
		)
	}
	return assetRes
}
