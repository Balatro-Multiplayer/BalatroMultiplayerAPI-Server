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
import type {
	ExistingModRow,
	ModRowClaim,
} from '../../features/mods/mod-registry-claims.js'
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

// --- Public catalog reads (GET /api/mods, GET /api/mods/:id) ---
//
// Response shapes are a superset of what the GitHub-index era served, key for
// key, because the launcher (new-launcher's ModIndexManager/ModIndexEntry)
// reads them leniently and treats a missing key as empty. Fields that no
// longer exist are served as their neutral constant (isCustom: false,
// overriddenFields: [], ...) rather than dropped. See mods.test.ts for the
// pinned key sets.

// Every download URL is a Thunderstore version archive: an immutable,
// version-keyed static file, which the launcher's source classifier calls
// 'release'.
const SOURCE_TYPE = 'release'

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
		isCustom: false,
		overriddenFields: [] as string[],
		searchTerms: [] as string[],
		sourceType: SOURCE_TYPE,
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
		searchTerms: [] as string[],
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
		isCustom: false,
		automaticVersionCheck: false,
		fixedReleaseTagUpdates: false,
		overriddenFields: [] as string[],
		indexSource: 'thunderstore' as const,
		sourceUpdatedAt: row.sourceUpdatedAt,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		sourceType: SOURCE_TYPE,
		thunderstoreFullName: row.thunderstoreFullName,
		packageUrl: row.packageUrl,
		donationLink: row.donationLink,
		// The launcher takes versions[0] as "latest", so order newest first.
		versions: [...versions]
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
		})
		.from(modRegistry)
}

// Writes one package into the row its claim names, and replaces that row's
// version list. Never touches the admin-owned fields (ranked pin, featured,
// hidden). title is set on insert only -- see schema.ts's title comment.
export async function writeModFromIndex(
	claim: ModRowClaim,
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

// Deletes every row not written by this sync: unclaimed carried-over rows,
// and packages that left Thunderstore. Only ever called after a successful
// fetch. An empty list is treated as a bad response, not "every mod is gone",
// and prunes nothing. Returns the number of rows removed, for the sync log
// line.
export async function pruneModsNotIn(fullNames: string[]): Promise<number> {
	if (fullNames.length === 0) return 0
	const rows = await db
		.delete(modRegistry)
		.where(
			or(
				isNull(modRegistry.thunderstoreFullName),
				notInArray(modRegistry.thunderstoreFullName, fullNames),
			),
		)
		.returning({ id: modRegistry.id })
	return rows.length
}

export async function listRankedPins() {
	return db
		.select({
			id: modRegistry.id,
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

	if (!existing.thunderstoreFullName)
		return { ok: false, reason: 'hash-failed' }
	const versions = await fetchThunderstorePackageVersions(
		existing.thunderstoreFullName,
	)
	const match = versions.find((v) => v.version === rankedVersion)
	if (!match) return { ok: false, reason: 'hash-failed' }

	const hash = await computeModFolderHashForRelease(
		existing.id,
		rankedVersion,
		match.downloadUrl,
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
