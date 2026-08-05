import { createHash } from 'node:crypto'
import { env } from '../../env.js'
import type { ModIndexEntryInput } from '../../infrastructure/gateways/mods.gateway.js'
import {
	getStoredHash,
	pruneModsMissingFrom,
	storeComputedHash,
	upsertModFromIndex,
} from '../../infrastructure/gateways/mods.gateway.js'

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

// Fetches a mod's download archive and hashes it -- BETModIndex deliberately
// carries no hash at all (see that repo's bet-overrides/README.md): a
// server-computed hash can't drift from what's actually being served, the
// way a hand-curated one could once a mod updates. Best-effort: a slow/dead
// download URL logs and returns null rather than failing the whole sync over
// one mod.
async function computeSha256(url: string): Promise<string | null> {
	try {
		const res = await fetch(url, {
			signal: AbortSignal.timeout(HASH_FETCH_TIMEOUT_MS),
		})
		if (!res.ok) {
			console.error(`[mods-sync] Hash fetch failed (${res.status}) for ${url}`)
			return null
		}
		const bytes = Buffer.from(await res.arrayBuffer())
		return createHash('sha256').update(bytes).digest('hex')
	} catch (err) {
		console.error(`[mods-sync] Failed to hash ${url}:`, err)
		return null
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

			const hash = await computeSha256(downloadUrl)
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
// remaining mod's latest download archive (all of them now, not just
// ranked-allowed ones -- the launcher needs a verifiable hash to
// auto-install any mod, not only ranked-eligible ones) that doesn't already
// have a stored hash for that exact version. A mod's hash is only ever
// recomputed when its version changes.
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
