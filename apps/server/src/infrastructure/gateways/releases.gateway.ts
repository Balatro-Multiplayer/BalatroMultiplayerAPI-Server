import { and, asc, count, desc, eq, ilike, or } from 'drizzle-orm'
import { db } from '../db/index.js'
import { modBranches, modReleases } from '../db/schema.js'

// Joined release shape — matches the old /api/releases contract the launcher consumes.
const releaseColumns = {
	id: modReleases.id,
	name: modReleases.name,
	description: modReleases.description,
	version: modReleases.version,
	url: modReleases.url,
	smods_version: modReleases.smodsVersion,
	lovely_version: modReleases.lovelyVersion,
	branchId: modReleases.branchId,
	branchName: modBranches.name,
	createdAt: modReleases.createdAt,
	updatedAt: modReleases.updatedAt,
}

export interface ReleaseInput {
	name: string
	version: string
	url: string
	description?: string | null
	smods_version?: string
	lovely_version?: string
	branchId?: number
}

/** Launcher-facing list: every release, newest first, with branch name. */
export async function listReleasesPublic() {
	return db
		.select(releaseColumns)
		.from(modReleases)
		.leftJoin(modBranches, eq(modReleases.branchId, modBranches.id))
		.orderBy(desc(modReleases.createdAt), desc(modReleases.id))
}

export type SortBy = 'createdAt' | 'name' | 'version' | 'branchName'

export async function listReleasesAdmin(opts: {
	page: number
	pageSize: number
	search?: string
	sortBy: SortBy
	sortOrder: 'asc' | 'desc'
}) {
	const { page, pageSize, search, sortBy, sortOrder } = opts
	const offset = (page - 1) * pageSize

	const where = search
		? or(
				ilike(modReleases.name, `%${search}%`),
				ilike(modReleases.version, `%${search}%`),
				ilike(modReleases.description, `%${search}%`),
				ilike(modBranches.name, `%${search}%`),
			)
		: undefined

	const dir = sortOrder === 'asc' ? asc : desc
	const orderCol =
		sortBy === 'name'
			? modReleases.name
			: sortBy === 'version'
				? modReleases.version
				: sortBy === 'branchName'
					? modBranches.name
					: modReleases.createdAt

	const [{ total }] = await db
		.select({ total: count() })
		.from(modReleases)
		.leftJoin(modBranches, eq(modReleases.branchId, modBranches.id))
		.where(where)

	const data = await db
		.select(releaseColumns)
		.from(modReleases)
		.leftJoin(modBranches, eq(modReleases.branchId, modBranches.id))
		.where(where)
		.orderBy(dir(orderCol), desc(modReleases.id))
		.limit(pageSize)
		.offset(offset)

	return {
		data,
		page,
		pageSize,
		total,
		totalPages: Math.max(1, Math.ceil(total / pageSize)),
	}
}

export async function addRelease(input: ReleaseInput) {
	const [row] = await db
		.insert(modReleases)
		.values({
			name: input.name,
			version: input.version,
			url: input.url,
			description: input.description ?? null,
			smodsVersion: input.smods_version ?? 'latest',
			lovelyVersion: input.lovely_version ?? 'latest',
			branchId: input.branchId ?? 1,
		})
		.returning()
	return row
}

export async function updateRelease(id: number, input: ReleaseInput) {
	const [row] = await db
		.update(modReleases)
		.set({
			name: input.name,
			version: input.version,
			url: input.url,
			description: input.description ?? null,
			smodsVersion: input.smods_version ?? 'latest',
			lovelyVersion: input.lovely_version ?? 'latest',
			branchId: input.branchId ?? 1,
			updatedAt: new Date(),
		})
		.where(eq(modReleases.id, id))
		.returning()
	return row ?? null
}

export async function deleteRelease(id: number) {
	await db.delete(modReleases).where(eq(modReleases.id, id))
}

export async function listBranches() {
	return db.select().from(modBranches).orderBy(asc(modBranches.id))
}

export async function addBranch(name: string) {
	const [row] = await db
		.insert(modBranches)
		.values({ name })
		.onConflictDoNothing()
		.returning()
	return row ?? null
}

export async function deleteBranch(id: number) {
	// Don't delete a branch that still has releases (FK), or the default 'main'.
	const [{ total }] = await db
		.select({ total: count() })
		.from(modReleases)
		.where(eq(modReleases.branchId, id))
	if (total > 0) return { ok: false as const, reason: 'in_use' as const }
	await db.delete(modBranches).where(and(eq(modBranches.id, id)))
	return { ok: true as const }
}
