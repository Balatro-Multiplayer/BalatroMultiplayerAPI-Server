import AdmZip from 'adm-zip'
import type { ModIndexEntryInput } from '../../infrastructure/gateways/mods.gateway.js'

// A full-repo zip download (~150MB, mostly thumbnail bytes this parser never
// reads) rather than one GitHub API call per mod (~424 of them): no token,
// no api.github.com rate limit, one request -- same "plain HTTPS GET"
// philosophy this project already applies to mod archive hashing in
// mods-sync.service.ts. Hardcoded, not env-configurable: there's exactly one
// legitimate upstream, and keeping it out of env avoids the temptation to
// quietly re-point this at a fork again later.
const UPSTREAM_ZIP_URL =
	'https://github.com/skyline69/balatro-mod-index/archive/refs/heads/main.zip'
const UPSTREAM_RAW_BASE =
	'https://raw.githubusercontent.com/skyline69/balatro-mod-index/main'
const FETCH_TIMEOUT_MS = 5 * 60 * 1000
// Generous cap purely to keep a runaway/unexpected response from growing an
// unbounded in-memory buffer -- the real archive is ~150MB.
const MAX_ZIP_SIZE_BYTES = 512 * 1024 * 1024

export interface UpstreamIndexResult {
	entries: ModIndexEntryInput[]
	skipped: number
	idCollisions: number
}

// A mod folder's only files this cares about, gathered from the zip's flat
// entry list before any per-mod parsing happens.
interface SlugFiles {
	meta?: AdmZip.IZipEntry
	description?: AdmZip.IZipEntry
	hasThumbnail: boolean
}

// Fetches the whole skyline69/balatro-mod-index repo as a zip and transforms
// mods/*/meta.json into the same shape BETModIndex's build_index.py used to
// publish -- a straight TS port of that script's build_entry()/main(), kept
// in lockstep with it field-for-field (see that file for the original).
export async function fetchUpstreamModIndex(): Promise<UpstreamIndexResult> {
	const res = await fetch(UPSTREAM_ZIP_URL, {
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	})
	if (!res.ok) {
		throw new Error(`upstream mod index zip fetch failed: ${res.status}`)
	}
	const buffer = Buffer.from(await res.arrayBuffer())
	if (buffer.byteLength > MAX_ZIP_SIZE_BYTES) {
		throw new Error(
			`upstream mod index zip exceeded ${MAX_ZIP_SIZE_BYTES} bytes`,
		)
	}

	const zip = new AdmZip(buffer)
	const bySlug = new Map<string, SlugFiles>()
	// Entry paths look like "balatro-mod-index-main/mods/<slug>/<file>" --
	// the leading segment is the repo-branch wrapper folder GitHub's codeload
	// always adds, which we don't care about the exact name of.
	const modFilePattern = /^[^/]+\/mods\/([^/]+)\/([^/]+)$/
	for (const entry of zip.getEntries()) {
		if (entry.isDirectory) continue
		const match = modFilePattern.exec(entry.entryName)
		if (!match) continue
		const [, slug, fileName] = match
		let files = bySlug.get(slug)
		if (!files) {
			files = { hasThumbnail: false }
			bySlug.set(slug, files)
		}
		if (fileName === 'meta.json') files.meta = entry
		else if (fileName === 'description.md') files.description = entry
		else if (fileName === 'thumbnail.jpg') files.hasThumbnail = true
	}

	const built = new Map<string, ModIndexEntryInput>()
	let skipped = 0
	for (const slug of [...bySlug.keys()].sort()) {
		const files = bySlug.get(slug)
		if (!files?.meta) continue

		let meta: Record<string, unknown>
		try {
			meta = JSON.parse(files.meta.getData().toString('utf-8'))
		} catch (err) {
			console.warn(
				`[upstream-mod-index] skipping ${slug} -- invalid JSON in meta.json: ${err}`,
			)
			skipped++
			continue
		}

		built.set(slug, buildEntry(slug, meta, files))
	}

	// mod_registry upserts by "id" as its primary key, and neither meta.json's
	// own "id" nor its folder-derived fallback is guaranteed unique across
	// mods -- keep the first (by slug, for a stable/reproducible result) and
	// drop the rest, exactly like build_index.py's dedup pass.
	const claimedBy = new Map<string, string>()
	const entries: ModIndexEntryInput[] = []
	let idCollisions = 0
	for (const slug of [...built.keys()].sort()) {
		const entry = built.get(slug)
		if (!entry) continue
		const claimant = claimedBy.get(entry.id)
		if (claimant) {
			console.warn(
				`[upstream-mod-index] skipping ${slug} -- id '${entry.id}' already claimed by ${claimant}`,
			)
			idCollisions++
			continue
		}
		claimedBy.set(entry.id, slug)
		entries.push(entry)
	}

	return { entries, skipped, idCollisions }
}

function buildEntry(
	slug: string,
	meta: Record<string, unknown>,
	files: SlugFiles,
): ModIndexEntryInput {
	// Folders follow Author@Modname (enforced by upstream's own check-mod.yml
	// CI), so this split is safe even though meta.json's own "author" field
	// is no longer what's used below.
	const atIndex = slug.indexOf('@')
	const pathAuthor = atIndex === -1 ? slug : slug.slice(0, atIndex)
	const pathModName = atIndex === -1 ? '' : slug.slice(atIndex + 1)

	const version = asString(meta.version)
	const downloadUrl = asString(meta.downloadURL)

	return {
		// meta.json's own "id" is the mod's real Steamodded/manifest id when
		// present (rare -- most mods don't declare one), which is what matters
		// for matching what the game client actually loads. Falls back to the
		// folder's Modname half, not the full slug, as the closest available
		// approximation of that same id.
		id: asString(meta.id) || pathModName || slug,
		title: asString(meta.title) || slug,
		author: pathAuthor || asString(meta.author) || 'unknown',
		categories: Array.isArray(meta.categories)
			? (meta.categories as string[])
			: [],
		requiresSteamodded: Boolean(meta['requires-steamodded'] ?? true),
		requiresTalisman: Boolean(meta['requires-talisman'] ?? false),
		repoUrl: asString(meta.repo),
		thumbnailUrl: files.hasThumbnail
			? `${UPSTREAM_RAW_BASE}/mods/${slug}/thumbnail.jpg`
			: null,
		description: readDescription(files.description),
		latestVersion: version,
		latestDownloadUrl: downloadUrl,
		versions: version
			? [
					{
						version,
						downloadUrl,
						releasedAt: releasedAtIso(meta['last-updated']),
					},
				]
			: [],
	}
}

function asString(value: unknown): string | null {
	return typeof value === 'string' && value.length > 0 ? value : null
}

function readDescription(entry: AdmZip.IZipEntry | undefined): string | null {
	if (!entry) return null
	const text = entry.getData().toString('utf-8').trim()
	return text || null
}

function releasedAtIso(value: unknown): string | null {
	if (typeof value !== 'number') return null
	return new Date(value * 1000).toISOString()
}
