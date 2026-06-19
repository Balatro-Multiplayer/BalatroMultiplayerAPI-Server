import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { env } from '@/env'
import { createTRPCRouter, protectedProcedure } from '@/server/api/trpc'
import { db } from '@/server/db'
import { seasonSnapshots, users } from '@/server/db/schema'
import { ensureBucketExists, minioClient } from '@/server/minio'
import { redis } from '@/server/redis'

export const profileRouter = createTRPCRouter({
  getSocialLinks: protectedProcedure.query(async ({ ctx }) => {
    const user = await db.query.users.findFirst({
      where: eq(users.id, ctx.session.user.id),
      columns: {
        twitch_url: true,
        youtube_url: true,
      },
    })
    return {
      twitch_url: user?.twitch_url || null,
      youtube_url: user?.youtube_url || null,
    }
  }),

  updateSocialLinks: protectedProcedure
    .input(
      z.object({
        twitch_url: z.string().url().nullable(),
        youtube_url: z.string().url().nullable(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await db
        .update(users)
        .set({
          twitch_url: input.twitch_url,
          youtube_url: input.youtube_url,
        })
        .where(eq(users.id, ctx.session.user.id))

      return { success: true }
    }),

  renameOnLeaderboards: protectedProcedure
    .input(z.object({ newName: z.string().min(1).max(50).trim() }))
    .mutation(async ({ ctx, input }) => {
      const user = await db.query.users.findFirst({
        where: eq(users.id, ctx.session.user.id),
        columns: { discord_id: true, name: true },
      })

      if (!user?.discord_id) {
        throw new Error('No Discord account linked')
      }

      const snapshots = await db
        .select({
          id: seasonSnapshots.id,
          seasonId: seasonSnapshots.seasonId,
          queueType: seasonSnapshots.queueType,
          queueId: seasonSnapshots.queueId,
          minioKey: seasonSnapshots.minioKey,
        })
        .from(seasonSnapshots)

      let totalUpdated = 0

      for (const snapshot of snapshots) {
        if (!snapshot.minioKey) continue

        const stream = await minioClient.getObject(
          env.MINIO_LEADERBOARD_BUCKET_NAME,
          snapshot.minioKey
        )
        const chunks: Buffer[] = []
        for await (const chunk of stream) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
        }
        const raw = Buffer.concat(chunks).toString('utf-8')
        const payload = JSON.parse(raw) as unknown

        const result = renamePlayerInPayload(
          payload,
          user.discord_id,
          input.newName
        )
        if (result.updatedCount === 0) continue

        await ensureBucketExists(env.MINIO_LEADERBOARD_BUCKET_NAME)

        const nextKey = `leaderboard-snapshots/season${snapshot.seasonId}/${snapshot.queueType}-${Date.now()}.json`
        const buf = Buffer.from(JSON.stringify(result.updatedPayload))

        await minioClient.putObject(
          env.MINIO_LEADERBOARD_BUCKET_NAME,
          nextKey,
          buf,
          buf.length,
          { 'Content-Type': 'application/json' }
        )

        await db
          .update(seasonSnapshots)
          .set({ minioKey: nextKey, uploadedBy: 'profile-settings' })
          .where(eq(seasonSnapshots.id, snapshot.id))

        if (snapshot.minioKey !== nextKey) {
          await minioClient
            .removeObject(env.MINIO_LEADERBOARD_BUCKET_NAME, snapshot.minioKey)
            .catch(() => undefined)
        }

        await redis.del(
          `season:${snapshot.seasonId}:leaderboard:${snapshot.queueId}`
        )
        await redis.del(`config:season:${snapshot.seasonId}:queues`)

        totalUpdated += result.updatedCount
      }

      return { updated: totalUpdated }
    }),
})

function renameInEntryList(
  entries: unknown[],
  discordId: string,
  newName: string
) {
  let updatedCount = 0
  const updatedEntries = entries.map((entry) => {
    if (!entry || typeof entry !== 'object') return entry
    const id = String((entry as { id?: unknown }).id ?? '')
    if (id !== discordId) return entry
    updatedCount += 1
    return { ...(entry as Record<string, unknown>), name: newName }
  })
  return { updatedEntries, updatedCount }
}

function renamePlayerInPayload(
  payload: unknown,
  discordId: string,
  newName: string
): { updatedPayload: unknown; updatedCount: number } {
  if (Array.isArray(payload)) {
    const r = renameInEntryList(payload, discordId, newName)
    return { updatedPayload: r.updatedEntries, updatedCount: r.updatedCount }
  }

  if (!payload || typeof payload !== 'object') {
    return { updatedPayload: payload, updatedCount: 0 }
  }

  const obj = payload as Record<string, unknown>

  for (const key of ['leaderboard', 'data', 'alltime']) {
    if (Array.isArray(obj[key])) {
      const r = renameInEntryList(obj[key] as unknown[], discordId, newName)
      return {
        updatedPayload: { ...obj, [key]: r.updatedEntries },
        updatedCount: r.updatedCount,
      }
    }
  }

  return { updatedPayload: payload, updatedCount: 0 }
}
