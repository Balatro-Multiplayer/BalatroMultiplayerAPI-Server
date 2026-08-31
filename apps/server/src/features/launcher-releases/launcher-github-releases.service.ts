import { env } from '../../env.js'
import type { LauncherPlatform } from '../../infrastructure/db/schema.js'
import { AppError } from '../../shared/utils/errors.js'

// Resolves launcher release metadata (and proxies asset downloads) from the
// new-launcher repo's own GitHub Releases, instead of this server hosting
// binaries itself (see schema.ts's launcherReleases doc comment for why).
// Small local copy of the same githubHeaders()/GITHUB_API_BASE pattern
// features/mods/custom-mod-version-check.service.ts already uses, rather
// than importing from there -- that module's helpers aren't exported, and
// keeping this feature self-contained matches this repo's existing
// per-feature module boundaries.

const GITHUB_API_BASE = 'https://api.github.com'
const GITHUB_FETCH_TIMEOUT_MS = 15_000
const REPO_OWNER = 'Balatro-Multiplayer'
const REPO_NAME = 'new-launcher'

// Unlike custom-mod-version-check.service.ts's best-effort "swallow errors,
// try again next cycle" pattern, every call here is triggered directly by
// an admin action -- failures should surface as a clear error in the admin
// UI, not silently no-op.
function githubHeaders(): HeadersInit {
	if (!env.GITHUB_TOKEN) {
		throw new AppError(
			'GITHUB_TOKEN is not configured on this server - required to read releases from the private new-launcher repo',
			500,
		)
	}
	return {
		Accept: 'application/vnd.github+json',
		Authorization: `token ${env.GITHUB_TOKEN}`,
	}
}

async function githubGet(path: string): Promise<Response> {
	let res: Response
	try {
		res = await fetch(`${GITHUB_API_BASE}${path}`, {
			headers: githubHeaders(),
			signal: AbortSignal.timeout(GITHUB_FETCH_TIMEOUT_MS),
		})
	} catch (err) {
		throw new AppError(`GitHub request failed: ${(err as Error).message}`, 502)
	}
	return res
}

// Version is used as a public URL path segment (GET /api/launcher/download/:version/:platform)
// -- reject anything outside a safe charset rather than trying to sanitize
// it, so the stored `version` column always matches what the download route
// expects. Moved here (unchanged) from the now-deleted
// launcher-release-storage.ts, which used it for the same reason against a
// local disk path instead.
const VERSION_RE = /^[A-Za-z0-9._-]{1,64}$/

export function assertSafeVersion(version: string): void {
	if (!VERSION_RE.test(version)) {
		throw new AppError(
			'version must be 1-64 characters of letters, digits, "." "_" "-"',
			400,
		)
	}
}

// release.yml's own tag -> BET_APP_VERSION derivation (PowerShell
// `-replace '^v', ''` / bash `sed 's/^v//'`) -- UpdateManager string-compares
// this exact value against the version baked into the running binary, so
// this MUST derive it identically or a real update would never be detected.
function versionFromTag(tag: string): string {
	return tag.startsWith('v') || tag.startsWith('V') ? tag.slice(1) : tag
}

// The exact filenames release.yml's three platform jobs produce (confirmed
// live against a real release) -- checked first since they're exact and
// unambiguous; extension matching below is just a fallback in case a
// filename ever changes without this list being updated too.
const FILENAME_PLATFORMS: Record<string, LauncherPlatform> = {
	'BET-Setup.exe': 'windows',
	'BET.dmg': 'mac',
	'BET-linux.AppImage': 'linux',
}
const EXTENSION_PLATFORMS: Record<string, LauncherPlatform> = {
	'.exe': 'windows',
	'.dmg': 'mac',
	'.appimage': 'linux',
}

function platformForAssetName(name: string): LauncherPlatform | null {
	if (FILENAME_PLATFORMS[name]) return FILENAME_PLATFORMS[name]
	const dot = name.toLowerCase().lastIndexOf('.')
	if (dot === -1) return null
	return EXTENSION_PLATFORMS[name.toLowerCase().slice(dot)] ?? null
}

interface GitHubReleaseAsset {
	id: number
	name: string
	size: number
	digest: string | null // "sha256:<hex>", null on rare old assets predating GitHub's digest field
}

interface GitHubRelease {
	tag_name: string
	name: string | null
	body: string | null
	published_at: string
	assets: GitHubReleaseAsset[]
}

export interface RecentGithubRelease {
	tag: string
	name: string | null
	publishedAt: string
	body: string | null
}

// For the admin UI's release picker.
export async function listRecentReleases(): Promise<RecentGithubRelease[]> {
	const res = await githubGet(
		`/repos/${REPO_OWNER}/${REPO_NAME}/releases?per_page=20`,
	)
	if (!res.ok) {
		throw new AppError(
			`GitHub releases list request failed (${res.status})`,
			502,
		)
	}
	const releases = (await res.json()) as GitHubRelease[]
	return releases.map((r) => ({
		tag: r.tag_name,
		name: r.name,
		publishedAt: r.published_at,
		body: r.body,
	}))
}

export interface ResolvedReleaseAsset {
	platform: LauncherPlatform
	githubAssetId: number
	originalFilename: string
	fileSize: number
	sha256: string
}

export interface ResolvedRelease {
	version: string
	notes: string | null
	assets: ResolvedReleaseAsset[]
}

// Resolves a GitHub release tag into everything the admin import route
// needs to persist - no asset bytes are fetched here, just the small
// release+assets JSON payload. Returns null on a 404 (no such tag) so the
// caller can turn that into its own clear "no such release" error.
export async function resolveReleaseByTag(
	tag: string,
): Promise<ResolvedRelease | null> {
	const res = await githubGet(
		`/repos/${REPO_OWNER}/${REPO_NAME}/releases/tags/${encodeURIComponent(tag)}`,
	)
	if (res.status === 404) return null
	if (!res.ok) {
		throw new AppError(`GitHub release lookup failed (${res.status})`, 502)
	}
	const release = (await res.json()) as GitHubRelease

	const assets: ResolvedReleaseAsset[] = []
	for (const asset of release.assets) {
		const platform = platformForAssetName(asset.name)
		if (!platform) continue // an unrelated asset (e.g. a checksums file) - not an error, just skip it
		if (!asset.digest?.startsWith('sha256:')) {
			throw new AppError(
				`GitHub asset '${asset.name}' has no sha256 digest - can't verify this download`,
				502,
			)
		}
		assets.push({
			platform,
			githubAssetId: asset.id,
			originalFilename: asset.name,
			fileSize: asset.size,
			sha256: asset.digest.slice('sha256:'.length),
		})
	}

	return {
		version: versionFromTag(release.tag_name),
		notes: release.body,
		assets,
	}
}

// Resolves a release asset's actual download bytes. GitHub's asset-download
// endpoint 302-redirects to a time-limited signed blob URL (Azure/S3-backed)
// when asked for application/octet-stream - this must be fetched with
// redirect: 'manual' to capture that Location header, then followed with a
// SECOND, unauthenticated request. Forwarding the GitHub Authorization
// header to the signed URL makes the CDN reject the request outright, so
// the two fetches deliberately use different headers.
export async function resolveAssetDownloadStream(
	githubAssetId: number,
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

	const assetRes = await fetch(location)
	if (!assetRes.ok || !assetRes.body) {
		throw new AppError(
			`Fetching the redirected asset URL failed (${assetRes.status})`,
			502,
		)
	}
	return assetRes
}
