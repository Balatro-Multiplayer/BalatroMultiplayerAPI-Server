import { asc, eq, notInArray } from 'drizzle-orm'
import { computeModFolderHashForRelease } from '../../features/mods/mod-version-hash.js'
import {
	type ModIndexEntryInput,
	fetchThunderstorePackageVersions,
} from '../../features/mods/thunderstore-mod-index.service.js'
import { db } from '../db/index.js'
import { modRegistry } from '../db/schema.js'

export type { ModIndexEntryInput }

// --- Public catalog reads (GET /api/mods, GET /api/mods/:id) ---
// Also read by the admin router (features/webadmin/mods.route.ts) verbatim --
// there's no hidden/featured concept left to gate on, so the admin and
// public views are the same data now.

export async function listPublicMods() {
	return db
		.select({
			id: modRegistry.id,
			title: modRegistry.title,
			author: modRegistry.author,
			rankedVersion: modRegistry.rankedVersion,
			rankedVersionSha256: modRegistry.rankedVersionSha256,
		})
		.from(modRegistry)
		.orderBy(asc(modRegistry.title))
}

export async function getPublicModById(id: string) {
	const mod = await db.query.modRegistry.findFirst({
		where: eq(modRegistry.id, id),
	})
	return mod ?? null
}

// --- Thunderstore sync (features/mods/mods-sync.service.ts) ---

// Upserts one Thunderstore-sourced entry. Deliberately never touches
// rankedVersion/rankedVersionSha256 -- those are entirely admin-owned (see
// setRankedVersion below), Thunderstore carries no ranked-eligibility
// concept at all.
export async function upsertModFromIndex(
	entry: ModIndexEntryInput,
): Promise<void> {
	await db
		.insert(modRegistry)
		.values({ id: entry.id, title: entry.title, author: entry.author })
		.onConflictDoUpdate({
			target: modRegistry.id,
			set: { title: entry.title, author: entry.author, updatedAt: new Date() },
		})
}

// Deletes any mod_registry row whose id wasn't in the most recent sync.
// Returns the number of rows removed, for the sync log line.
export async function pruneModsMissingFrom(ids: string[]): Promise<number> {
	const rows = await db
		.delete(modRegistry)
		.where(notInArray(modRegistry.id, ids))
		.returning({ id: modRegistry.id })
	return rows.length
}

// --- Admin: ranked version (PUT /api/webadmin/mods/:modId) ---

export type SetRankedVersionResult =
	| { ok: true }
	| { ok: false; reason: 'not-found' }
	| { ok: false; reason: 'hash-failed' }

// The sole ranked-eligibility write path: null un-ranks the mod (clearing
// any previously-computed hash along with it); any other value ranks it and
// pins it to exactly that version. The caller (webadmin mods.route.ts's PUT
// handler) is responsible for validating that the version actually exists
// on Thunderstore right now -- this function independently resolves that
// same version's real downloadUrl and hashes the extracted archive content
// itself before writing anything, so a hash always accompanies a pin.
export async function setRankedVersion(
	modId: string,
	rankedVersion: string | null,
): Promise<SetRankedVersionResult> {
	const existing = await db.query.modRegistry.findFirst({
		where: eq(modRegistry.id, modId),
	})
	if (!existing) return { ok: false, reason: 'not-found' }

	if (rankedVersion === null) {
		await db
			.update(modRegistry)
			.set({
				rankedVersion: null,
				rankedVersionSha256: null,
				updatedAt: new Date(),
			})
			.where(eq(modRegistry.id, modId))
		return { ok: true }
	}

	const versions = await fetchThunderstorePackageVersions(modId)
	const match = versions.find((v) => v.version === rankedVersion)
	if (!match) return { ok: false, reason: 'hash-failed' }

	const hash = await computeModFolderHashForRelease(
		modId,
		rankedVersion,
		match.downloadUrl,
	)
	if (!hash) return { ok: false, reason: 'hash-failed' }

	await db
		.update(modRegistry)
		.set({ rankedVersion, rankedVersionSha256: hash, updatedAt: new Date() })
		.where(eq(modRegistry.id, modId))
	return { ok: true }
}
