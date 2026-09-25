import { env } from '../../env.js'
import {
	pruneModsMissingFrom,
	upsertModFromIndex,
} from '../../infrastructure/gateways/mods.gateway.js'
import { fetchThunderstoreModIndex } from './thunderstore-mod-index.service.js'

export interface ModRegistrySyncSummary {
	modsSynced: number
	pruned: number
	skipped: number
}

// Pulls thunderstore.io/c/balatro directly (see thunderstore-mod-index.service.ts
// -- a single unauthenticated GET, no token needed) and upserts it into
// mod_registry, then prunes any row that wasn't in this run. Ranked
// eligibility (a pinned rankedVersion + rankedVersionSha256, or null for
// none) is entirely admin-owned in this server's own DB (see
// mods.gateway.ts's setRankedVersion doc comment) -- this sync never touches
// it, and never hashes anything itself -- hashing only ever happens on
// demand, when an admin pins a rankedVersion.
async function runSync(): Promise<ModRegistrySyncSummary> {
	if (!env.MOD_INDEX_SYNC_ENABLED) {
		console.log(
			'[mods-sync] MOD_INDEX_SYNC_ENABLED is false -- skipping mod registry sync',
		)
		return { modsSynced: 0, pruned: 0, skipped: 0 }
	}

	const { entries, skipped } = await fetchThunderstoreModIndex()

	for (const entry of entries) {
		await upsertModFromIndex(entry)
	}

	const pruned = await pruneModsMissingFrom(entries.map((e) => e.id))

	console.log(
		`[mods-sync] Synced ${entries.length} mods from thunderstore${pruned ? ` (${pruned} stale mods pruned)` : ''}${skipped ? ` (${skipped} skipped)` : ''}`,
	)

	return { modsSynced: entries.length, pruned, skipped }
}

// Runs once, blocking, at server startup (see main.ts) so the mod catalog is
// already correct before the server accepts its first request -- then again
// on an hourly interval in the background, and on demand from the admin
// "Sync now" button (POST /api/webadmin/mods/sync). Those three callers can
// easily overlap in time (an admin clicking the button right as the hourly
// interval fires, or clicking it twice), so a second call while one is
// already running just awaits the in-flight run's result instead of kicking
// off a redundant concurrent pass.
let inFlight: Promise<ModRegistrySyncSummary> | null = null

export function syncModRegistry(): Promise<ModRegistrySyncSummary> {
	if (!inFlight) {
		inFlight = runSync().finally(() => {
			inFlight = null
		})
	}
	return inFlight
}
