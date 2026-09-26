import {
	and,
	asc,
	eq,
	inArray,
	isNull,
	isNotNull,
	notInArray,
	or,
	sql,
} from 'drizzle-orm'
import { withLegacySteamoddedTags } from '../../features/mods/legacy-steamodded-tags.js'
import { extractRepoInfo } from '../../features/mods/github-api.js'
import {
	type GithubVersion,
	resolveCommitVersion,
	toPermanentUrl,
} from '../../features/mods/github-mod-versions.service.js'
import type {
	ExistingModRow,
	ModRowClaim,
} from '../../features/mods/mod-registry-claims.js'
import { classifyDownloadUrl } from '../../features/mods/mod-source-classifier.js'
import {
	type VersionSource,
	canonicalVersionKey,
	foldGithubVersions,
	isSteamodded,
	matchesVersion,
	thunderstoreAliases,
} from '../../features/mods/mod-version-aliases.js'
import {
	type ModLayout,
	computeModFolderHashForRelease,
} from '../../features/mods/mod-version-hash.js'
import type { ModIndexEntryInput } from '../../features/mods/thunderstore-mod-index.service.js'
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

export type RankedDownloadStatus = 'ok' | 'unavailable'

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

// The ranked pin, as served to the launcher: which version, the permanent URL
// to download it from, the layout to deploy it with, the hash of the result,
// and whether that download still works (see new-launcher
// THUNDERSTORE_MIGRATION_PLAN.md section 3).
function rankedFields(row: ModRow) {
	return {
		rankedVersion: row.rankedVersion,
		rankedVersionSha256: row.rankedVersionSha256,
		rankedDownloadUrl: row.rankedDownloadUrl,
		rankedSource: row.rankedSource,
		rankedDownloadStatus: row.rankedDownloadStatus,
	}
}

function toListItem(row: ModRow) {
	return {
		id: row.id,
		name: row.title,
		title: row.title,
		author: row.author,
		...rankedFields(row),
		featured: row.featured,
		hidden: row.hidden,
		latestVersion: row.latestVersion,
		latestDownloadUrl: row.latestDownloadUrl,
		thumbnailUrl: row.thumbnailUrl,
		isCustom: row.isCustom,
		trackGithub: row.isCustom || row.trackGithub,
		overriddenFields: [] as string[],
		searchTerms: row.searchTerms,
		sourceType: sourceTypeOf(row),
		thunderstoreFullName: row.thunderstoreFullName,
	}
}

// The ranked pin's hash is the only hash the server keeps, so it stands in
// for the version-level sha256 wherever that version is the pinned one.
function hashFor(row: ModRow, version: string | null): string | null {
	return version !== null && version === row.rankedVersion
		? row.rankedVersionSha256
		: null
}

// Thunderstore versions first (newest first), then GitHub-only versions
// (newest first). The launcher takes versions[0] as "latest", so a mod with
// any Thunderstore version always gets its "latest" from Thunderstore.
function orderVersions(versions: ModVersionRow[]): ModVersionRow[] {
	const newestFirst = (a: ModVersionRow, b: ModVersionRow) =>
		(b.releasedAt?.getTime() ?? 0) - (a.releasedAt?.getTime() ?? 0)
	const bySource = (source: VersionSource) =>
		versions.filter((v) => v.source === source).sort(newestFirst)
	return [...bySource('thunderstore'), ...bySource('github')]
}

function toVersionItem(row: ModRow, v: ModVersionRow) {
	return {
		id: v.id,
		modId: v.modId,
		version: v.version,
		source: v.source as VersionSource,
		aliases: v.aliases,
		ref: v.ref,
		sha256: hashFor(row, v.version),
		downloadUrl: v.downloadUrl,
		releasedAt: v.releasedAt,
		pinFailedAt: null,
		dependencies: v.dependencies,
	}
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
		...rankedFields(row),
		featured: row.featured,
		hidden: row.hidden,
		isCustom: row.isCustom,
		trackGithub: row.isCustom || row.trackGithub,
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
		versions: withLegacySteamoddedTags(
			row.thunderstoreFullName,
			orderVersions(versions).map((v) => toVersionItem(row, v)),
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

async function listVersionRows(
	modId: string,
	tx: Tx | typeof db = db,
): Promise<ModVersionRow[]> {
	return tx
		.select()
		.from(modRegistryVersions)
		.where(eq(modRegistryVersions.modId, modId))
}

export async function getPublicModById(
	idOrFullName: string,
	opts?: { includeHidden?: boolean },
) {
	const row = await findModByIdOrFullName(idOrFullName)
	if (!row) return null
	if (row.hidden && !opts?.includeHidden) return null
	return toDetail(row, await listVersionRows(row.id))
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
// Thunderstore versions (its GitHub versions are left alone, except one whose
// name a Thunderstore version now takes). Never touches the admin-owned
// fields (ranked pin, featured, hidden, trackGithub). title is set on insert
// only -- see schema.ts's title comment.
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
	const names = entry.versions.map((v) => v.version)

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
			.where(
				and(
					eq(modRegistryVersions.modId, claim.id),
					or(
						eq(modRegistryVersions.source, 'thunderstore'),
						names.length > 0
							? inArray(modRegistryVersions.version, names)
							: undefined,
					),
				),
			)
		if (entry.versions.length > 0) {
			await tx.insert(modRegistryVersions).values(
				entry.versions.map((v) => ({
					modId: claim.id,
					version: v.version,
					source: 'thunderstore',
					aliases: thunderstoreAliases(entry.fullName, v.version),
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
// ever called after a successful fetch. An empty list is treated as a bad
// response, not "every mod is gone", and prunes nothing. Returns the number
// of rows removed, for the sync log line.
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

// Mods whose GitHub releases/tags are listed as versions: every custom mod,
// and every Thunderstore mod an admin set to track GitHub.
export async function listGithubTrackedMods() {
	return db
		.select({
			id: modRegistry.id,
			thunderstoreFullName: modRegistry.thunderstoreFullName,
			repoUrl: modRegistry.repoUrl,
			latestDownloadUrl: modRegistry.latestDownloadUrl,
		})
		.from(modRegistry)
		.where(
			or(eq(modRegistry.isCustom, true), eq(modRegistry.trackGithub, true)),
		)
}

function unique(values: string[]): string[] {
	return [...new Set(values)]
}

// Merges a mod's GitHub releases/tags into its version list: one that is the
// same release as a Thunderstore version becomes an alias of it (and any
// separate GitHub row for it is dropped), the rest are upserted as GitHub
// versions. GitHub rows that disappeared upstream are kept -- they may back a
// pin, and a stale extra version is harmless.
export async function mergeGithubVersions(
	modId: string,
	thunderstoreFullName: string | null,
	githubVersions: GithubVersion[],
): Promise<void> {
	const steamodded = isSteamodded(thunderstoreFullName)
	await db.transaction(async (tx) => {
		const rows = await listVersionRows(modId, tx)
		const tsRows = rows.filter((r) => r.source === 'thunderstore')
		const { aliases, githubOnly } = foldGithubVersions(
			tsRows.map((r) => r.version),
			githubVersions,
			steamodded,
		)

		for (const tsRow of tsRows) {
			const next = unique([
				...thunderstoreAliases(thunderstoreFullName, tsRow.version),
				...(aliases.get(tsRow.version) ?? []),
			])
			if (next.join('\n') !== tsRow.aliases.join('\n')) {
				await tx
					.update(modRegistryVersions)
					.set({ aliases: next })
					.where(eq(modRegistryVersions.id, tsRow.id))
			}
		}

		const tsKeys = new Set(
			tsRows.map((r) => canonicalVersionKey(r.version, steamodded)),
		)
		const folded = rows.filter(
			(r) =>
				r.source === 'github' &&
				tsKeys.has(canonicalVersionKey(r.version, steamodded)),
		)
		if (folded.length > 0) {
			await tx.delete(modRegistryVersions).where(
				inArray(
					modRegistryVersions.id,
					folded.map((r) => r.id),
				),
			)
		}

		for (const gh of githubOnly) {
			await upsertGithubVersion(tx, modId, gh)
		}
	})
}

async function upsertGithubVersion(tx: Tx, modId: string, gh: GithubVersion) {
	await tx
		.insert(modRegistryVersions)
		.values({
			modId,
			version: gh.name,
			source: 'github',
			ref: gh.ref,
			downloadUrl: gh.downloadUrl,
			releasedAt: gh.releasedAt ? new Date(gh.releasedAt) : null,
		})
		.onConflictDoUpdate({
			target: [modRegistryVersions.modId, modRegistryVersions.version],
			set: { downloadUrl: gh.downloadUrl, ref: gh.ref },
			where: eq(modRegistryVersions.source, 'github'),
		})
}

// --- Ranked pins (sync + admin) ---

export async function listRankedPins() {
	return db
		.select({
			id: modRegistry.id,
			thunderstoreFullName: modRegistry.thunderstoreFullName,
			repoUrl: modRegistry.repoUrl,
			rankedVersion: modRegistry.rankedVersion,
			rankedVersionSha256: modRegistry.rankedVersionSha256,
			rankedDownloadUrl: modRegistry.rankedDownloadUrl,
			rankedSource: modRegistry.rankedSource,
			rankedDownloadStatus: modRegistry.rankedDownloadStatus,
		})
		.from(modRegistry)
		.where(isNotNull(modRegistry.rankedVersion))
}

export interface PinTarget {
	version: string
	source: ModLayout
	downloadUrl: string | null
}

// The version row a pin names (by name or alias) and the permanent URL to
// download it from. downloadUrl is null when a moving GitHub URL couldn't be
// resolved right now; the result is null when no such version exists.
export async function resolvePinTarget(
	modId: string,
	repoUrl: string | null,
	name: string,
): Promise<PinTarget | null> {
	const rows = await listVersionRows(modId)
	const row =
		rows.find((r) => r.version === name) ??
		rows.find((r) => matchesVersion(r, name))
	if (!row) return null
	const source = row.source as ModLayout
	if (!row.downloadUrl)
		return { version: row.version, source, downloadUrl: null }
	const downloadUrl =
		source === 'thunderstore'
			? row.downloadUrl
			: await toPermanentUrl(row.downloadUrl, repoUrl, row.ref)
	return { version: row.version, source, downloadUrl }
}

// Stores a resolved + hashed pin. With expectedVersion set (the sync) it only
// writes if the pin is still that version, so an admin re-pin that lands
// mid-sync is never overwritten.
export async function storeRankedPin(
	modId: string,
	pin: {
		version: string
		downloadUrl: string
		source: ModLayout
		hash: string
	},
	expectedVersion?: string,
): Promise<void> {
	await db
		.update(modRegistry)
		.set({
			rankedVersion: pin.version,
			rankedVersionSha256: pin.hash,
			rankedDownloadUrl: pin.downloadUrl,
			rankedSource: pin.source,
			rankedDownloadStatus: 'ok',
			rankedCheckedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(
			expectedVersion === undefined
				? eq(modRegistry.id, modId)
				: and(
						eq(modRegistry.id, modId),
						eq(modRegistry.rankedVersion, expectedVersion),
					),
		)
}

// The sync's health flag. Never touches the pin itself.
export async function setRankedPinStatus(
	modId: string,
	version: string,
	status: RankedDownloadStatus,
): Promise<void> {
	await db
		.update(modRegistry)
		.set({ rankedDownloadStatus: status, rankedCheckedAt: new Date() })
		.where(
			and(eq(modRegistry.id, modId), eq(modRegistry.rankedVersion, version)),
		)
}

// --- Admin (features/webadmin/mods.route.ts) ---

export type SetRankedVersionResult =
	| { ok: true }
	| { ok: false; reason: 'not-found' }
	| { ok: false; reason: 'version-not-found' }
	// A moving GitHub URL (branch head, "latest release") couldn't be resolved
	// to a permanent one right now -- GitHub unreachable or the ref is gone.
	| { ok: false; reason: 'download-unresolvable' }
	| { ok: false; reason: 'hash-failed' }

// The sole ranked-eligibility write path: null un-ranks the mod; any other
// value pins it to that version of its merged list (Thunderstore or GitHub,
// by name or alias). The version is resolved to a permanent download URL,
// downloaded, laid out per its source and hashed before anything is written,
// so a pin always carries its URL and hash. Only an admin changes a pin.
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
				rankedDownloadUrl: null,
				rankedSource: null,
				rankedDownloadStatus: null,
				rankedCheckedAt: null,
				updatedAt: new Date(),
			})
			.where(eq(modRegistry.id, existing.id))
		return { ok: true }
	}

	const target = await resolvePinTarget(
		existing.id,
		existing.repoUrl,
		rankedVersion,
	)
	if (!target) return { ok: false, reason: 'version-not-found' }
	if (!target.downloadUrl) return { ok: false, reason: 'download-unresolvable' }

	const hash = await computeModFolderHashForRelease(
		existing.id,
		target.version,
		target.downloadUrl,
		target.source,
	)
	if (!hash) return { ok: false, reason: 'hash-failed' }

	await storeRankedPin(existing.id, {
		version: target.version,
		downloadUrl: target.downloadUrl,
		source: target.source,
		hash,
	})
	return { ok: true }
}

export type PinCommitResult =
	| SetRankedVersionResult
	| { ok: false; reason: 'no-github-repo' }
	| { ok: false; reason: 'commit-not-found' }

// Pins a specific commit an admin entered by SHA: records it as a GitHub
// version (short SHA as its name, a codeload commit archive as its URL), then
// pins that version exactly like setRankedVersion.
export async function pinCommit(
	modId: string,
	sha: string,
): Promise<PinCommitResult> {
	const existing = await findModByIdOrFullName(modId)
	if (!existing) return { ok: false, reason: 'not-found' }
	if (!extractRepoInfo(existing.repoUrl)) {
		return { ok: false, reason: 'no-github-repo' }
	}
	const commit = await resolveCommitVersion(existing.repoUrl, sha)
	if (!commit) return { ok: false, reason: 'commit-not-found' }

	await db.transaction((tx) => upsertGithubVersion(tx, existing.id, commit))
	return setRankedVersion(existing.id, commit.name)
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

// Thunderstore mods only -- a custom mod always tracks GitHub.
export async function setTrackGithub(
	modId: string,
	trackGithub: boolean,
): Promise<boolean> {
	const rows = await db
		.update(modRegistry)
		.set({ trackGithub, updatedAt: new Date() })
		.where(and(eq(modRegistry.id, modId), eq(modRegistry.isCustom, false)))
		.returning({ id: modRegistry.id })
	return rows.length > 0
}

// The merged version list the admin version picker offers, in the same order
// and shape the public detail endpoint serves.
export async function listVersionsForMod(modId: string) {
	const row = await findModByIdOrFullName(modId)
	if (!row) return null
	return orderVersions(await listVersionRows(row.id)).map((v) =>
		toVersionItem(row, v),
	)
}

// --- Custom mods (features/webadmin/mods.route.ts, mods-sync.service.ts) ---
//
// A custom mod is the one kind of row an admin creates, edits and deletes
// (isCustom = true, no Thunderstore package). Every write below is scoped to
// isCustom rows in SQL, not just in the route, so a Thunderstore row's
// synced fields can never be edited or deleted through here.

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

// Records a custom mod's current latest version as a GitHub version row, with
// the permanent URL for that exact version when one is known (a branch head's
// commit archive, a tag's asset) rather than the moving latest URL. Never
// touches the ranked pin: a pin carries its own permanent URL and hash.
async function recordCustomVersion(
	tx: Tx,
	row: ModRow,
	versionDownloadUrl: string | null,
): Promise<void> {
	if (!row.latestVersion) return
	const downloadUrl = versionDownloadUrl ?? row.latestDownloadUrl
	await tx
		.insert(modRegistryVersions)
		.values({
			modId: row.id,
			version: row.latestVersion,
			source: 'github',
			downloadUrl,
			releasedAt: new Date(),
		})
		.onConflictDoUpdate({
			target: [modRegistryVersions.modId, modRegistryVersions.version],
			set: { downloadUrl },
		})
}

// Writes back a version custom-mod-version-check.service.ts just detected.
// downloadUrl null means "leave latestDownloadUrl as it is" (the HEAD case,
// and the common latest-tag case where the URL is already a stable pointer).
// Returns false when the mod is gone or no longer custom.
export async function applyDetectedVersion(
	modId: string,
	input: {
		version: string
		downloadUrl: string | null
		versionDownloadUrl: string | null
	},
): Promise<boolean> {
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
		if (!row) return false
		await recordCustomVersion(tx, row, input.versionDownloadUrl)
		return true
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
	Pick<CustomModFields, 'title' | 'author'> & {
		id: string
		// Permanent URL for latestVersion's own version row, when the route
		// resolved one (see ResolvedSource.versionDownloadUrl).
		versionDownloadUrl?: string | null
	}

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
		await recordCustomVersion(tx, row, input.versionDownloadUrl ?? null)
		return row
	})
}

// Partial update: undefined leaves a field untouched, an explicit null clears
// a nullable one. Returns null for a missing or non-custom mod.
export type UpdateCustomModInput = Partial<CustomModFields> & {
	versionDownloadUrl?: string | null
}

export async function updateCustomMod(
	modId: string,
	input: UpdateCustomModInput,
): Promise<ModRow | null> {
	const { versionDownloadUrl, ...fieldsInput } = input
	return db.transaction(async (tx) => {
		const [current] = await tx
			.select()
			.from(modRegistry)
			.where(and(eq(modRegistry.id, modId), eq(modRegistry.isCustom, true)))
		if (!current) return null

		const fields = Object.fromEntries(
			Object.entries(fieldsInput).filter(([, v]) => v !== undefined),
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
			await recordCustomVersion(tx, row, versionDownloadUrl ?? null)
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
