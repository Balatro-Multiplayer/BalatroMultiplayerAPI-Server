import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '@/server/api/trpc'
import { botlatro_service } from '@/server/services/botlatro.service'
import { DISCORD_SNOWFLAKE_REGEX } from '@/shared/discord'

const discordIdSchema = z
  .string()
  .regex(DISCORD_SNOWFLAKE_REGEX, 'Invalid Discord user ID')

export const moderationRouter = createTRPCRouter({
  listPlayersWithStrikes: permissionProcedure('moderation.view')
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
        search: z.string().trim().optional(),
        sort: z.enum(['recent', 'alphabetical']).default('recent'),
        includeBans: z.boolean().default(false),
      })
    )
    .query(async ({ input }) => {
      return botlatro_service.listPlayersWithStrikes({
        page: input.page,
        limit: input.limit,
        search: input.search,
        sort: input.sort,
        include_bans: input.includeBans,
      })
    }),

  getUserStrikes: permissionProcedure('moderation.view')
    .input(
      z.object({
        user_id: discordIdSchema,
      })
    )
    .query(async ({ input }) => {
      return botlatro_service.getUserStrikes(input.user_id)
    }),

  giveStrike: permissionProcedure('moderation.strikes.manage')
    .input(
      z.object({
        user_id: discordIdSchema,
        amount: z.number().int().min(0).max(6),
        reason: z.string().trim().min(1).max(500),
        reference: z.string().trim().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return botlatro_service.giveStrike({
        ...input,
        issued_by_id: ctx.session.user.discord_id,
      })
    }),

  removeStrike: permissionProcedure('moderation.strikes.manage')
    .input(
      z.object({
        id: z.number().int().positive(),
        reason: z.string().trim().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return botlatro_service.removeStrike({
        id: input.id,
        reason: input.reason,
        removed_by_id: ctx.session.user.discord_id,
      })
    }),

  listActiveBans: permissionProcedure('moderation.view')
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
        search: z.string().trim().optional(),
      })
    )
    .query(async ({ input }) => {
      return botlatro_service.listActiveBans(input)
    }),

  banUser: permissionProcedure('moderation.bans.manage')
    .input(
      z.object({
        user_id: discordIdSchema,
        length: z.number().min(0),
        reason: z.string().trim().min(1).max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return botlatro_service.banUser({
        ...input,
        banned_by_id: ctx.session.user.discord_id,
      })
    }),

  updateBanUser: permissionProcedure('moderation.bans.manage')
    .input(
      z
        .object({
          user_id: discordIdSchema,
          length: z.number().min(0).optional(),
          reason: z.string().trim().min(1).max(500).optional(),
        })
        .refine(
          (input) => input.length !== undefined || input.reason !== undefined,
          {
            message: 'Provide at least one field to update.',
          }
        )
    )
    .mutation(async ({ ctx, input }) => {
      return botlatro_service.updateBanUser({
        ...input,
        updated_by_id: ctx.session.user.discord_id,
      })
    }),

  unbanUser: permissionProcedure('moderation.bans.manage')
    .input(
      z.object({
        user_id: discordIdSchema,
        reason: z.string().trim().min(1).max(500),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return botlatro_service.unbanUser({
        ...input,
        unbanned_by_id: ctx.session.user.discord_id,
      })
    }),

  listAllMembers: permissionProcedure('moderation.view')
    .input(
      z.object({
        page: z.number().int().min(1).default(1),
        limit: z.number().int().min(1).max(100).default(20),
        search: z.string().trim().optional(),
        filter: z.enum(['all', 'banned', 'striked']).default('all'),
        sort: z.enum(['recent', 'alphabetical']).default('alphabetical'),
      })
    )
    .query(async ({ input }) => {
      return botlatro_service.listAllMembers(input)
    }),

  searchGuildMembers: permissionProcedure('moderation.view')
    .input(
      z.object({
        q: z.string().trim().min(1),
      })
    )
    .query(async ({ input }) => {
      return botlatro_service.searchGuildMembers(input.q)
    }),
})
