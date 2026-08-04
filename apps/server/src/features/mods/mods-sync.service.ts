import { createHash } from 'node:crypto'
import { env } from '../../env.js'
import type { ModIndexEntryInput } from '../../infrastructure/gateways/mods.gateway.js'
import {
	getStoredHash,
	storeComputedHash,
	upsertModFromIndex,
} from '../../infrastructure/gateways/mods.gateway.js'

interface ModIndexFile {
	generatedAt?: string
	mods: ModIndexEntryInput[]
}

const HASH_FETCH_TIMEOUT_MS = 30_000

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

// Pulls BETModIndex's build-index.yml output -- a single combined JSON file
// merging upstream skyline69/balatro-mod-index with our bet-overrides/ overlay
// (see that repo's README) -- and upserts it into
// mod_registry/mod_registry_versions. A plain HTTPS GET against the published
// dist artifact, not the GitHub API: avoids needing a token or worrying about
// API rate limits for something that only needs to run hourly (see main.ts).
//
// After each upsert, hashes that mod's latest download archive IF it's
// ranked-allowed and doesn't already have a stored hash for that exact
// version -- deliberately not every mod in the index (~800 upstream mods,
// most never ranked-relevant): downloading and hashing every archive on
// every hourly run would be a lot of needless bandwidth/load for data
// nobody reads. A mod's hash is (re)computed the first time it becomes
// ranked-allowed for a version that hasn't been hashed yet, then reused
// until the version changes.
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
	if (!Array.isArray(data.mods)) {
		throw new Error('BETModIndex response missing a mods[] array')
	}

	let hashed = 0
	for (const entry of data.mods) {
		const { allowedInRanked } = await upsertModFromIndex(entry)

		if (!allowedInRanked || !entry.latestVersion || !entry.latestDownloadUrl) {
			continue
		}

		const existingHash = await getStoredHash(entry.id, entry.latestVersion)
		if (existingHash) continue

		const hash = await computeSha256(entry.latestDownloadUrl)
		if (hash) {
			await storeComputedHash(entry.id, entry.latestVersion, hash)
			hashed++
		}
	}

	console.log(
		`[mods-sync] Synced ${data.mods.length} mods from BETModIndex${hashed ? ` (${hashed} newly hashed)` : ''}`,
	)
}
