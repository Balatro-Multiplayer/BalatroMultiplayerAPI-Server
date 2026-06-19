import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, publicProcedure } from '@/server/api/trpc'
import { db } from '@/server/db'
import { users } from '@/server/db/schema'
import { botlatro_service } from '@/server/services/botlatro.service'
import { discord_service } from '@/server/services/discord.service'
import { DISCORD_SNOWFLAKE_REGEX } from '@/shared/discord'

export const playersRouter = createTRPCRouter({
  get_user_by_id: publicProcedure
    .input(
      z.object({
        user_id: z
          .string()
          .regex(DISCORD_SNOWFLAKE_REGEX, 'Invalid Discord user ID'),
      })
    )
    .query(async ({ input }) => {
      const userData = await db.query.users.findFirst({
        where: eq(users.discord_id, input.user_id),
        columns: {
          twitch_url: true,
          youtube_url: true,
        },
      })

      try {
        const member = await botlatro_service.getUser(input.user_id)

        return {
          username: member.username,
          display_name: member.display_name,
          avatar_url:
            member.avatar_url ??
            'https://cdn.discordapp.com/embed/avatars/0.png',
          twitch_url: userData?.twitch_url || null,
          youtube_url: userData?.youtube_url || null,
          active_ban: member.active_ban,
        }
      } catch {
        console.log(
          `[players] User ${input.user_id} not found in guild_members, falling back to Discord API`
        )
      }

      const discordUser = await discord_service.get_user_by_id(input.user_id)

      return {
        username: discordUser.username,
        display_name: discordUser.global_name ?? discordUser.username,
        avatar_url: discordUser.avatar_url,
        twitch_url: userData?.twitch_url || null,
        youtube_url: userData?.youtube_url || null,
        active_ban: null,
      }
    }),
})
