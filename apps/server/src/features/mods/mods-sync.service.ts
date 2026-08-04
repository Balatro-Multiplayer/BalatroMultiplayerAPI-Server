import { env } from '../../env.js'
import type { ModIndexEntryInput } from '../../infrastructure/gateways/mods.gateway.js'
import { upsertModFromIndex } from '../../infrastructure/gateways/mods.gateway.js'

interface ModIndexFile {
	generatedAt?: string
	mods: ModIndexEntryInput[]
}

// Pulls BETModIndex's build-index.yml output -- a single combined JSON file
// merging upstream skyline69/balatro-mod-index with our bet-overrides/ overlay
// (see that repo's README) -- and upserts it into
// mod_registry/mod_registry_versions. A plain HTTPS GET against the published
// dist artifact, not the GitHub API: avoids needing a token or worrying about
// API rate limits for something that only needs to run hourly (see main.ts).
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

	for (const entry of data.mods) {
		await upsertModFromIndex(entry)
	}

	console.log(`[mods-sync] Synced ${data.mods.length} mods from BETModIndex`)
}
