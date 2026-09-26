import {
	and,
	asc,
	eq,
	isNotNull,
	isNull,
	notInArray,
	or,
	sql,
} from 'drizzle-orm'
import { withLegacySteamoddedTags } from '../../features/mods/legacy-steamodded-tags.js'
import type {
	ExistingModRow,
	ModRowClaim,
} from '../../features/mods/mod-registry-claims.js'
import {
	classifyDownloadUrl,
	isMovingDownloadUrl,
	resolveReliableDownloadUrl,
} from '../../features/mods/mod-source-classifier.js'
import { computeModFolderHashForRelease } from '../../features/mods/mod-version-hash.js'
import {
	type ModIndexEntryInput,
	fetchThunderstorePackageVersions,
} from '../../features/mods/thunderstore-mod-index.service.js'
import { db } from '../db/index.js'
import {
	modProfileEntries,
	modProfiles,
	modRegistry,
	modRegistryVersions,
} from '../db/schema.js'

type ModRow = typeof modRegistry.$inferSelect
type ModVersionRow = typeof modRegistryVersions.$inferSelect
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// --- Public catalog reads (GET /api/mods, GET /api/mods/:id) ---
//
// Response shapes are a superset of what the GitHub-index era served, key for
// key, because the launcher (new-launcher's ModIndexManager/ModIndexEntry)
// reads them leniently and treats a missing key as empty. Fields that no
// longer exist (overriddenFields) are served as their neutral constant
// rather than dropped. See mods.test.ts for the pinned key sets.
//
// sourceType is derived from the download URL, exactly as the launcher's own
// classifier does: a Thunderstore version archive is an immutable,
// version-keyed static file, i.e. 'release'; a custom mod may also be a
// 'branch' archive or an arbitrary 'custom' URL.
function sourceTypeOf(row: ModRow) {
	return classifyDownloadUrl(row.latestDownloadUrl ?? '')
}

function toListItem(row: ModRow) {
	return {
		id: row.id,
		name: row.title,
		title: row.title,
		author: row.author,
		rankedVersion: row.rankedVersion,
		rankedVersionSha256: row.rankedVersionSha256,
		featured: row.featured,
		hidden: row.hidden,
		latestVersion: row.latestVersion,
		latestDownloadUrl: row.latestDownloadUrl,
		thumbnailUrl: row.thumbnailUrl,
		isCustom: row.isCustom,
		overriddenFields: [] as string[],
		searchTerms: row.searchTerms,
		sourceType: sourceTypeOf(row),
		thunderstoreFullName: row.thunderstoreFullName,
	}
}

// The ranked pin's hash is the only hash the server keeps, so it stands in
// for the version-level sha256 wherever that version is the pinned one --
// which is exactly the case the launcher's Ranked check reads it for.
function hashFor(row: ModRow, version: string | null): string | null {
	return version !== null && version === row.rankedVersion
		? row.rankedVersionSha256
		: null
}

function toDetail(row: ModRow, versions: ModVersionRow[]) {
	return {
		id: row.id,
		title: row.title,
		author: row.author,
		categories: row.categories,
		searchTerms: row.searchTerms,
		requiresSteamodded: row.requiresSteamodded,
		requiresTalisman: row.requiresTalisman,
		repoUrl: row.repoUrl,
		thumbnailUrl: row.thumbnailUrl,
		description: row.description,
		latestVersion: row.latestVersion,
		latestDownloadUrl: row.latestDownloadUrl,
		latestSha256: hashFor(row, row.latestVersion),
		rankedVersion: row.rankedVersion,
		rankedVersionSha256: row.rankedVersionSha256,
		featured: row.featured,
		hidden: row.hidden,
		isCustom: row.isCustom,
		automaticVersionCheck: row.automaticVersionCheck,
		fixedReleaseTagUpdates: row.fixedReleaseTagUpdates,
		overriddenFields: [] as string[],
		indexSource: row.isCustom ? ('custom' as const) : ('thunderstore' as const),
		sourceUpdatedAt: row.sourceUpdatedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		sourceType: sourceTypeOf(row),
		thunderstoreFullName: row.thunderstoreFullName,
		packageUrl: row.packageUrl,
		donationLink: row.donationLink,
		// The launcher takes versions[0] as "latest", so order newest first.
		versions: withLegacySteamoddedTags(
			row.thunderstoreFullName,
			[...versions]
				.sort(
					(a, b) =>
						(b.releasedAt?.getTime() ?? 0) - (a.releasedAt?.getTime() ?? 0),
				)
				.map((v) => ({
					id: v.id,
					modId: v.modId,
					version: v.version,
					sha256: hashFor(row, v.version),
					downloadUrl: v.downloadUrl,
					releasedAt: v.releasedAt,
					pinFailedAt: null,
					dependencies: v.dependencies,
				})),
		),
	}
}

// includeHidden is only ever passed by the admin router (features/webadmin/
// mods.route.ts), so /admin/ranked-mods can still see and un-hide a mod.
export async function listPublicMods(opts?: { includeHidden?: boolean }) {
	const rows = await db
		.select()
		.from(modRegistry)
		.where(opts?.includeHidden ? undefined : eq(modRegistry.hidden, false))
		.orderBy(asc(modRegistry.title))
	return rows.map(toListItem)
}

// Resolves a row by its public id or, failing that, its Thunderstore full
// name -- so a client that only knows the Thunderstore folder name
// ("Owner-Name") still finds a carried-over row that kept a legacy id.
export async function findModByIdOrFullName(idOrFullName: string) {
	const rows = await db
		.select()
		.from(modRegistry)
		.where(
			or(
				eq(modRegistry.id, idOrFullName),
				eq(modRegistry.thunderstoreFullName, idOrFullName),
			),
		)
	return rows.find((r) => r.id === idOrFullName) ?? rows[0] ?? null
}

export async function getPublicModById(
	idOrFullName: string,
	opts?: { includeHidden?: boolean },
) {
	const row = await findModByIdOrFullName(idOrFullName)
	if (!row) return null
	if (row.hidden && !opts?.includeHidden) return null

	const versions = await db
		.select()
		.from(modRegistryVersions)
		.where(eq(modRegistryVersions.modId, row.id))
	return toDetail(row, versions)
}

// --- Public profile reads (GET /api/mods/profiles, /api/mods/profiles/:slug) ---
//
// One-shot list-with-entries: the launcher's preset picker needs every
// preset's full mod list up front, and there are only a handful.

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

// --- Thunderstore sync (features/mods/mods-sync.service.ts) ---

export async function listModRowsForClaims(): Promise<ExistingModRow[]> {
	return db
		.select({
			id: modRegistry.id,
			thunderstoreFullName: modRegistry.thunderstoreFullName,
			repoUrl: modRegistry.repoUrl,
			isCustom: modRegistry.isCustom,
		})
		.from(modRegistry)
}

// Writes one package into the row its claim names, and replaces that row's
// version list. Never touches the admin-owned fields (ranked pin, featured,
// hidden). title is set on insert only -- see schema.ts's title comment.
export async function writeModFromIndex(
	claim: Exclude<ModRowClaim, { kind: 'skip' }>,
	entry: ModIndexEntryInput,
): Promise<void> {
	const synced = {
		thunderstoreFullName: entry.fullName,
		author: entry.author,
		categories: entry.categories,
		requiresSteamodded: entry.requiresSteamodded,
		repoUrl: entry.repoUrl,
		thumbnailUrl: entry.thumbnailUrl,
		description: entry.description,
		packageUrl: entry.packageUrl,
		donationLink: entry.donationLink,
		latestVersion: entry.latestVersion,
		latestDownloadUrl: entry.latestDownloadUrl,
		sourceUpdatedAt: entry.sourceUpdatedAt
			? new Date(entry.sourceUpdatedAt)
			: null,
		updatedAt: new Date(),
	}

	await db.transaction(async (tx) => {
		if (claim.kind === 'new') {
			await tx.insert(modRegistry).values({
				id: claim.id,
				title: entry.title,
				requiresTalisman: entry.requiresTalisman,
				...synced,
			})
		} else {
			await tx
				.update(modRegistry)
				.set({
					...synced,
					requiresTalisman: sql`${modRegistry.requiresTalisman} OR ${entry.requiresTalisman}`,
				})
				.where(eq(modRegistry.id, claim.id))
		}

		await tx
			.delete(modRegistryVersions)
			.where(eq(modRegistryVersions.modId, claim.id))
		if (entry.versions.length > 0) {
			await tx.insert(modRegistryVersions).values(
				entry.versions.map((v) => ({
					modId: claim.id,
					version: v.version,
					downloadUrl: v.downloadUrl,
					releasedAt: v.releasedAt ? new Date(v.releasedAt) : null,
					dependencies: v.dependencies,
				})),
			)
		}
	})
}

// Deletes every Thunderstore-sourced row not written by this sync: unclaimed
// carried-over rows, and packages that left Thunderstore. Custom rows are
// never touched -- they have no Thunderstore package to be missing from. Only
// ever called after a successful
// fetch. An empty list is treated as a bad response, not "every mod is gone",
// and prunes nothing. Returns the number of rows removed, for the sync log
// line.
export async function pruneModsNotIn(fullNames: string[]): Promise<number> {
	if (fullNames.length === 0) return 0
	const rows = await db
		.delete(modRegistry)
		.where(
			and(
				eq(modRegistry.isCustom, false),
				or(
					isNull(modRegistry.thunderstoreFullName),
					notInArray(modRegistry.thunderstoreFullName, fullNames),
				),
			),
		)
		.returning({ id: modRegistry.id })
	return rows.length
}

export async function listRankedPins() {
	return db
		.select({
			id: modRegistry.id,
			isCustom: modRegistry.isCustom,
			thunderstoreFullName: modRegistry.thunderstoreFullName,
			rankedVersion: modRegistry.rankedVersion,
			rankedVersionSha256: modRegistry.rankedVersionSha256,
		})
		.from(modRegistry)
		.where(isNotNull(modRegistry.rankedVersion))
}

// Both writes are conditional on the pin still being the version the caller
// looked at, so an admin re-pin that lands mid-sync is never overwritten.
export async function clearRankedPin(modId: string, expectedVersion: string) {
	await db
		.update(modRegistry)
		.set({
			rankedVersion: null,
			rankedVersionSha256: null,
			updatedAt: new Date(),
		})
		.where(
			and(
				eq(modRegistry.id, modId),
				eq(modRegistry.rankedVersion, expectedVersion),
			),
		)
}

export async function storeRankedPinHash(
	modId: string,
	version: string,
	hash: string,
) {
	await db
		.update(modRegistry)
		.set({ rankedVersionSha256: hash, updatedAt: new Date() })
		.where(
			and(eq(modRegistry.id, modId), eq(modRegistry.rankedVersion, version)),
		)
}

// --- Admin (features/webadmin/mods.route.ts) ---

export type SetRankedVersionResult =
	| { ok: true }
	| { ok: false; reason: 'not-found' }
	| { ok: false; reason: 'hash-failed' }
	// Custom mods only: the version isn't one this mod has a row for, or its
	// stored URL is a moving pointer (branch head / latest release) that no
	// longer serves that version's bytes.
	| { ok: false; reason: 'version-not-found' }
	| { ok: false; reason: 'version-not-pinnable' }

// The sole ranked-eligibility write path: null un-ranks the mod (clearing
// any previously-computed hash along with it); any other value ranks it and
// pins it to exactly that version. For a Thunderstore mod the caller
// (webadmin mods.route.ts's PUT handler) is responsible for validating that
// the version actually exists on Thunderstore right now; a custom mod's
// versions are its own stored rows, validated here. Either way this function
// independently resolves that version's real downloadUrl and hashes the
// extracted archive content itself before writing anything, so a hash always
// accompanies a pin.
export async function setRankedVersion(
	modId: string,
	rankedVersion: string | null,
): Promise<SetRankedVersionResult> {
	const existing = await findModByIdOrFullName(modId)
	if (!existing) return { ok: false, reason: 'not-found' }

	if (rankedVersion === null) {
		await db
			.update(modRegistry)
			.set({
				rankedVersion: null,
				rankedVersionSha256: null,
				updatedAt: new Date(),
			})
			.where(eq(modRegistry.id, existing.id))
		return { ok: true }
	}

	let downloadUrl: string
	if (existing.isCustom) {
		const versions = await listPinnableCustomVersions(existing)
		const match = versions.find((v) => v.version === rankedVersion)
		if (!match) {
			const known = await listVersionRows(existing.id)
			return {
				ok: false,
				reason: known.some((v) => v.version === rankedVersion)
					? 'version-not-pinnable'
					: 'version-not-found',
			}
		}
		// Branch archives are re-fetched through codeload -- see
		// resolveReliableDownloadUrl's own comment for why the literal URL
		// can hash differently from one fetch to the next.
		downloadUrl = resolveReliableDownloadUrl(match.downloadUrl)
	} else {
		if (!existing.thunderstoreFullName)
			return { ok: false, reason: 'hash-failed' }
		const versions = await fetchThunderstorePackageVersions(
			existing.thunderstoreFullName,
		)
		const match = versions.find((v) => v.version === rankedVersion)
		if (!match) return { ok: false, reason: 'hash-failed' }
		downloadUrl = match.downloadUrl
	}

	const hash = await computeModFolderHashForRelease(
		existing.id,
		rankedVersion,
		downloadUrl,
	)
	if (!hash) return { ok: false, reason: 'hash-failed' }

	await db
		.update(modRegistry)
		.set({ rankedVersion, rankedVersionSha256: hash, updatedAt: new Date() })
		.where(eq(modRegistry.id, existing.id))
	return { ok: true }
}

export async function setModFlags(
	modId: string,
	flags: { featured?: boolean; hidden?: boolean },
): Promise<boolean> {
	const rows = await db
		.update(modRegistry)
		.set({ ...flags, updatedAt: new Date() })
		.where(eq(modRegistry.id, modId))
		.returning({ id: modRegistry.id })
	return rows.length > 0
}

// --- Custom mods (features/webadmin/mods.route.ts, mods-sync.service.ts) ---
//
// A custom mod is the one kind of row an admin creates, edits and deletes
// (isCustom = true, no Thunderstore package). Every write below is scoped to
// isCustom rows in SQL, not just in the route, so a Thunderstore row's
// synced fields can never be edited or deleted through here.

async function listVersionRows(modId: string): Promise<ModVersionRow[]> {
	return db
		.select()
		.from(modRegistryVersions)
		.where(eq(modRegistryVersions.modId, modId))
}

// The versions an admin may pin for a custom mod, newest first. A stored URL
// that is a moving pointer (branch head, "latest release" asset) only serves
// the mod's current version, so it is pinnable only while it is the latest.
async function listPinnableCustomVersions(
	row: ModRow,
): Promise<Array<{ version: string; downloadUrl: string }>> {
	const versions = await listVersionRows(row.id)
	return versions
		.filter(
			(v): v is ModVersionRow & { downloadUrl: string } =>
				v.downloadUrl !== null &&
				(!isMovingDownloadUrl(v.downloadUrl) ||
					v.version === row.latestVersion),
		)
		.sort(
			(a, b) => (b.releasedAt?.getTime() ?? 0) - (a.releasedAt?.getTime() ?? 0),
		)
		.map((v) => ({ version: v.version, downloadUrl: v.downloadUrl }))
}

export async function listPinnableVersionsForMod(
	modId: string,
): Promise<Array<{ version: string; downloadUrl: string }> | null> {
	const row = await findModByIdOrFullName(modId)
	if (!row) return null
	return row.isCustom ? listPinnableCustomVersions(row) : []
}

// The URL a custom mod's ranked pin is hashed from, or null when that
// version has no row or no URL.
export async function getCustomPinDownloadUrl(
	modId: string,
	version: string,
): Promise<string | null> {
	const [row] = await db
		.select({ downloadUrl: modRegistryVersions.downloadUrl })
		.from(modRegistryVersions)
		.where(
			and(
				eq(modRegistryVersions.modId, modId),
				eq(modRegistryVersions.version, version),
			),
		)
	return row?.downloadUrl ? resolveReliableDownloadUrl(row.downloadUrl) : null
}

// Custom mods opted into the hourly GitHub check.
export async function listCustomModsForVersionCheck() {
	return db
		.select({
			id: modRegistry.id,
			repoUrl: modRegistry.repoUrl,
			latestVersion: modRegistry.latestVersion,
			latestDownloadUrl: modRegistry.latestDownloadUrl,
			fixedReleaseTagUpdates: modRegistry.fixedReleaseTagUpdates,
		})
		.from(modRegistry)
		.where(
			and(
				eq(modRegistry.isCustom, true),
				eq(modRegistry.automaticVersionCheck, true),
			),
		)
}

// After a custom mod's latest version/URL changed, records that version as a
// row (what the launcher's version picker and a ranked pin read) and drops a
// ranked pin whose hash the new state can no longer back:
//  - the pin sits on the version whose URL just changed, or
//  - the pin sits on an older version whose stored URL is a moving pointer
//    (it now serves the newer bytes), or has no URL, or has no row at all.
// A tagged-release or Thunderstore-style URL is immutable, so a pin on an
// older one survives. Returns true when a pin was cleared.
async function recordCustomVersionAndReconcilePin(
	tx: Tx,
	after: ModRow,
): Promise<boolean> {
	const before = await tx
		.select()
		.from(modRegistryVersions)
		.where(eq(modRegistryVersions.modId, after.id))

	if (after.latestVersion) {
		await tx
			.insert(modRegistryVersions)
			.values({
				modId: after.id,
				version: after.latestVersion,
				downloadUrl: after.latestDownloadUrl,
				releasedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: [modRegistryVersions.modId, modRegistryVersions.version],
				set: { downloadUrl: after.latestDownloadUrl },
			})
	}

	const pin = after.rankedVersion
	if (!pin) return false
	const pinned = before.find((v) => v.version === pin)
	const stale =
		!pinned ||
		pinned.downloadUrl === null ||
		(pin === after.latestVersion
			? pinned.downloadUrl !== after.latestDownloadUrl
			: isMovingDownloadUrl(pinned.downloadUrl))
	if (!stale) return false

	await tx
		.update(modRegistry)
		.set({ rankedVersion: null, rankedVersionSha256: null })
		.where(eq(modRegistry.id, after.id))
	return true
}

// Writes back a version custom-mod-version-check.service.ts just detected.
// downloadUrl null means "leave latestDownloadUrl as it is" (the HEAD case,
// and the common latest-tag case where the URL is already a stable pointer).
export async function applyDetectedVersion(
	modId: string,
	input: { version: string; downloadUrl: string | null },
): Promise<{ pinCleared: boolean }> {
	return db.transaction(async (tx) => {
		const set: Partial<typeof modRegistry.$inferInsert> = {
			latestVersion: input.version,
			sourceUpdatedAt: new Date(),
			updatedAt: new Date(),
		}
		if (input.downloadUrl) set.latestDownloadUrl = input.downloadUrl

		const [row] = await tx
			.update(modRegistry)
			.set(set)
			.where(and(eq(modRegistry.id, modId), eq(modRegistry.isCustom, true)))
			.returning()
		if (!row) return { pinCleared: false }
		return { pinCleared: await recordCustomVersionAndReconcilePin(tx, row) }
	})
}

export interface CustomModFields {
	title: string
	author: string
	categories: string[]
	searchTerms: string[]
	requiresSteamodded: boolean
	requiresTalisman: boolean
	repoUrl: string | null
	thumbnailUrl: string | null
	description: string | null
	latestVersion: string | null
	latestDownloadUrl: string | null
	automaticVersionCheck: boolean
	fixedReleaseTagUpdates: boolean
}

export type CreateCustomModInput = Partial<CustomModFields> &
	Pick<CustomModFields, 'title' | 'author'> & { id: string }

// Returns null when the id is taken by any existing row (synced or custom),
// or equals a Thunderstore full name a future sync could want -- the route
// turns that into a 409.
export async function createCustomMod(
	input: CreateCustomModInput,
): Promise<ModRow | null> {
	return db.transaction(async (tx) => {
		const [taken] = await tx
			.select({ id: modRegistry.id })
			.from(modRegistry)
			.where(
				or(
					eq(modRegistry.id, input.id),
					eq(modRegistry.thunderstoreFullName, input.id),
				),
			)
		if (taken) return null

		const [row] = await tx
			.insert(modRegistry)
			.values({
				id: input.id,
				title: input.title,
				author: input.author,
				categories: input.categories ?? [],
				searchTerms: input.searchTerms ?? [],
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
		await recordCustomVersionAndReconcilePin(tx, row)
		return row
	})
}

// Partial update: undefined leaves a field untouched, an explicit null clears
// a nullable one. Returns null for a missing or non-custom mod.
export type UpdateCustomModInput = Partial<CustomModFields>

export async function updateCustomMod(
	modId: string,
	input: UpdateCustomModInput,
): Promise<ModRow | null> {
	return db.transaction(async (tx) => {
		const [current] = await tx
			.select()
			.from(modRegistry)
			.where(and(eq(modRegistry.id, modId), eq(modRegistry.isCustom, true)))
		if (!current) return null

		const fields = Object.fromEntries(
			Object.entries(input).filter(([, v]) => v !== undefined),
		)
		const [row] = await tx
			.update(modRegistry)
			.set({ ...fields, updatedAt: new Date() })
			.where(eq(modRegistry.id, modId))
			.returning()

		if (
			row.latestVersion !== current.latestVersion ||
			row.latestDownloadUrl !== current.latestDownloadUrl
		) {
			await recordCustomVersionAndReconcilePin(tx, row)
			return (
				(
					await tx.select().from(modRegistry).where(eq(modRegistry.id, modId))
				)[0] ?? row
			)
		}
		return row
	})
}

export async function deleteCustomMod(modId: string): Promise<boolean> {
	const rows = await db
		.delete(modRegistry)
		.where(and(eq(modRegistry.id, modId), eq(modRegistry.isCustom, true)))
		.returning({ id: modRegistry.id })
	return rows.length > 0
}
