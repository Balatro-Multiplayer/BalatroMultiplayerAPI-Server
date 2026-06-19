import { asc, desc, eq, sql } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '@/server/api/trpc'
import {
  listBannedUserRegistryEntries,
  normalizeBannedUserValues,
} from '@/server/banned-users'
import { db } from '@/server/db'
import {
  bannedUserAliases,
  bannedUserIds,
  bannedUsers,
} from '@/server/db/schema'

const sortableColumns = ['label', 'updatedAt', 'createdAt'] as const

const saveBannedUserSchema = z
  .object({
    id: z.number().int().positive().optional(),
    label: z.string().trim().min(1).max(120),
    aliases: z.array(z.string()).default([]),
    ids: z.array(z.string()).default([]),
  })
  .superRefine((input, ctx) => {
    const aliases = normalizeBannedUserValues(input.aliases)
    const ids = normalizeBannedUserValues(input.ids)

    if (aliases.length === 0 && ids.length === 0) {
      ctx.addIssue({
        code: 'custom',
        message: 'Add at least one alias or one id.',
        path: ['aliases'],
      })
    }
  })

export const bannedUsersRouter = createTRPCRouter({
  list: permissionProcedure('banned_users.manage')
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(50),
        search: z.string().trim().optional(),
        sortBy: z.enum(sortableColumns).default('updatedAt'),
        sortOrder: z.enum(['asc', 'desc']).default('desc'),
      })
    )
    .query(async ({ input }) => {
      const page = input.page
      const pageSize = input.pageSize
      const offset = (page - 1) * pageSize
      const search = input.search?.trim()

      const where = search
        ? sql`
            ${bannedUsers.label} ilike ${`%${search}%`}
            or exists (
              select 1
              from ${bannedUserAliases}
              where
                ${bannedUserAliases.bannedUserId} = ${bannedUsers.id}
                and ${bannedUserAliases.alias} ilike ${`%${search}%`}
            )
            or exists (
              select 1
              from ${bannedUserIds}
              where
                ${bannedUserIds.bannedUserId} = ${bannedUsers.id}
                and ${bannedUserIds.value} ilike ${`%${search}%`}
            )
          `
        : undefined

      const dir = input.sortOrder === 'asc' ? asc : desc
      const orderBy =
        input.sortBy === 'label'
          ? [dir(bannedUsers.label), asc(bannedUsers.id)]
          : input.sortBy === 'createdAt'
            ? [dir(bannedUsers.createdAt), desc(bannedUsers.id)]
            : [dir(bannedUsers.updatedAt), desc(bannedUsers.id)]

      const [{ total } = { total: 0 }] = await (where
        ? db
            .select({ total: sql<string>`count(*)::int` })
            .from(bannedUsers)
            .where(where)
        : db.select({ total: sql<string>`count(*)::int` }).from(bannedUsers))

      const rows = await (where
        ? db
            .select({
              id: bannedUsers.id,
            })
            .from(bannedUsers)
            .where(where)
            .orderBy(...orderBy)
            .limit(pageSize)
            .offset(offset)
        : db
            .select({
              id: bannedUsers.id,
            })
            .from(bannedUsers)
            .orderBy(...orderBy)
            .limit(pageSize)
            .offset(offset))

      const entries = await listBannedUserRegistryEntries(
        rows.map((row) => row.id)
      )
      const totalNum = Number(total ?? 0)

      return {
        data: entries,
        page,
        pageSize,
        total: totalNum,
        totalPages: Math.max(1, Math.ceil(totalNum / pageSize)),
        search: search || null,
        sortBy: input.sortBy,
        sortOrder: input.sortOrder,
      }
    }),

  save: permissionProcedure('banned_users.manage')
    .input(saveBannedUserSchema)
    .mutation(async ({ input }) => {
      const aliases = normalizeBannedUserValues(input.aliases)
      const ids = normalizeBannedUserValues(input.ids)

      const entryId = await db.transaction(async (tx) => {
        const label = input.label.trim()

        if (input.id) {
          const [existing] = await tx
            .select({ id: bannedUsers.id })
            .from(bannedUsers)
            .where(eq(bannedUsers.id, input.id))

          if (!existing) {
            throw new Error('Entry not found')
          }

          await tx
            .update(bannedUsers)
            .set({ label, updatedAt: new Date() })
            .where(eq(bannedUsers.id, input.id))

          await tx
            .delete(bannedUserAliases)
            .where(eq(bannedUserAliases.bannedUserId, input.id))
          await tx
            .delete(bannedUserIds)
            .where(eq(bannedUserIds.bannedUserId, input.id))

          if (aliases.length > 0) {
            await tx.insert(bannedUserAliases).values(
              aliases.map((alias) => ({
                bannedUserId: input.id as number,
                alias: alias.value,
                aliasLower: alias.valueLower,
              }))
            )
          }

          if (ids.length > 0) {
            await tx.insert(bannedUserIds).values(
              ids.map((value) => ({
                bannedUserId: input.id as number,
                value: value.value,
                valueLower: value.valueLower,
              }))
            )
          }

          return input.id
        }

        const [created] = await tx
          .insert(bannedUsers)
          .values({ label })
          .returning({ id: bannedUsers.id })

        if (!created) {
          throw new Error('Failed to create entry')
        }

        if (aliases.length > 0) {
          await tx.insert(bannedUserAliases).values(
            aliases.map((alias) => ({
              bannedUserId: created.id,
              alias: alias.value,
              aliasLower: alias.valueLower,
            }))
          )
        }

        if (ids.length > 0) {
          await tx.insert(bannedUserIds).values(
            ids.map((value) => ({
              bannedUserId: created.id,
              value: value.value,
              valueLower: value.valueLower,
            }))
          )
        }

        return created.id
      })

      const [entry] = await listBannedUserRegistryEntries([entryId])
      if (!entry) {
        throw new Error('Entry not found after save')
      }

      return entry
    }),

  delete: permissionProcedure('banned_users.manage')
    .input(
      z.object({
        id: z.number().int().positive(),
      })
    )
    .mutation(async ({ input }) => {
      await db.delete(bannedUsers).where(eq(bannedUsers.id, input.id))
      return { success: true }
    }),
})
