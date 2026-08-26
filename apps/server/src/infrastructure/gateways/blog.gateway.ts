import { and, desc, eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import type { BlogPostKind } from '../db/schema.js'
import { blogPosts } from '../db/schema.js'

export type BlogPost = typeof blogPosts.$inferSelect

// Admin list (apps/web admin/blog table) -- everything, including drafts,
// newest edit first.
export async function listPosts(): Promise<BlogPost[]> {
	return db.select().from(blogPosts).orderBy(desc(blogPosts.updatedAt))
}

export async function getPostById(id: number): Promise<BlogPost | null> {
	const post = await db.query.blogPosts.findFirst({
		where: eq(blogPosts.id, id),
	})
	return post ?? null
}

// One row per kind, "latest" = most recently *published* (see schema.ts's
// doc comment on why publish always bumps publishedAt). Draft rows are
// never eligible here regardless of how recently they were edited.
async function getLatestPublished(kind: BlogPostKind): Promise<BlogPost | null> {
	const [post] = await db
		.select()
		.from(blogPosts)
		.where(and(eq(blogPosts.kind, kind), eq(blogPosts.status, 'published')))
		.orderBy(desc(blogPosts.publishedAt))
		.limit(1)
	return post ?? null
}

export async function getLatestPublishedByAllKinds(): Promise<{
	patchNotes: BlogPost | null
	news: BlogPost | null
}> {
	const [patchNotes, news] = await Promise.all([
		getLatestPublished('patch_notes'),
		getLatestPublished('news'),
	])
	return { patchNotes, news }
}

export async function createPost(input: {
	kind: BlogPostKind
	title: string
	bodyHtml: string
	authorPlayerId: string
}): Promise<BlogPost> {
	const [post] = await db
		.insert(blogPosts)
		.values({ ...input, status: 'draft' })
		.returning()
	return post
}

export async function updatePost(
	id: number,
	input: Partial<{ title: string; bodyHtml: string }>,
): Promise<BlogPost | null> {
	const [post] = await db
		.update(blogPosts)
		.set(input)
		.where(eq(blogPosts.id, id))
		.returning()
	return post ?? null
}

// Always bumps publishedAt to now, even on a republish -- see schema.ts's
// doc comment for why (a republished older post should be able to become
// "latest" again, since that's the deliberate action an admin just took).
export async function publishPost(id: number): Promise<BlogPost | null> {
	const [post] = await db
		.update(blogPosts)
		.set({ status: 'published', publishedAt: new Date() })
		.where(eq(blogPosts.id, id))
		.returning()
	return post ?? null
}

// Leaves publishedAt untouched -- it's "when this was last made live", not
// "is this currently live", so an unpublish shouldn't erase that history.
export async function unpublishPost(id: number): Promise<BlogPost | null> {
	const [post] = await db
		.update(blogPosts)
		.set({ status: 'draft' })
		.where(eq(blogPosts.id, id))
		.returning()
	return post ?? null
}

export async function deletePost(id: number): Promise<BlogPost | null> {
	const [post] = await db
		.delete(blogPosts)
		.where(eq(blogPosts.id, id))
		.returning()
	return post ?? null
}
