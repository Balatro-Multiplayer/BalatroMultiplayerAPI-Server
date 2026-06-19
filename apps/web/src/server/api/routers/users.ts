import { asc, desc, eq, ilike, or, sql } from 'drizzle-orm'
import { z } from 'zod'
import { normalizePermissions, PERMISSION_KEYS } from '@/lib/permissions'
import { createTRPCRouter, permissionProcedure } from '@/server/api/trpc'
import { db } from '@/server/db'
import { users } from '@/server/db/schema'

export const usersRouter = createTRPCRouter({
  listUsers: permissionProcedure('permissions.manage')
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(50),
        search: z.string().trim().optional(),
        sortBy: z
          .enum(['name', 'email', 'permissions', 'discord_id'])
          .default('name'),
        sortOrder: z.enum(['asc', 'desc']).default('asc'),
      })
    )
    .query(async ({ input }) => {
      const page = input.page
      const pageSize = input.pageSize
      const offset = (page - 1) * pageSize
      const search = input.search?.trim()

      const where = search
        ? or(
            ilike(users.name, `%${search}%`),
            ilike(users.email, `%${search}%`),
            ilike(users.discord_id, `%${search}%`)
          )
        : undefined

      const dir = input.sortOrder === 'asc' ? asc : desc
      const orderBy =
        input.sortBy === 'email'
          ? [dir(users.email), asc(users.name), asc(users.id)]
          : input.sortBy === 'permissions'
            ? [
                dir(sql<number>`cardinality(${users.permissions})`),
                asc(users.name),
                asc(users.id),
              ]
            : input.sortBy === 'discord_id'
              ? [dir(users.discord_id), asc(users.name), asc(users.id)]
              : [dir(users.name), asc(users.id)]

      const [{ total } = { total: 0 }] = await (where
        ? db
            .select({ total: sql<string>`count(*)::int` })
            .from(users)
            .where(where)
        : db.select({ total: sql<string>`count(*)::int` }).from(users))

      const res = await (where
        ? db
            .select({
              id: users.id,
              name: users.name,
              email: users.email,
              permissions: users.permissions,
              discord_id: users.discord_id,
            })
            .from(users)
            .where(where)
            .orderBy(...orderBy)
            .limit(pageSize)
            .offset(offset)
        : db
            .select({
              id: users.id,
              name: users.name,
              email: users.email,
              permissions: users.permissions,
              discord_id: users.discord_id,
            })
            .from(users)
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

  updateUserPermissions: permissionProcedure('permissions.manage')
    .input(
      z.object({
        userId: z.string(),
        permissions: z.array(z.enum(PERMISSION_KEYS)),
      })
    )
    .mutation(async ({ input }) => {
      const nextPermissions = normalizePermissions(input.permissions)
      const [currentUser] = await db
        .select({
          id: users.id,
          permissions: users.permissions,
        })
        .from(users)
        .where(eq(users.id, input.userId))

      if (!currentUser) {
        throw new Error('User not found')
      }

      const currentlyCanManagePermissions =
        currentUser.permissions.includes('permissions.manage')
      const willManagePermissions =
        nextPermissions.includes('permissions.manage')

      if (currentlyCanManagePermissions && !willManagePermissions) {
        const [{ total } = { total: 0 }] = await db
          .select({
            total: sql<string>`count(*)::int`,
          })
          .from(users)
          .where(
            sql`array_position(${users.permissions}, 'permissions.manage') is not null`
          )

        if (Number(total ?? 0) <= 1) {
          throw new Error(
            'Cannot remove permissions from the last remaining permissions manager'
          )
        }
      }

      const updated = await db
        .update(users)
        .set({ permissions: nextPermissions })
        .where(eq(users.id, input.userId))
        .returning({ id: users.id, permissions: users.permissions })

      return updated[0]
    }),
})
