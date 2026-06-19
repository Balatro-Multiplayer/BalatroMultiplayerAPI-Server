import { z } from 'zod'
import { createTRPCRouter, permissionProcedure } from '@/server/api/trpc'
import { botlatro_service } from '@/server/services/botlatro.service'

export const queuesRouter = createTRPCRouter({
  getSettings: permissionProcedure('queues.manage').query(async () => {
    return botlatro_service.getQueueSettings()
  }),

  lockAll: permissionProcedure('queues.manage').mutation(async ({ ctx }) => {
    return botlatro_service.lockAllQueues(ctx.session.user.discord_id)
  }),

  updateSettings: permissionProcedure('queues.manage')
    .input(
      z.object({
        id: z.number(),
        settings: z.object({
          queue_desc: z.string().optional(),
          queue_icon: z.string().nullable().optional(),
          color: z.string().optional(),
          default_elo: z.number().optional(),
          members_per_team: z.number().optional(),
          number_of_teams: z.number().optional(),
          elo_search_start: z.number().optional(),
          elo_search_increment: z.number().optional(),
          elo_search_speed: z.number().optional(),
          max_party_elo_difference: z.number().nullable().optional(),
          best_of_allowed: z.boolean().optional(),
          first_deck_ban_num: z.number().optional(),
          second_deck_ban_num: z.number().optional(),
          use_tuple_bans: z.boolean().optional(),
          role_lock_id: z.string().nullable().optional(),
          veto_mmr_threshold: z.number().nullable().optional(),
          instaqueue_min: z.number().optional(),
          instaqueue_max: z.number().optional(),
          locked: z.boolean().optional(),
        }),
      })
    )
    .mutation(async ({ input }) => {
      return botlatro_service.updateQueueSettings(input.id, input.settings)
    }),
})
