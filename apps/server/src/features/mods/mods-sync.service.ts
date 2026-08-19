import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { env } from '../../env.js'
import {
	applyDetectedVersion,
	getStoredHash,
	listAllVersionsWithDownloadUrl,
	listCustomMods,
	pruneModsMissingFrom,
	storeComputedHash,
	upsertModFromIndex,
} from '../../infrastructure/gateways/mods.gateway.js'
import { checkCustomModVersion } from './custom-mod-version-check.service.js'
import { relocateModRoot } from './mod-archive-flatten.js'
import { resolveReliableDownloadUrl } from './mod-source-classifier.js'
import { computeModFolderHash } from './mod-folder-hash.js'
import { fetchUpstreamModIndex } from './upstream-mod-index.service.js'

export interface ModRegistrySyncSummary {
	modsSynced: number
	hashed: number
	pruned: number
	skipped: number
	idCollisions: number
	versionsChecked: number
}

const HASH_FETCH_TIMEOUT_MS = 30_000
// Hashing runs on every mod now (not just ranked-allowed ones), so this is
// run with bounded concurrency rather than one-at-a-time -- otherwise a
// full cold run over ~800 upstream mods would take a very long time, and
// this pass blocks server startup (see main.ts: the server doesn't start
// accepting connections until the first sync completes).
const HASH_CONCURRENCY = 8

// tmpRoot's own random suffix already guarantees uniqueness between
// concurrent hashAll() workers (including two different mods that happen to
// share a version string) -- extractedDir just needs *a* name, since unlike
// the old modzip-based scheme, the folder's own name never enters the hash
// itself (computeModFolderHash() hashes paths relative to it -- see that
// module's own comment). Kept version-derived anyway purely for
// readability if this temp dir is ever inspected mid-run.
function extractedFolderName(version: string): string {
	const sanitized = version.replace(/[@/\\]/g, '_')
	return `${sanitized || '_default'}_extracted`
}

// Reproduces exactly what the launcher's ModInstaller deploys into a
// player's Mods folder: downloads the raw release archive, extracts it,
// flattens/relocates its real mod-root folder (see mod-archive-flatten.ts,
// a port of relocateModRoot()), then hashes that flattened folder's content
// directly (computeModFolderHash() -- a port of the launcher's own
// ModFileHash::hashDirectory()). Hashes *that*, not the raw download,
// because the raw download is never what actually lands in a player's Mods
// folder, or what RunController::currentModMatchesServerHash() verifies
// against -- mods now deploy as real extracted folders, not zips (NFS.mount()
// zip-mounting didn't work correctly for every mod), so there's no archive
// step left to reproduce at all past the flatten. Best-effort like the old
// raw-archive hasher: a slow/dead download URL or an unreadable archive
// logs and returns null rather than failing the whole sync over one mod.
async function computeModFolderHashForRelease(
	modId: string,
	version: string,
	downloadUrl: string,
): Promise<string | null> {
	let tmpRoot: string | null = null
	try {
		// Branch/tag archives are fetched from our own reconstructed
		// codeload.github.com URL rather than the literal stored one -- see
		// mod-source-classifier.ts's header comment for why the literal
		// github.com/.../archive/... URL isn't safe to hash from directly.
		const reliableUrl = resolveReliableDownloadUrl(downloadUrl)
		const res = await fetch(reliableUrl, {
			signal: AbortSignal.timeout(HASH_FETCH_TIMEOUT_MS),
		})
		if (!res.ok) {
			console.error(
				`[mods-sync] Hash fetch failed (${res.status}) for ${reliableUrl}`,
			)
			return null
		}
		const rawBytes = Buffer.from(await res.arrayBuffer())

		tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'bmp-mod-hash-'))
		const extractedDir = path.join(tmpRoot, extractedFolderName(version))
		await fs.mkdir(extractedDir, { recursive: true })

		new AdmZip(rawBytes).extractAllTo(extractedDir, true)
		await relocateModRoot(extractedDir)

		return await computeModFolderHash(extractedDir)
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
async function runHashPool(
	candidates: HashCandidate[],
	skipExisting: boolean,
): Promise<HashRunResult> {
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

			const hash = await computeModFolderHashForRelease(modId, version, downloadUrl)
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
// sync cycle: every hash stored before the folder-hash rewrite was computed
// over an archive (first the raw GitHub download, later a rebuilt
// deterministic zip -- see git history), never a plain directory's content,
// which is never what RunController::currentModMatchesServerHash()
// (new-launcher) actually verifies against now (see
// computeModFolderHashForRelease's doc comment) -- those stored values are
// simply wrong under the corrected algorithm, not just stale. This
// recomputes every mod_registry_versions row that has a
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
//
// modIds optionally scopes this to specific mods instead of the whole
// registry -- the full run's own worker pool (HASH_CONCURRENCY-wide,
// hundreds of simultaneous GitHub connections) has been observed
// triggering GitHub-side connection resets ("SocketError: other side
// closed") on a large fraction of requests, purely from that concurrency;
// a single mod known to need a refresh (e.g. hashAll()'s skipExisting
// short-circuit left a live-branch mod's hash stale against upstream
// content that moved since the last successful hash) retries far more
// reliably alone.
export async function recomputeAllModHashes(modIds?: string[]): Promise<void> {
	const allCandidates = await listAllVersionsWithDownloadUrl()
	const candidates = modIds
		? allCandidates.filter((c) => modIds.includes(c.modId))
		: allCandidates
	console.log(
		`[mods-sync] Recomputing hashes for ${candidates.length} mod version(s)...`,
	)

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

// Pulls skyline69/balatro-mod-index directly (see upstream-mod-index.service.ts
// -- a whole-repo zip download, no GitHub API/token needed) and upserts it
// into mod_registry/mod_registry_versions.
//
// Ranked eligibility (a pinned ranked version, or null for none) is
// entirely admin-owned in this server's own DB now (see mods.gateway.ts's
// setRankedVersion/upsertModFromIndex doc comments) -- the index never
// carries it, so this sync doesn't touch it at all.
//
// After every mod is upserted, prunes any mod_registry row whose id wasn't
// in this sync (see pruneModsMissingFrom's doc comment -- isCustom rows are
// exempt) and hashes each remaining mod's flattened, extracted content --
// every mod, not just ranked-allowed ones (the launcher needs a verifiable
// hash to auto-install any mod, not only ranked-eligible ones), including
// admin-created custom mods (listCustomMods() below), which aren't in the
// fetched index at all -- that doesn't already have a stored hash for that
// exact version. Run through the same extract/flatten pipeline the launcher
// itself applies before deploying a mod into the Mods folder (see
// computeModFolderHashForRelease's doc comment) -- not a hash of the raw
// download, which is never what actually gets loaded or what Ranked
// verification checks against. A mod's hash is only ever recomputed when its
// version changes.
async function runSync(): Promise<ModRegistrySyncSummary> {
	if (!env.MOD_INDEX_SYNC_ENABLED) {
		console.log(
			'[mods-sync] MOD_INDEX_SYNC_ENABLED is false -- skipping mod registry sync',
		)
		return {
			modsSynced: 0,
			hashed: 0,
			pruned: 0,
			skipped: 0,
			idCollisions: 0,
			versionsChecked: 0,
		}
	}

	const { entries, skipped, idCollisions } = await fetchUpstreamModIndex()
	if (entries.length === 0) {
		// Never legitimate for this index (it always carries hundreds of
		// entries) -- treating it the same as a fetch failure, not just
		// skipping the sync, matters because it's also what guards the prune
		// below from wiping every row in mod_registry.
		throw new Error('upstream mod index parse produced zero entries')
	}

	const hashCandidates: HashCandidate[] = []
	for (const entry of entries) {
		await upsertModFromIndex(entry)

		if (entry.latestVersion && entry.latestDownloadUrl) {
			hashCandidates.push({
				modId: entry.id,
				version: entry.latestVersion,
				downloadUrl: entry.latestDownloadUrl,
			})
		}
	}

	let versionsChecked = 0
	for (const mod of await listCustomMods()) {
		let latestVersion = mod.latestVersion
		let latestDownloadUrl = mod.latestDownloadUrl

		// Opt-in only (see custom-mod-version-check.service.ts's doc comment) --
		// a custom mod that hasn't enabled this stays exactly as an admin last
		// set it, same as before this feature existed.
		if (mod.automaticVersionCheck) {
			const detected = await checkCustomModVersion({
				repoUrl: mod.repoUrl,
				latestVersion: mod.latestVersion,
				latestDownloadUrl: mod.latestDownloadUrl,
				fixedReleaseTagUpdates: mod.fixedReleaseTagUpdates,
			})
			if (detected) {
				await applyDetectedVersion(mod.id, {
					version: detected.newVersion,
					downloadUrl: detected.newDownloadUrl,
				})
				latestVersion = detected.newVersion
				latestDownloadUrl = detected.newDownloadUrl ?? mod.latestDownloadUrl
				versionsChecked++
			}
		}

		if (latestVersion && latestDownloadUrl) {
			hashCandidates.push({
				modId: mod.id,
				version: latestVersion,
				downloadUrl: latestDownloadUrl,
			})
		}
	}

	const pruned = await pruneModsMissingFrom(entries.map((entry) => entry.id))

	const hashed = await hashAll(hashCandidates)

	console.log(
		`[mods-sync] Synced ${entries.length} mods from upstream${hashed ? ` (${hashed} newly hashed)` : ''}${pruned ? ` (${pruned} stale mods pruned)` : ''}${skipped ? ` (${skipped} skipped)` : ''}${idCollisions ? ` (${idCollisions} id collisions)` : ''}${versionsChecked ? ` (${versionsChecked} custom mod versions updated)` : ''}`,
	)

	return {
		modsSynced: entries.length,
		hashed,
		pruned,
		skipped,
		idCollisions,
		versionsChecked,
	}
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
