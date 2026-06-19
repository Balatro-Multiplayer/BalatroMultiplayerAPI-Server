import { eq } from 'drizzle-orm'
import { z } from 'zod'
import {
  createTRPCRouter,
  permissionProcedure,
  publicProcedure,
} from '@/server/api/trpc'
import { db } from '@/server/db'
import { branches } from '@/server/db/schema'

export const branchesRouter = createTRPCRouter({
  getBranches: publicProcedure.query(async () => {
    const res = await db.select().from(branches)
    return res
  }),
  addBranch: permissionProcedure('releases.manage')
    .input(
      z.object({
        name: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      try {
        const res = await db
          .insert(branches)
          .values({
            name: input.name,
          })
          .returning()

        return res[0]
      } catch (error) {
        // Handle unique constraint violation
        if (
          error instanceof Error &&
          error.message.includes('unique constraint')
        ) {
          throw new Error('Branch with this name already exists')
        }
        throw error
      }
    }),
  deleteBranch: permissionProcedure('releases.manage')
    .input(
      z.object({
        id: z.number(),
      })
    )
    .mutation(async ({ input }) => {
      await db.delete(branches).where(eq(branches.id, input.id))

      return { success: true }
    }),
})
