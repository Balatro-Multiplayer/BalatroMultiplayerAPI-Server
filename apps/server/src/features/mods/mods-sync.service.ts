import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import AdmZip from 'adm-zip'
import { env } from '../../env.js'
import type { ModIndexEntryInput } from '../../infrastructure/gateways/mods.gateway.js'
import {
	getStoredHash,
	pruneModsMissingFrom,
	storeComputedHash,
	upsertModFromIndex,
} from '../../infrastructure/gateways/mods.gateway.js'
import { relocateModRoot } from './mod-archive-flatten.js'

const execFileAsync = promisify(execFile)

interface ModIndexFile {
	generatedAt?: string
	mods: ModIndexEntryInput[]
}

const HASH_FETCH_TIMEOUT_MS = 30_000
// Hashing runs on every mod now (not just ranked-allowed ones), so this is
// run with bounded concurrency rather than one-at-a-time -- otherwise a
// full cold run over ~800 upstream mods would take a very long time, and
// this pass blocks server startup (see main.ts: the server doesn't start
// accepting connections until the first sync completes).
const HASH_CONCURRENCY = 8
// Generous cap on the rebuilt zip's size -- real mods are Lua source plus
// small assets, nowhere near this; it only exists to keep a malformed or
// unexpectedly huge archive from growing an unbounded in-memory buffer.
const MAX_ZIP_SIZE_BYTES = 512 * 1024 * 1024

// Mirrors the launcher's ModDownloadCache::sanitize() + the versionPart
// half of cachedExtractedPath() exactly (see moddownloadcache.cpp): the
// rebuilt archive's single top-level folder is named after *this*, not the
// mod's id or title, and that name is part of what modzip hashes (see
// modzip.c's basename_of()) -- it has to match byte-for-byte or the hash
// never will, even though the loader itself doesn't care what the folder's
// named.
function extractedFolderName(version: string): string {
	const sanitized = version.replace(/[@/\\]/g, '_')
	return `${sanitized || '_default'}_extracted`
}

// Rebuilds the archive exactly the way the launcher's ModInstaller does
// before deploying it into a user's Mods folder: downloads the raw release
// archive, extracts it, flattens/relocates its real mod-root folder (see
// mod-archive-flatten.ts, a port of relocateModRoot()), then rezips
// deterministically via modzip (a thin libzip wrapper matching the
// launcher's own ZipWriter::zipDirectory() byte-for-byte -- see
// native/modzip/modzip.c). Hashes *that* archive, not the raw download,
// because the raw download is never what actually lands in a player's Mods
// folder, or what RunController::currentZipMatchesServerHash() verifies
// against. Best-effort like the old raw-archive hasher: a slow/dead
// download URL, an unreadable archive, or a missing modzip binary (e.g.
// local dev outside Docker, where it isn't compiled -- see Dockerfile)
// logs and returns null rather than failing the whole sync over one mod.
async function computePreparedZipHash(
	modId: string,
	version: string,
	downloadUrl: string,
): Promise<string | null> {
	let tmpRoot: string | null = null
	try {
		const res = await fetch(downloadUrl, {
			signal: AbortSignal.timeout(HASH_FETCH_TIMEOUT_MS),
		})
		if (!res.ok) {
			console.error(`[mods-sync] Hash fetch failed (${res.status}) for ${downloadUrl}`)
			return null
		}
		const rawBytes = Buffer.from(await res.arrayBuffer())

		// tmpRoot itself is a random-suffixed unique directory (avoids
		// collisions between concurrent hashAll() workers, including two
		// different mods that happen to share a version string) --
		// extractedDir nested inside it is the name that actually matters,
		// since modzip uses *its* basename as the archive's top-level
		// wrapper folder.
		tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bmp-mod-hash-'))
		const extractedDir = path.join(tmpRoot, extractedFolderName(version))
		await fs.mkdir(extractedDir, { recursive: true })

		new AdmZip(rawBytes).extractAllTo(extractedDir, true)
		await relocateModRoot(extractedDir)

		const { stdout } = await execFileAsync('modzip', [extractedDir], {
			encoding: 'buffer',
			maxBuffer: MAX_ZIP_SIZE_BYTES,
		})

		return createHash('sha256').update(stdout).digest('hex')
	} catch (err) {
		console.error(`[mods-sync] Failed to hash ${modId}@${version}:`, err)
		return null
	} finally {
		if (tmpRoot) {
			await fs.rm(tmpRoot, { recursive: true, force: true })
		}
	}
}

interface HashCandidate {
	modId: string
	version: string
	downloadUrl: string
}

// Bounded-concurrency worker pool: HASH_CONCURRENCY fetches in flight at
// once, not one giant Promise.all (hundreds of simultaneous connections to
// arbitrary third-party hosts would be its own kind of abuse) and not a
// plain sequential loop (would take far too long over hundreds of mods).
async function hashAll(candidates: HashCandidate[]): Promise<number> {
	let hashed = 0
	let next = 0

	async function worker(): Promise<void> {
		while (true) {
			const i = next++
			if (i >= candidates.length) return
			const { modId, version, downloadUrl } = candidates[i]

			const existingHash = await getStoredHash(modId, version)
			if (existingHash) continue

			const hash = await computePreparedZipHash(modId, version, downloadUrl)
			if (hash) {
				await storeComputedHash(modId, version, hash)
				hashed++
			}
		}
	}

	await Promise.all(Array.from({ length: HASH_CONCURRENCY }, () => worker()))
	return hashed
}

// Pulls BETModIndex's build-index.yml output -- a single combined JSON file
// merging upstream skyline69/balatro-mod-index with our bet-overrides/ overlay
// (see that repo's README) -- and upserts it into
// mod_registry/mod_registry_versions. A plain HTTPS GET against the published
// dist artifact, not the GitHub API: avoids needing a token or worrying about
// API rate limits.
//
// Runs once, blocking, at server startup (see main.ts) so the mod catalog
// and every mod's hash are already correct before the server accepts its
// first request -- then again on an hourly interval in the background.
// `allowedInRanked` for any mod without a bet-overrides entry always
// resolves to false (see build_index.py / upsertModFromIndex's doc
// comments) -- this sync never has to special-case "no override" itself,
// the index it's fetching already encodes that default-deny.
//
// After every mod is upserted, prunes any mod_registry row whose id wasn't
// in this sync (see pruneModsMissingFrom's doc comment) and hashes each
// remaining mod's prepared archive (all of them now, not just
// ranked-allowed ones -- the launcher needs a verifiable hash to
// auto-install any mod, not only ranked-eligible ones) that doesn't already
// have a stored hash for that exact version. "Prepared" means run through
// the same extract/flatten/rezip pipeline the launcher itself applies
// before deploying a mod into the Mods folder (see
// computePreparedZipHash's doc comment) -- not a hash of the raw download,
// which is never what actually gets loaded or what Ranked verification
// checks against. A mod's hash is only ever recomputed when its version
// changes.
export async function syncModRegistry(): Promise<void> {
	if (!env.BET_MOD_INDEX_URL) {
		console.log(
			'[mods-sync] BET_MOD_INDEX_URL not set -- skipping mod registry sync',
		)
		return
	}

	const res = await fetch(env.BET_MOD_INDEX_URL)
	if (!res.ok) {
		throw new Error(`BETModIndex fetch failed: ${res.status}`)
	}
	const data = (await res.json()) as ModIndexFile
	if (!Array.isArray(data.mods) || data.mods.length === 0) {
		// An empty mods[] is never legitimate for this index (it always carries
		// hundreds of entries) -- treating it the same as a missing array, not
		// just skipping the sync, matters because it's also what guards the
		// prune below from wiping every row in mod_registry.
		throw new Error('BETModIndex response missing a non-empty mods[] array')
	}

	const hashCandidates: HashCandidate[] = []
	for (const entry of data.mods) {
		await upsertModFromIndex(entry)

		if (entry.latestVersion && entry.latestDownloadUrl) {
			hashCandidates.push({
				modId: entry.id,
				version: entry.latestVersion,
				downloadUrl: entry.latestDownloadUrl,
			})
		}
	}

	const pruned = await pruneModsMissingFrom(data.mods.map((entry) => entry.id))

	const hashed = await hashAll(hashCandidates)

	console.log(
		`[mods-sync] Synced ${data.mods.length} mods from BETModIndex${hashed ? ` (${hashed} newly hashed)` : ''}${pruned ? ` (${pruned} stale mods pruned)` : ''}`,
	)
}
