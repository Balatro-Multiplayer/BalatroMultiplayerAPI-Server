import { asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  createTRPCRouter,
  permissionProcedure,
  publicProcedure,
} from '@/server/api/trpc'
import { db } from '@/server/db'
import { branches, releases } from '@/server/db/schema'

export const releasesRouter = createTRPCRouter({
  getReleases: publicProcedure
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(50),
        search: z.string().trim().optional(),
        sortBy: z
          .enum(['createdAt', 'name', 'version', 'branchName'])
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
            ilike(releases.name, `%${search}%`),
            ilike(releases.version, `%${search}%`),
            ilike(releases.description, `%${search}%`),
            ilike(branches.name, `%${search}%`)
          )
        : undefined

      const dir = input.sortOrder === 'asc' ? asc : desc
      const orderBy =
        input.sortBy === 'name'
          ? [dir(releases.name), desc(releases.createdAt), desc(releases.id)]
          : input.sortBy === 'version'
            ? [
                dir(releases.version),
                desc(releases.createdAt),
                desc(releases.id),
              ]
            : input.sortBy === 'branchName'
              ? [
                  dir(branches.name),
                  desc(releases.createdAt),
                  desc(releases.id),
                ]
              : [dir(releases.createdAt), desc(releases.id)]

      const [{ total } = { total: 0 }] = await (where
        ? db
            .select({ total: sql<string>`count(*)::int` })
            .from(releases)
            .leftJoin(branches, eq(releases.branchId, branches.id))
            .where(where)
        : db
            .select({ total: sql<string>`count(*)::int` })
            .from(releases)
            .leftJoin(branches, eq(releases.branchId, branches.id)))

      const res = await (where
        ? db
            .select({
              id: releases.id,
              name: releases.name,
              description: releases.description,
              version: releases.version,
              url: releases.url,
              smods_version: releases.smods_version,
              lovely_version: releases.lovely_version,
              branchId: releases.branchId,
              branchName: branches.name,
              createdAt: releases.createdAt,
              updatedAt: releases.updatedAt,
            })
            .from(releases)
            .leftJoin(branches, eq(releases.branchId, branches.id))
            .where(where)
            .orderBy(...orderBy)
            .limit(pageSize)
            .offset(offset)
        : db
            .select({
              id: releases.id,
              name: releases.name,
              description: releases.description,
              version: releases.version,
              url: releases.url,
              smods_version: releases.smods_version,
              lovely_version: releases.lovely_version,
              branchId: releases.branchId,
              branchName: branches.name,
              createdAt: releases.createdAt,
              updatedAt: releases.updatedAt,
            })
            .from(releases)
            .leftJoin(branches, eq(releases.branchId, branches.id))
            .orderBy(...orderBy)
            .limit(pageSize)
            .offset(offset))

      const totalNum = Number(total ?? 0)
      const totalPages = Math.max(1, Math.ceil(totalNum / pageSize))

      return {
        data: res,
        page,
        pageSize,
        total: totalNum,
        totalPages,
        search: search || null,
        sortBy: input.sortBy,
        sortOrder: input.sortOrder,
      }
    }),
  addRelease: permissionProcedure('releases.manage')
    .input(
      z.object({
        version: z.string(),
        url: z.string(),
        name: z.string(),
        description: z.string(),
        smods_version: z.string().default('latest'),
        lovely_version: z.string().default('latest'),
        branchId: z.number().default(1),
      })
    )
    .mutation(async ({ input }) => {
      const res = await db
        .insert(releases)
        .values({
          version: input.version,
          url: input.url,
          name: input.name,
          description: input.description,
          smods_version: input.smods_version,
          lovely_version: input.lovely_version,
          branchId: input.branchId,
        })
        .returning()

      return res[0]
    }),
  updateRelease: permissionProcedure('releases.manage')
    .input(
      z.object({
        id: z.number(),
        version: z.string(),
        url: z.string(),
        name: z.string(),
        description: z.string(),
        smods_version: z.string().default('latest'),
        lovely_version: z.string().default('latest'),
        branchId: z.number().default(1),
      })
    )
    .mutation(async ({ input }) => {
      const res = await db
        .update(releases)
        .set({
          version: input.version,
          url: input.url,
          name: input.name,
          description: input.description,
          smods_version: input.smods_version,
          lovely_version: input.lovely_version,
          branchId: input.branchId,
        })
        .where(eq(releases.id, input.id))
        .returning()

      return res[0]
    }),
  deleteRelease: permissionProcedure('releases.manage')
    .input(
      z.object({
        id: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      await db.delete(releases).where(eq(releases.id, input.id))

      return { success: true }
    }),
})
