import { TRPCError } from '@trpc/server'
import { asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  createTRPCRouter,
  permissionProcedure,
  publicProcedure,
} from '@/server/api/trpc'
import { db } from '@/server/db'
import { blogPosts, users } from '@/server/db/schema'

// Helper function to generate a slug from a title
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with a single hyphen
    .trim()
}

export const blogRouter = createTRPCRouter({
  // Get all users that can be authors (admin only)
  getAllUsers: permissionProcedure('blog.manage').query(async () => {
    const allUsers = await db.query.users.findMany({
      columns: {
        id: true,
        name: true,
        image: true,
      },
      orderBy: (users, { asc }) => [asc(users.name)],
    })
    return allUsers
  }),

  // Get all published blog posts (public)
  getAllPublished: publicProcedure.query(async () => {
    const posts = await db.query.blogPosts.findMany({
      where: eq(blogPosts.published, true),
      orderBy: (blogPosts, { desc }) => [desc(blogPosts.createdAt)],
      with: {
        author: {
          columns: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
    })
    return posts
  }),

  // Get a single blog post by slug (public)
  getBySlug: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ input }) => {
      const post = await db.query.blogPosts.findFirst({
        where: eq(blogPosts.slug, input.slug),
        with: {
          author: {
            columns: {
              id: true,
              name: true,
              image: true,
            },
          },
        },
      })

      if (!post || !post.published) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Blog post not found',
        })
      }

      return post
    }),

  // Get all blog posts (admin only)
  getAll: permissionProcedure('blog.manage').query(async () => {
    const posts = await db.query.blogPosts.findMany({
      orderBy: (blogPosts, { desc }) => [desc(blogPosts.createdAt)],
      with: {
        author: {
          columns: {
            id: true,
            name: true,
            image: true,
          },
        },
      },
    })
    return posts
  }),

  adminList: permissionProcedure('blog.manage')
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(50),
        search: z.string().trim().optional(),
        sortBy: z
          .enum(['createdAt', 'title', 'published'])
          .default('createdAt'),
        sortOrder: z.enum(['asc', 'desc']).default('desc'),
      })
    )
    .query(async ({ input }) => {
      const page = input.page
      const pageSize = input.pageSize
      const offset = (page - 1) * pageSize
      const search = input.search?.trim()

      const where = search
        ? or(
            ilike(blogPosts.title, `%${search}%`),
            ilike(blogPosts.slug, `%${search}%`),
            ilike(users.name, `%${search}%`)
          )
        : undefined

      const dir = input.sortOrder === 'asc' ? asc : desc
      const orderBy =
        input.sortBy === 'title'
          ? [
              dir(blogPosts.title),
              desc(blogPosts.createdAt),
              desc(blogPosts.id),
            ]
          : input.sortBy === 'published'
            ? [
                dir(blogPosts.published),
                desc(blogPosts.createdAt),
                desc(blogPosts.id),
              ]
            : [dir(blogPosts.createdAt), desc(blogPosts.id)]

      const [{ total } = { total: 0 }] = await (where
        ? db
            .select({ total: sql<string>`count(*)::int` })
            .from(blogPosts)
            .leftJoin(users, eq(blogPosts.authorId, users.id))
            .where(where)
        : db
            .select({ total: sql<string>`count(*)::int` })
            .from(blogPosts)
            .leftJoin(users, eq(blogPosts.authorId, users.id)))

      const posts = await (where
        ? db
            .select({
              id: blogPosts.id,
              title: blogPosts.title,
              slug: blogPosts.slug,
              published: blogPosts.published,
              createdAt: blogPosts.createdAt,
              author: {
                id: users.id,
                name: users.name,
                image: users.image,
              },
            })
            .from(blogPosts)
            .leftJoin(users, eq(blogPosts.authorId, users.id))
            .where(where)
            .orderBy(...orderBy)
            .limit(pageSize)
            .offset(offset)
        : db
            .select({
              id: blogPosts.id,
              title: blogPosts.title,
              slug: blogPosts.slug,
              published: blogPosts.published,
              createdAt: blogPosts.createdAt,
              author: {
                id: users.id,
                name: users.name,
                image: users.image,
              },
            })
            .from(blogPosts)
            .leftJoin(users, eq(blogPosts.authorId, users.id))
            .orderBy(...orderBy)
            .limit(pageSize)
            .offset(offset))

      const totalNum = Number(total ?? 0)
      const totalPages = Math.max(1, Math.ceil(totalNum / pageSize))

      return {
        data: posts,
        page,
        pageSize,
        total: totalNum,
        totalPages,
        search: search || null,
        sortBy: input.sortBy,
        sortOrder: input.sortOrder,
      }
    }),

  // Create a new blog post (admin only)
  create: permissionProcedure('blog.manage')
    .input(
      z.object({
        title: z.string().min(1),
        content: z.string().min(1),
        excerpt: z.string().optional(),
        published: z.boolean().default(false),
        authorId: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const slug = generateSlug(input.title)

      // Check if slug already exists
      const existingPost = await db.query.blogPosts.findFirst({
        where: eq(blogPosts.slug, slug),
      })

      if (existingPost) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'A post with a similar title already exists',
        })
      }

      const post = await db
        .insert(blogPosts)
        .values({
          title: input.title,
          slug,
          content: input.content,
          excerpt: input.excerpt || null,
          published: input.published,
          authorId: input.authorId || ctx.session.user.id,
        })
        .returning()

      return post[0]
    }),

  // Update a blog post (admin only)
  update: permissionProcedure('blog.manage')
    .input(
      z.object({
        id: z.number(),
        title: z.string().min(1),
        content: z.string().min(1),
        excerpt: z.string().optional(),
        published: z.boolean(),
        updateSlug: z.boolean().default(false),
        authorId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const post = await db.query.blogPosts.findFirst({
        where: eq(blogPosts.id, input.id),
      })

      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Blog post not found',
        })
      }

      let slug = post.slug
      if (input.updateSlug) {
        slug = generateSlug(input.title)

        // Check if new slug already exists (and it's not the current post)
        const existingPost = await db.query.blogPosts.findFirst({
          where: eq(blogPosts.slug, slug),
        })

        if (existingPost && existingPost.id !== input.id) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'A post with a similar title already exists',
          })
        }
      }

      const updatedPost = await db
        .update(blogPosts)
        .set({
          title: input.title,
          slug,
          content: input.content,
          excerpt: input.excerpt || null,
          published: input.published,
          ...(input.authorId && { authorId: input.authorId }),
        })
        .where(eq(blogPosts.id, input.id))
        .returning()

      return updatedPost[0]
    }),

  // Delete a blog post (admin only)
  delete: permissionProcedure('blog.manage')
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const post = await db.query.blogPosts.findFirst({
        where: eq(blogPosts.id, input.id),
      })

      if (!post) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Blog post not found',
        })
      }

      await db.delete(blogPosts).where(eq(blogPosts.id, input.id))

      return { success: true }
    }),
})
