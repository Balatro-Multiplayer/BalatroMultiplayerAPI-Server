import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import type { LauncherPlatform } from '../db/schema.js'
import { launcherReleaseAssets, launcherReleases } from '../db/schema.js'

export interface LauncherReleaseAsset {
	platform: LauncherPlatform
	githubAssetId: number
	originalFilename: string
	fileSize: number
	sha256: string
}

export interface LauncherReleaseWithAssets {
	id: number
	version: string
	githubReleaseTag: string
	notes: string | null
	createdAt: Date
	updatedAt: Date
	assets: LauncherReleaseAsset[]
}

async function withAssets(
	release: typeof launcherReleases.$inferSelect,
): Promise<LauncherReleaseWithAssets> {
	const assets = await db
		.select({
			platform: launcherReleaseAssets.platform,
			githubAssetId: launcherReleaseAssets.githubAssetId,
			originalFilename: launcherReleaseAssets.originalFilename,
			fileSize: launcherReleaseAssets.fileSize,
			sha256: launcherReleaseAssets.sha256,
		})
		.from(launcherReleaseAssets)
		.where(eq(launcherReleaseAssets.releaseId, release.id))
	return { ...release, assets }
}

// Admin list (apps/web admin/releases table) -- newest version first.
export async function listReleases(): Promise<LauncherReleaseWithAssets[]> {
	const releases = await db
		.select()
		.from(launcherReleases)
		.orderBy(desc(launcherReleases.createdAt))
	return Promise.all(releases.map(withAssets))
}

// "Latest" = most recently created release row -- no explicit channel/flag,
// matches the flat version-history model (see schema.ts doc comment).
export async function getLatestRelease(): Promise<LauncherReleaseWithAssets | null> {
	const [release] = await db
		.select()
		.from(launcherReleases)
		.orderBy(desc(launcherReleases.createdAt))
		.limit(1)
	if (!release) return null
	return withAssets(release)
}

export async function getReleaseByVersion(
	version: string,
): Promise<typeof launcherReleases.$inferSelect | null> {
	const release = await db.query.launcherReleases.findFirst({
		where: eq(launcherReleases.version, version),
	})
	return release ?? null
}

export async function getReleaseById(
	id: number,
): Promise<typeof launcherReleases.$inferSelect | null> {
	const release = await db.query.launcherReleases.findFirst({
		where: eq(launcherReleases.id, id),
	})
	return release ?? null
}

export async function getReleaseWithAssetsById(
	id: number,
): Promise<LauncherReleaseWithAssets | null> {
	const release = await getReleaseById(id)
	if (!release) return null
	return withAssets(release)
}

// Finds the release row for `version`, creating it if this is the first
// import for that version. Used by the from-github import route before
// writing any asset rows -- a release can exist with zero, one, two, or
// three assets at any point (a GitHub release can be missing a platform's
// build), so "does this version exist yet" and "does it have a
// windows/mac/linux binary yet" are separate questions. Always refreshes
// githubReleaseTag/updatedAt even on an already-existing version, since the
// admin UI's "re-sync" action calls this with the same version on purpose
// to re-pull asset metadata from GitHub.
export async function upsertRelease(
	version: string,
	githubReleaseTag: string,
	notes?: string | null,
): Promise<typeof launcherReleases.$inferSelect> {
	const existing = await getReleaseByVersion(version)
	if (existing) {
		const [updated] = await db
			.update(launcherReleases)
			.set({
				githubReleaseTag,
				...(notes !== undefined ? { notes } : {}),
				updatedAt: new Date(),
			})
			.where(eq(launcherReleases.id, existing.id))
			.returning()
		return updated
	}
	const [created] = await db
		.insert(launcherReleases)
		.values({ version, githubReleaseTag, notes: notes ?? null })
		.returning()
	return created
}

export async function getAsset(
	releaseId: number,
	platform: LauncherPlatform,
): Promise<typeof launcherReleaseAssets.$inferSelect | null> {
	const asset = await db.query.launcherReleaseAssets.findFirst({
		where: and(
			eq(launcherReleaseAssets.releaseId, releaseId),
			eq(launcherReleaseAssets.platform, platform),
		),
	})
	return asset ?? null
}

// Upserts by (releaseId, platform) -- re-resolving an existing platform's
// asset for a version (a re-sync, or GitHub's asset having been replaced
// under the same release) is an update, not a new row. createdAt is bumped
// on replace since it represents "when this asset reference was resolved",
// not "when this row was first created".
export async function upsertAsset(
	releaseId: number,
	platform: LauncherPlatform,
	input: {
		githubAssetId: number
		originalFilename: string
		fileSize: number
		sha256: string
	},
): Promise<typeof launcherReleaseAssets.$inferSelect> {
	const [row] = await db
		.insert(launcherReleaseAssets)
		.values({ releaseId, platform, ...input })
		.onConflictDoUpdate({
			target: [launcherReleaseAssets.releaseId, launcherReleaseAssets.platform],
			set: { ...input, createdAt: new Date() },
		})
		.returning()
	return row
}

// Deletes the whole release row (cascades to its assets) -- nothing further
// for the caller to clean up (asset bytes live on GitHub, not this server).
export async function deleteRelease(
	id: number,
): Promise<typeof launcherReleases.$inferSelect | null> {
	const [row] = await db
		.delete(launcherReleases)
		.where(eq(launcherReleases.id, id))
		.returning()
	return row ?? null
}

// Deletes just one platform's asset row -- e.g. to stop advertising a
// platform whose GitHub build is known-bad. Nothing further for the caller
// to clean up (asset bytes live on GitHub, not this server).
export async function deleteAssetRow(
	releaseId: number,
	platform: LauncherPlatform,
): Promise<typeof launcherReleaseAssets.$inferSelect | null> {
	const [row] = await db
		.delete(launcherReleaseAssets)
		.where(
			and(
				eq(launcherReleaseAssets.releaseId, releaseId),
				eq(launcherReleaseAssets.platform, platform),
			),
		)
		.returning()
	return row ?? null
}
