import { and, asc, eq } from 'drizzle-orm'
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
			latestVersion: modRegistry.latestVersion,
			thumbnailUrl: modRegistry.thumbnailUrl,
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
	latestSha256: string | null
	allowedInRanked: boolean
	versions: Array<{
		version: string
		sha256: string | null
		downloadUrl: string | null
		releasedAt: string | null
	}>
}

// Upserts one index entry. `allowedInRanked` from the index is only applied
// when this row isn't currently a 'manual' override (an admin edit via
// PUT /api/webadmin/mods/:modId wins until explicitly reset) -- see
// modRegistry.allowedInRankedSource's doc comment in schema.ts.
export async function upsertModFromIndex(
	entry: ModIndexEntryInput,
): Promise<void> {
	const existing = await db.query.modRegistry.findFirst({
		where: eq(modRegistry.id, entry.id),
	})

	const allowedInRanked =
		existing?.allowedInRankedSource === 'manual'
			? existing.allowedInRanked
			: entry.allowedInRanked

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
			latestSha256: entry.latestSha256,
			allowedInRanked,
			allowedInRankedSource: 'index',
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
				latestSha256: entry.latestSha256,
				allowedInRanked,
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
				sha256: v.sha256,
				downloadUrl: v.downloadUrl,
				releasedAt: v.releasedAt ? new Date(v.releasedAt) : null,
			})
			.onConflictDoUpdate({
				target: [modRegistryVersions.modId, modRegistryVersions.version],
				set: { sha256: v.sha256, downloadUrl: v.downloadUrl },
			})
	}
}

// --- Admin: manual ranked-allowlist override (PUT/DELETE /api/webadmin/mods/:modId) ---

export async function setManualAllowedInRanked(
	modId: string,
	allowed: boolean,
): Promise<boolean> {
	const [row] = await db
		.update(modRegistry)
		.set({
			allowedInRanked: allowed,
			allowedInRankedSource: 'manual',
			updatedAt: new Date(),
		})
		.where(eq(modRegistry.id, modId))
		.returning()
	return row != null
}

// Hands ranked-eligibility for this mod back to the next BETModIndex sync
// instead of staying pinned to whatever an admin last set manually.
export async function resetAllowedInRankedToIndex(
	modId: string,
): Promise<boolean> {
	const [row] = await db
		.update(modRegistry)
		.set({ allowedInRankedSource: 'index', updatedAt: new Date() })
		.where(eq(modRegistry.id, modId))
		.returning()
	return row != null
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
