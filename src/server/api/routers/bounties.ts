import { z } from 'zod'
import { createTRPCRouter, publicProcedure } from '@/server/api/trpc'
import { botlatro_service } from '@/server/services/botlatro.service'
import { DISCORD_SNOWFLAKE_REGEX } from '@/shared/discord'

export const bountiesRouter = createTRPCRouter({
  get_user_bounties: publicProcedure
    .input(
      z.object({
        user_id: z
          .string()
          .regex(DISCORD_SNOWFLAKE_REGEX, 'Invalid Discord user ID'),
      })
    )
    .query(async ({ input }) => {
      return botlatro_service.get_user_bounties(input.user_id)
    }),

  get_bounty_completions: publicProcedure
    .input(z.object({ bounty_name: z.string().min(1) }))
    .query(async ({ input }) => {
      return botlatro_service.get_bounty_completions(input.bounty_name)
    }),
})
