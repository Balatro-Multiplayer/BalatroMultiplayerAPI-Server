import { and, asc, eq, notInArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
	modProfileEntries,
	modProfiles,
	modRegistry,
	modRegistryVersions,
} from '../db/schema.js'

// --- Public catalog reads (GET /api/mods, GET /api/mods/:id) ---

export async function listPublicMods() {
	const rows = await db
		.select({
			id: modRegistry.id,
			name: modRegistry.title,
			allowedInRanked: modRegistry.allowedInRanked,
			rankedVersion: modRegistry.rankedVersion,
			latestVersion: modRegistry.latestVersion,
			thumbnailUrl: modRegistry.thumbnailUrl,
			isCustom: modRegistry.isCustom,
		})
		.from(modRegistry)
		.orderBy(asc(modRegistry.title))
	return rows
}

export async function getPublicModById(id: string) {
	const mod = await db.query.modRegistry.findFirst({
		where: eq(modRegistry.id, id),
	})
	if (!mod) return null

	const versions = await db
		.select()
		.from(modRegistryVersions)
		.where(eq(modRegistryVersions.modId, id))

	return { ...mod, versions }
}

// --- BETModIndex sync (features/mods/mods-sync.service.ts) ---

export interface ModIndexEntryInput {
	id: string
	title: string
	author: string
	categories: string[]
	requiresSteamodded: boolean
	requiresTalisman: boolean
	repoUrl: string | null
	thumbnailUrl: string | null
	description: string | null
	latestVersion: string | null
	latestDownloadUrl: string | null
	versions: Array<{
		version: string
		downloadUrl: string | null
		releasedAt: string | null
	}>
}

// Upserts one index entry. Deliberately never touches allowedInRanked/
// rankedVersion (admin-owned via PUT /api/webadmin/mods/:modId, see
// setRankedConfig below -- the base index carries no ranked-eligibility
// concept at all anymore) or latestSha256/mod_registry_versions.sha256 (this
// server computes those itself -- see mods-sync.service.ts's hashing pass,
// which runs after this upsert and needs the row/version to already exist).
// Omitting a field from onConflictDoUpdate's `set` (rather than writing a
// computed value back) is what makes every future sync a no-op for those
// fields -- whatever an admin last set stays exactly as they left it.
export async function upsertModFromIndex(
	entry: ModIndexEntryInput,
): Promise<void> {
	await db
		.insert(modRegistry)
		.values({
			id: entry.id,
			title: entry.title,
			author: entry.author,
			categories: entry.categories,
			requiresSteamodded: entry.requiresSteamodded,
			requiresTalisman: entry.requiresTalisman,
			repoUrl: entry.repoUrl,
			thumbnailUrl: entry.thumbnailUrl,
			description: entry.description,
			latestVersion: entry.latestVersion,
			latestDownloadUrl: entry.latestDownloadUrl,
			sourceUpdatedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: modRegistry.id,
			set: {
				title: entry.title,
				author: entry.author,
				categories: entry.categories,
				requiresSteamodded: entry.requiresSteamodded,
				requiresTalisman: entry.requiresTalisman,
				repoUrl: entry.repoUrl,
				thumbnailUrl: entry.thumbnailUrl,
				description: entry.description,
				latestVersion: entry.latestVersion,
				latestDownloadUrl: entry.latestDownloadUrl,
				sourceUpdatedAt: new Date(),
				updatedAt: new Date(),
			},
		})

	for (const v of entry.versions) {
		await db
			.insert(modRegistryVersions)
			.values({
				modId: entry.id,
				version: v.version,
				downloadUrl: v.downloadUrl,
				releasedAt: v.releasedAt ? new Date(v.releasedAt) : null,
			})
			.onConflictDoUpdate({
				target: [modRegistryVersions.modId, modRegistryVersions.version],
				set: { downloadUrl: v.downloadUrl },
			})
	}
}

// Deletes any mod_registry row whose id wasn't in the most recent sync.
// BETModIndex's build_index.py changed what "id" means for a mod (from the
// always-unique folder slug to meta.json's own declared id, or the folder's
// Modname half as a fallback) -- rows keyed by the old slug-based id will
// never be touched by upsertModFromIndex again and would otherwise linger
// forever. mod_profile_entries.mod_id cascades on delete, so a stale row
// being referenced by an admin ranked-profile is cleaned up along with it.
// isCustom rows are never pruned here -- they have no base-index counterpart
// by definition, so "not in ids" is expected and permanent for them, not
// staleness.
// Returns the number of rows removed, for the sync log line.
export async function pruneModsMissingFrom(ids: string[]): Promise<number> {
	const rows = await db
		.delete(modRegistry)
		.where(
			and(notInArray(modRegistry.id, ids), eq(modRegistry.isCustom, false)),
		)
		.returning({ id: modRegistry.id })
	return rows.length
}

// Every admin-created mod with no base-index counterpart -- used by
// mods-sync.service.ts to fold these into the same hashing pass index-synced
// mods get, since they aren't in the fetched index's data.mods[] at all.
export async function listCustomMods() {
	return db
		.select({
			id: modRegistry.id,
			latestVersion: modRegistry.latestVersion,
			latestDownloadUrl: modRegistry.latestDownloadUrl,
		})
		.from(modRegistry)
		.where(eq(modRegistry.isCustom, true))
}

// --- Server-computed hashes (mods-sync.service.ts) ---

// Null when never computed yet, or when the version's own row is missing
// (shouldn't happen post-upsertModFromIndex, but a fetch race with a
// concurrent sync is cheap to guard against anyway).
export async function getStoredHash(
	modId: string,
	version: string,
): Promise<string | null> {
	const row = await db.query.modRegistryVersions.findFirst({
		where: and(
			eq(modRegistryVersions.modId, modId),
			eq(modRegistryVersions.version, version),
		),
	})
	return row?.sha256 ?? null
}

// Stores a freshly computed hash on the version row, and mirrors it onto
// modRegistry.latestSha256 only if this is still that mod's latest version
// (a slow hash computation racing a newer sync could otherwise clobber a
// newer version's already-computed hash with an older one).
export async function storeComputedHash(
	modId: string,
	version: string,
	sha256: string,
): Promise<void> {
	await db
		.update(modRegistryVersions)
		.set({ sha256 })
		.where(
			and(
				eq(modRegistryVersions.modId, modId),
				eq(modRegistryVersions.version, version),
			),
		)
	await db
		.update(modRegistry)
		.set({ latestSha256: sha256 })
		.where(
			and(eq(modRegistry.id, modId), eq(modRegistry.latestVersion, version)),
		)
}

// --- Admin: ranked config (PUT/DELETE /api/webadmin/mods/:modId(/ranked)) ---

// At least one of the two fields is expected to be present (enforced at the
// route layer) -- both are entirely admin-owned now, so a partial update
// (e.g. only pinning a version without touching allowedInRanked) just leaves
// the other field as it already was.
export async function setRankedConfig(
	modId: string,
	input: { allowedInRanked?: boolean; rankedVersion?: string | null },
): Promise<boolean> {
	const set: Partial<typeof modRegistry.$inferInsert> = {
		updatedAt: new Date(),
	}
	if (input.allowedInRanked !== undefined)
		set.allowedInRanked = input.allowedInRanked
	if (input.rankedVersion !== undefined) set.rankedVersion = input.rankedVersion

	const [row] = await db
		.update(modRegistry)
		.set(set)
		.where(eq(modRegistry.id, modId))
		.returning()
	return row != null
}

// Clears this mod's ranked config back to the defaults (not allowed, no
// version pin) -- there's no "index value" to reset to anymore (see
// upsertModFromIndex's doc comment), so this is a hard clear, not a
// hand-back.
export async function clearRankedConfig(modId: string): Promise<boolean> {
	const [row] = await db
		.update(modRegistry)
		.set({ allowedInRanked: false, rankedVersion: null, updatedAt: new Date() })
		.where(eq(modRegistry.id, modId))
		.returning()
	return row != null
}

// --- Admin: custom mods (POST/DELETE /api/webadmin/mods) ---

export interface CustomModInput {
	id: string
	title: string
	author: string
	categories?: string[]
	requiresSteamodded?: boolean
	requiresTalisman?: boolean
	repoUrl?: string | null
	thumbnailUrl?: string | null
	description?: string | null
	latestVersion?: string | null
	latestDownloadUrl?: string | null
}

// Returns null on an id collision with an existing row (synced or custom) --
// the route layer turns that into a 409, matching modProfiles.slug's unique
// constraint precedent elsewhere in this file.
export async function createCustomMod(
	input: CustomModInput,
): Promise<typeof modRegistry.$inferSelect | null> {
	const existing = await db.query.modRegistry.findFirst({
		where: eq(modRegistry.id, input.id),
	})
	if (existing) return null

	const [row] = await db
		.insert(modRegistry)
		.values({
			id: input.id,
			title: input.title,
			author: input.author,
			categories: input.categories ?? [],
			requiresSteamodded: input.requiresSteamodded ?? true,
			requiresTalisman: input.requiresTalisman ?? false,
			repoUrl: input.repoUrl ?? null,
			thumbnailUrl: input.thumbnailUrl ?? null,
			description: input.description ?? null,
			latestVersion: input.latestVersion ?? null,
			latestDownloadUrl: input.latestDownloadUrl ?? null,
			isCustom: true,
		})
		.returning()

	if (row.latestVersion) {
		await db.insert(modRegistryVersions).values({
			modId: row.id,
			version: row.latestVersion,
			downloadUrl: row.latestDownloadUrl,
		})
	}

	return row
}

// Only deletes a row that's actually isCustom -- deleting a synced mod would
// just have it reappear on the next sync, so the route layer rejects that
// case before ever calling this (kept as a DB-level guard too, in case a
// future caller forgets that check).
export async function deleteCustomMod(modId: string): Promise<boolean> {
	const rows = await db
		.delete(modRegistry)
		.where(and(eq(modRegistry.id, modId), eq(modRegistry.isCustom, true)))
		.returning({ id: modRegistry.id })
	return rows.length > 0
}

// --- Admin: ranked mod profiles (PUT/DELETE /api/webadmin/mods/profiles/...) ---

export async function listProfiles() {
	return db.select().from(modProfiles).orderBy(asc(modProfiles.name))
}

export async function getProfileById(id: string) {
	const profile = await db.query.modProfiles.findFirst({
		where: eq(modProfiles.id, id),
	})
	if (!profile) return null
	const entries = await db
		.select()
		.from(modProfileEntries)
		.where(eq(modProfileEntries.profileId, id))
	return { ...profile, entries }
}

export async function createProfile(input: {
	name: string
	slug: string
	description: string | null
	createdBy: string | null
}) {
	const [row] = await db.insert(modProfiles).values(input).returning()
	return row
}

export async function updateProfile(
	id: string,
	input: { name: string; slug: string; description: string | null },
) {
	const [row] = await db
		.update(modProfiles)
		.set({ ...input, updatedAt: new Date() })
		.where(eq(modProfiles.id, id))
		.returning()
	return row ?? null
}

export async function deleteProfile(id: string): Promise<void> {
	await db.delete(modProfiles).where(eq(modProfiles.id, id))
}

export async function upsertProfileEntry(input: {
	profileId: string
	modId: string
	versionConstraint: string
	allowed: boolean
}) {
	const [row] = await db
		.insert(modProfileEntries)
		.values(input)
		.onConflictDoUpdate({
			target: [modProfileEntries.profileId, modProfileEntries.modId],
			set: {
				versionConstraint: input.versionConstraint,
				allowed: input.allowed,
			},
		})
		.returning()
	return row
}

export async function removeProfileEntry(
	profileId: string,
	modId: string,
): Promise<void> {
	await db
		.delete(modProfileEntries)
		.where(
			and(
				eq(modProfileEntries.profileId, profileId),
				eq(modProfileEntries.modId, modId),
			),
		)
}
