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
	listAllVersionsWithDownloadUrl,
	listCustomMods,
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

export interface ModRegistrySyncSummary {
	modsSynced: number
	hashed: number
	pruned: number
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
			console.error(
				`[mods-sync] Hash fetch failed (${res.status}) for ${downloadUrl}`,
			)
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

interface HashRunResult {
	hashed: number
	failed: Array<{ modId: string; version: string }>
}

// Bounded-concurrency worker pool: HASH_CONCURRENCY fetches in flight at
// once, not one giant Promise.all (hundreds of simultaneous connections to
// arbitrary third-party hosts would be its own kind of abuse) and not a
// plain sequential loop (would take far too long over hundreds of mods).
// Shared by both callers below -- they differ only in whether an existing
// stored hash is left alone (skipExisting=true, hashAll()'s regular sync
// behavior) or unconditionally recomputed and overwritten
// (skipExisting=false, recomputeAllModHashes()'s one-off backfill).
async function runHashPool(candidates: HashCandidate[], skipExisting: boolean): Promise<HashRunResult> {
	let next = 0
	let hashed = 0
	const failed: Array<{ modId: string; version: string }> = []

	async function worker(): Promise<void> {
		while (true) {
			const i = next++
			if (i >= candidates.length) return
			const { modId, version, downloadUrl } = candidates[i]

			if (skipExisting) {
				const existingHash = await getStoredHash(modId, version)
				if (existingHash) continue
			}

			const hash = await computePreparedZipHash(modId, version, downloadUrl)
			if (hash) {
				await storeComputedHash(modId, version, hash)
				hashed++
			} else {
				failed.push({ modId, version })
			}
		}
	}

	await Promise.all(Array.from({ length: HASH_CONCURRENCY }, () => worker()))
	return { hashed, failed }
}

async function hashAll(candidates: HashCandidate[]): Promise<number> {
	const { hashed } = await runHashPool(candidates, true)
	return hashed
}

// One-off maintenance operation, not part of the regular hourly/startup
// sync cycle: every hash stored before the prepared-zip-hash rewrite was
// computed over the raw GitHub download, which is never what
// RunController::currentZipMatchesServerHash() (new-launcher) actually
// verifies against (see computePreparedZipHash's doc comment) -- those
// stored values are simply wrong under the corrected algorithm, not just
// stale. This recomputes every mod_registry_versions row that has a
// downloadUrl, unconditionally (ignores getStoredHash's short-circuit
// entirely, unlike hashAll() above) -- not just the current latest version
// per mod, since a ranked mod profile can pin an exact historical version
// too (see listAllVersionsWithDownloadUrl's doc comment).
//
// Deliberately not called from syncModRegistry() itself -- run it
// explicitly, once, via `pnpm backfill-mod-hashes` (see
// backfill-mod-hashes.ts). Re-running it is safe (idempotent: recomputing
// an already-correct hash just produces the same value again), just
// unnecessary after the first run -- new versions from then on get hashed
// correctly the first time by the regular sync.
export async function recomputeAllModHashes(): Promise<void> {
	const candidates = await listAllVersionsWithDownloadUrl()
	console.log(`[mods-sync] Recomputing hashes for ${candidates.length} mod version(s)...`)

	const { hashed, failed } = await runHashPool(candidates, false)

	console.log(
		`[mods-sync] Recompute complete: ${hashed}/${candidates.length} succeeded${failed.length ? `, ${failed.length} failed.` : '.'}`,
	)
	if (failed.length > 0) {
		console.log(
			`[mods-sync] Failed (see earlier [mods-sync] Failed to hash lines above for why): ${failed
				.map((f) => `${f.modId}@${f.version}`)
				.join(', ')}`,
		)
	}
}

// Pulls BETModIndex's build-index.yml output -- a pure JSON-ification of
// upstream skyline69/balatro-mod-index, no override layer of its own -- and
// upserts it into mod_registry/mod_registry_versions. A plain HTTPS GET
// against the published dist artifact, not the GitHub API: avoids needing a
// token or worrying about API rate limits.
//
// Ranked eligibility and a pinned ranked version are entirely admin-owned in
// this server's own DB now (see mods.gateway.ts's setRankedConfig/
// upsertModFromIndex doc comments) -- the index never carries either, so
// this sync doesn't touch them at all.
//
// After every mod is upserted, prunes any mod_registry row whose id wasn't
// in this sync (see pruneModsMissingFrom's doc comment -- isCustom rows are
// exempt) and hashes each remaining mod's prepared archive -- every mod, not
// just ranked-allowed ones (the launcher needs a verifiable hash to
// auto-install any mod, not only ranked-eligible ones), including
// admin-created custom mods (listCustomMods() below), which aren't in
// data.mods at all -- that doesn't already have a stored hash for that exact
// version. "Prepared" means run through the same extract/flatten/rezip
// pipeline the launcher itself applies before deploying a mod into the Mods
// folder (see computePreparedZipHash's doc comment) -- not a hash of the raw
// download, which is never what actually gets loaded or what Ranked
// verification checks against. A mod's hash is only ever recomputed when its
// version changes.
async function runSync(): Promise<ModRegistrySyncSummary> {
	if (!env.BET_MOD_INDEX_URL) {
		console.log(
			'[mods-sync] BET_MOD_INDEX_URL not set -- skipping mod registry sync',
		)
		return { modsSynced: 0, hashed: 0, pruned: 0 }
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

	for (const mod of await listCustomMods()) {
		if (mod.latestVersion && mod.latestDownloadUrl) {
			hashCandidates.push({
				modId: mod.id,
				version: mod.latestVersion,
				downloadUrl: mod.latestDownloadUrl,
			})
		}
	}

	const pruned = await pruneModsMissingFrom(data.mods.map((entry) => entry.id))

	const hashed = await hashAll(hashCandidates)

	console.log(
		`[mods-sync] Synced ${data.mods.length} mods from BETModIndex${hashed ? ` (${hashed} newly hashed)` : ''}${pruned ? ` (${pruned} stale mods pruned)` : ''}`,
	)

	return { modsSynced: data.mods.length, hashed, pruned }
}

// Runs once, blocking, at server startup (see main.ts) so the mod catalog
// and every mod's hash are already correct before the server accepts its
// first request -- then again on an hourly interval in the background, and
// on demand from the admin "Sync now" button (POST /api/webadmin/mods/sync).
// Those three callers can easily overlap in time (an admin clicking the
// button right as the hourly interval fires, or clicking it twice), so a
// second call while one is already running just awaits the in-flight run's
// result instead of kicking off a redundant concurrent pass over the same
// ~hundreds of mods.
let inFlight: Promise<ModRegistrySyncSummary> | null = null

export function syncModRegistry(): Promise<ModRegistrySyncSummary> {
	if (!inFlight) {
		inFlight = runSync().finally(() => {
			inFlight = null
		})
	}
	return inFlight
}
