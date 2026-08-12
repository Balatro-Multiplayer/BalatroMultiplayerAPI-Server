import { and, asc, eq, isNotNull, notInArray } from 'drizzle-orm'
import { db } from '../db/index.js'
import {
	modProfileEntries,
	modProfiles,
	modRegistry,
	modRegistryVersions,
	type ModProfileVersionMode,
} from '../db/schema.js'

// --- Public catalog reads (GET /api/mods, GET /api/mods/:id) ---

export async function listPublicMods() {
	const rows = await db
		.select({
			id: modRegistry.id,
			name: modRegistry.title,
			allowedInRanked: modRegistry.allowedInRanked,
			rankedVersion: modRegistry.rankedVersion,
			featured: modRegistry.featured,
			latestVersion: modRegistry.latestVersion,
			thumbnailUrl: modRegistry.thumbnailUrl,
			isCustom: modRegistry.isCustom,
			overriddenFields: modRegistry.overriddenFields,
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

// --- Public catalog reads (GET /api/mods/profiles, GET /api/mods/profiles/:slug) ---
//
// One-shot list-with-entries, not a separate per-profile fetch for each --
// the launcher's preset picker needs every preset's full mod list up front
// to populate a dropdown, and the profile count is small (admin-authored).

export async function listPublicProfiles() {
	const profiles = await db
		.select()
		.from(modProfiles)
		.orderBy(asc(modProfiles.name))
	const entries = await db.select().from(modProfileEntries)
	return profiles.map((profile) => ({
		...profile,
		entries: entries.filter((e) => e.profileId === profile.id),
	}))
}

export async function getPublicProfileBySlug(slug: string) {
	const profile = await db.query.modProfiles.findFirst({
		where: eq(modProfiles.slug, slug),
	})
	if (!profile) return null
	const entries = await db
		.select()
		.from(modProfileEntries)
		.where(eq(modProfileEntries.profileId, profile.id))
	return { ...profile, entries }
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

// The fields a base-index entry can supply, as opposed to allowedInRanked/
// rankedVersion/featured (permanently admin-owned, see upsertModFromIndex's
// doc comment below) or id/isCustom/overriddenFields/latestSha256 (identity/
// bookkeeping/server-computed, never index-supplied at all). Shared between
// upsertModFromIndex's override check and updateModFields/
// resetModFieldOverrides below so there's one definition of "the syncable
// fields" for both directions.
export const SYNCABLE_MOD_FIELDS = [
	'title',
	'author',
	'categories',
	'requiresSteamodded',
	'requiresTalisman',
	'repoUrl',
	'thumbnailUrl',
	'description',
	'latestVersion',
	'latestDownloadUrl',
] as const
export type SyncableModField = (typeof SYNCABLE_MOD_FIELDS)[number]

// Upserts one index entry. Deliberately never touches allowedInRanked/
// rankedVersion/featured (admin-owned via PUT /api/webadmin/mods/:modId, see
// setRankedConfig/setFeatured below -- the base index carries no concept of
// any of these) or latestSha256/mod_registry_versions.sha256 (this server
// computes those itself -- see mods-sync.service.ts's hashing pass, which
// runs after this upsert and needs the row/version to already exist).
//
// Unlike those permanently-excluded fields, the ten SYNCABLE_MOD_FIELDS
// *do* come from the index and should keep tracking it -- except on a
// mod+field an admin has directly edited via PATCH /api/webadmin/mods/:modId
// (updateModFields below), which is recorded in that row's overriddenFields.
// A field named there is skipped in this upsert's `set` (same "omit from
// `set` -> sync can't touch it" mechanism as the permanently-excluded
// fields) until an admin reverts it via POST .../reset-overrides.
export async function upsertModFromIndex(
	entry: ModIndexEntryInput,
): Promise<void> {
	const existing = await db.query.modRegistry.findFirst({
		where: eq(modRegistry.id, entry.id),
		columns: { overriddenFields: true },
	})
	const overridden = new Set(existing?.overriddenFields ?? [])

	const set: Partial<typeof modRegistry.$inferInsert> = {
		sourceUpdatedAt: new Date(),
		updatedAt: new Date(),
	}
	if (!overridden.has('title')) set.title = entry.title
	if (!overridden.has('author')) set.author = entry.author
	if (!overridden.has('categories')) set.categories = entry.categories
	if (!overridden.has('requiresSteamodded'))
		set.requiresSteamodded = entry.requiresSteamodded
	if (!overridden.has('requiresTalisman'))
		set.requiresTalisman = entry.requiresTalisman
	if (!overridden.has('repoUrl')) set.repoUrl = entry.repoUrl
	if (!overridden.has('thumbnailUrl')) set.thumbnailUrl = entry.thumbnailUrl
	if (!overridden.has('description')) set.description = entry.description
	if (!overridden.has('latestVersion')) set.latestVersion = entry.latestVersion
	if (!overridden.has('latestDownloadUrl'))
		set.latestDownloadUrl = entry.latestDownloadUrl

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
		.onConflictDoUpdate({ target: modRegistry.id, set })

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

// --- Backfill (mods-sync.service.ts's recomputeAllModHashes) ---

// Every mod_registry_versions row that has a downloadUrl to hash from --
// not just the current latest version per mod (that's all the regular
// sync ever hashes). A ranked mod profile can pin an exact historical
// version too (see modProfileEntries.versionMode's doc comment), so
// a historical version's hash matters just as much as the latest one's
// once it's the one actually being verified against.
export async function listAllVersionsWithDownloadUrl(): Promise<
	Array<{ modId: string; version: string; downloadUrl: string }>
> {
	const rows = await db
		.select({
			modId: modRegistryVersions.modId,
			version: modRegistryVersions.version,
			downloadUrl: modRegistryVersions.downloadUrl,
		})
		.from(modRegistryVersions)
		.where(isNotNull(modRegistryVersions.downloadUrl))

	return rows.filter(
		(r): r is { modId: string; version: string; downloadUrl: string } => r.downloadUrl !== null,
	)
}

// Every admin-created mod with no base-index counterpart -- used by
// mods-sync.service.ts to fold these into the same hashing pass index-synced
// mods get, since they aren't in the fetched index's data.mods[] at all, and
// to run custom-mod-version-check.service.ts against any that opted into
// automaticVersionCheck.
export async function listCustomMods() {
	return db
		.select({
			id: modRegistry.id,
			repoUrl: modRegistry.repoUrl,
			latestVersion: modRegistry.latestVersion,
			latestDownloadUrl: modRegistry.latestDownloadUrl,
			automaticVersionCheck: modRegistry.automaticVersionCheck,
			fixedReleaseTagUpdates: modRegistry.fixedReleaseTagUpdates,
		})
		.from(modRegistry)
		.where(eq(modRegistry.isCustom, true))
}

// Writes back a version custom-mod-version-check.service.ts just detected
// for a custom mod, and inserts the corresponding mod_registry_versions row
// so the existing hashing pass (hashAll in mods-sync.service.ts) picks it up
// exactly like any newly-synced version -- this never computes or touches
// sha256 itself. downloadUrl null means "leave latestDownloadUrl as it is"
// (the checker's HEAD/most-LATEST_TAG case, where the URL already points at
// a stable "latest" pointer that doesn't need rewriting).
export async function applyDetectedVersion(
	modId: string,
	input: { version: string; downloadUrl: string | null },
): Promise<void> {
	const set: Partial<typeof modRegistry.$inferInsert> = {
		latestVersion: input.version,
		sourceUpdatedAt: new Date(),
		updatedAt: new Date(),
	}
	if (input.downloadUrl) set.latestDownloadUrl = input.downloadUrl

	await db
		.update(modRegistry)
		.set(set)
		.where(and(eq(modRegistry.id, modId), eq(modRegistry.isCustom, true)))

	const mod = await db.query.modRegistry.findFirst({
		where: eq(modRegistry.id, modId),
	})
	if (!mod) return

	await db
		.insert(modRegistryVersions)
		.values({
			modId,
			version: input.version,
			downloadUrl: mod.latestDownloadUrl,
		})
		.onConflictDoUpdate({
			target: [modRegistryVersions.modId, modRegistryVersions.version],
			set: { downloadUrl: mod.latestDownloadUrl },
		})
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

// Kept separate from setRankedConfig even though both are "always
// admin-owned, never synced" toggles -- featured isn't part of ranked
// eligibility semantically, and shouldn't reset when clearRankedConfig runs.
export async function setFeatured(
	modId: string,
	featured: boolean,
): Promise<boolean> {
	const [row] = await db
		.update(modRegistry)
		.set({ featured, updatedAt: new Date() })
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
	automaticVersionCheck?: boolean
	fixedReleaseTagUpdates?: boolean
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
			automaticVersionCheck: input.automaticVersionCheck ?? false,
			fixedReleaseTagUpdates: input.fixedReleaseTagUpdates ?? false,
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

// Partial update of a custom mod's own fields -- distinct from
// setRankedConfig/clearRankedConfig above, which only ever touch ranked
// config. Scoped to isCustom rows only: a synced mod's fields come from the
// index and would just be overwritten on the next sync anyway. Undefined
// fields are left untouched; explicit null clears a nullable field.
export interface UpdateCustomModInput {
	title?: string
	author?: string
	categories?: string[]
	requiresSteamodded?: boolean
	requiresTalisman?: boolean
	repoUrl?: string | null
	thumbnailUrl?: string | null
	description?: string | null
	latestVersion?: string | null
	latestDownloadUrl?: string | null
	automaticVersionCheck?: boolean
	fixedReleaseTagUpdates?: boolean
}

export async function updateCustomMod(
	modId: string,
	input: UpdateCustomModInput,
): Promise<typeof modRegistry.$inferSelect | null> {
	const [row] = await db
		.update(modRegistry)
		.set({ ...input, updatedAt: new Date() })
		.where(and(eq(modRegistry.id, modId), eq(modRegistry.isCustom, true)))
		.returning()
	return row ?? null
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

// --- Admin: field edits + overrides (PATCH/POST /api/webadmin/mods/:modId(/reset-overrides)) ---

export type ModFieldsInput = Partial<Omit<CustomModInput, 'id'>>

// Edits any of the SYNCABLE_MOD_FIELDS on any mod, custom or index-synced.
// On a custom mod this is a plain field write (sync never looks at isCustom
// rows in the first place, so there's nothing to protect a field from). On
// an index-synced mod, every field actually present in `input` is folded
// into overriddenFields too -- see upsertModFromIndex's doc comment -- so
// the next sync leaves whatever was just set here alone, even once the
// upstream value for that field changes.
// Returns null if the mod doesn't exist (route turns that into a 404).
export async function updateModFields(
	modId: string,
	input: ModFieldsInput,
): Promise<typeof modRegistry.$inferSelect | null> {
	const existing = await db.query.modRegistry.findFirst({
		where: eq(modRegistry.id, modId),
	})
	if (!existing) return null

	const set: Partial<typeof modRegistry.$inferInsert> = { updatedAt: new Date() }
	const edited: SyncableModField[] = []
	function touch<K extends SyncableModField>(
		key: K,
		value: (typeof modRegistry.$inferInsert)[K] | undefined,
	) {
		if (value === undefined) return
		set[key] = value
		edited.push(key)
	}
	touch('title', input.title)
	touch('author', input.author)
	touch('categories', input.categories)
	touch('requiresSteamodded', input.requiresSteamodded)
	touch('requiresTalisman', input.requiresTalisman)
	touch('repoUrl', input.repoUrl)
	touch('thumbnailUrl', input.thumbnailUrl)
	touch('description', input.description)
	touch('latestVersion', input.latestVersion)
	touch('latestDownloadUrl', input.latestDownloadUrl)

	if (!existing.isCustom && edited.length > 0) {
		set.overriddenFields = [
			...new Set([...existing.overriddenFields, ...edited]),
		]
	}

	const [row] = await db
		.update(modRegistry)
		.set(set)
		.where(eq(modRegistry.id, modId))
		.returning()
	return row ?? null
}

// Removes the given field names (or all of them, if omitted) from a mod's
// overriddenFields -- the *next* sync then restores the upstream value for
// those fields (this itself doesn't fetch or write a value, just un-pins
// it). A no-op on a custom mod (no upstream counterpart to fall back to),
// but still a valid call -- it just clears bookkeeping that was never
// consulted anyway.
// Returns false if the mod doesn't exist.
export async function resetModFieldOverrides(
	modId: string,
	fields?: string[],
): Promise<boolean> {
	const existing = await db.query.modRegistry.findFirst({
		where: eq(modRegistry.id, modId),
		columns: { overriddenFields: true },
	})
	if (!existing) return false

	const remaining = fields
		? existing.overriddenFields.filter((f) => !fields.includes(f))
		: []

	await db
		.update(modRegistry)
		.set({ overriddenFields: remaining, updatedAt: new Date() })
		.where(eq(modRegistry.id, modId))
	return true
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
	versionMode: ModProfileVersionMode
	pinnedVersion: string | null
	allowed: boolean
}) {
	const [row] = await db
		.insert(modProfileEntries)
		.values(input)
		.onConflictDoUpdate({
			target: [modProfileEntries.profileId, modProfileEntries.modId],
			set: {
				versionMode: input.versionMode,
				pinnedVersion: input.pinnedVersion,
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
