import { TRPCError } from '@trpc/server'
import { and, asc, desc, eq, lt, ne } from 'drizzle-orm'
import { z } from 'zod'
import { env } from '@/env'
import {
  createTRPCRouter,
  permissionProcedure,
  publicProcedure,
} from '@/server/api/trpc'
import { seasonSnapshots, seasons } from '@/server/db/schema'
import { ensureBucketExists, minioClient } from '@/server/minio'
import { redis } from '@/server/redis'
import { SEASONS_CACHE_KEY } from '@/server/seasons'

const ACTIVE_SEASON_CACHE_KEY = 'config:active_season'

const seasonInputSchema = z.object({
  name: z.string().trim().min(1),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().nullable().optional(),
  isActive: z.boolean().default(false),
})

const binaryPayloadSchema = z.custom<Uint8Array | Buffer | number[]>(
  (value) =>
    value instanceof Uint8Array ||
    Buffer.isBuffer(value) ||
    (Array.isArray(value) &&
      value.every(
        (item) =>
          typeof item === 'number' &&
          Number.isInteger(item) &&
          item >= 0 &&
          item <= 255
      )),
  'Expected binary payload'
)

type SnapshotCacheRow = {
  id: number
  seasonId: number
  queueType: string
  queueId: string
  sortOrder: number
  minioKey: string | null
  uploadedBy: string | null
  createdAt: string
}

type DbClient = typeof import('@/server/db').db

function getSeasonQueuesCacheKey(seasonId: number) {
  return `config:season:${seasonId}:queues`
}

function getSeasonLeaderboardKey(seasonId: number, queueId: string) {
  return `season:${seasonId}:leaderboard:${queueId}`
}

function serializeSnapshots(rows: SnapshotCacheRow[]) {
  return JSON.stringify(rows)
}

function deserializeSnapshots(value: string): SnapshotCacheRow[] {
  return (
    JSON.parse(value) as Array<
      Omit<SnapshotCacheRow, 'sortOrder'> & { sortOrder?: number }
    >
  ).map((row, index) => ({
    ...row,
    sortOrder: row.sortOrder ?? index,
  }))
}

function toSnapshotCacheRow(row: {
  id: number
  seasonId: number
  queueType: string
  queueId: string
  sortOrder: number
  minioKey: string | null
  uploadedBy: string | null
  createdAt: Date
}): SnapshotCacheRow {
  return {
    id: row.id,
    seasonId: row.seasonId,
    queueType: row.queueType,
    queueId: row.queueId,
    sortOrder: row.sortOrder,
    minioKey: row.minioKey,
    uploadedBy: row.uploadedBy,
    createdAt: row.createdAt.toISOString(),
  }
}

async function getNextSnapshotSortOrder(db: DbClient, seasonId: number) {
  const lastSnapshot = await db
    .select({
      sortOrder: seasonSnapshots.sortOrder,
    })
    .from(seasonSnapshots)
    .where(eq(seasonSnapshots.seasonId, seasonId))
    .orderBy(desc(seasonSnapshots.sortOrder), desc(seasonSnapshots.id))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  return (lastSnapshot?.sortOrder ?? -1) + 1
}

async function getSeasonByIdOrThrow(db: DbClient, seasonId: number) {
  const season = await db
    .select()
    .from(seasons)
    .where(eq(seasons.id, seasonId))
    .limit(1)
    .then((rows) => rows[0])

  if (!season) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `Season ${seasonId} not found`,
    })
  }

  return season
}

async function getSnapshotByQueueTypeOrThrow(
  db: DbClient,
  seasonId: number,
  queueType: string
) {
  const snapshot = await db
    .select()
    .from(seasonSnapshots)
    .where(
      and(
        eq(seasonSnapshots.seasonId, seasonId),
        eq(seasonSnapshots.queueType, queueType)
      )
    )
    .limit(1)
    .then((rows) => rows[0])

  if (!snapshot) {
    throw new TRPCError({
      code: 'NOT_FOUND',
      message: `Queue ${queueType} not found for season ${seasonId}`,
    })
  }

  return snapshot
}

async function getSnapshotByQueueType(
  db: DbClient,
  seasonId: number,
  queueType: string
) {
  return db
    .select()
    .from(seasonSnapshots)
    .where(
      and(
        eq(seasonSnapshots.seasonId, seasonId),
        eq(seasonSnapshots.queueType, queueType)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)
}

async function loadSeasonSnapshotsForCache(db: DbClient, seasonId: number) {
  const rows = await db
    .select()
    .from(seasonSnapshots)
    .where(eq(seasonSnapshots.seasonId, seasonId))
    .orderBy(asc(seasonSnapshots.sortOrder), asc(seasonSnapshots.id))

  return rows.map(toSnapshotCacheRow)
}

async function refreshSeasonSnapshotsCache(db: DbClient, seasonId: number) {
  const rows = await loadSeasonSnapshotsForCache(db, seasonId)
  await redis.set(getSeasonQueuesCacheKey(seasonId), serializeSnapshots(rows))
  return rows
}

function toBuffer(payload: Uint8Array | Buffer | number[]) {
  if (Buffer.isBuffer(payload)) return payload
  if (payload instanceof Uint8Array) return Buffer.from(payload)
  return Buffer.from(payload)
}

async function removeMinioObjectIfExists(minioKey: string | null) {
  if (!minioKey) return

  try {
    await minioClient.removeObject(env.MINIO_LEADERBOARD_BUCKET_NAME, minioKey)
  } catch (error) {
    console.error(`Failed deleting MinIO object ${minioKey}:`, error)
  }
}

export const seasonsRouter = createTRPCRouter({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(seasons).orderBy(asc(seasons.id))
  }),

  create: permissionProcedure('seasons.manage')
    .input(seasonInputSchema)
    .mutation(async ({ ctx, input }) => {
      const createdSeason = await ctx.db.transaction(async (tx) => {
        if (input.isActive) {
          await tx.update(seasons).set({ isActive: false })
        }

        const [created] = await tx
          .insert(seasons)
          .values({
            name: input.name,
            startDate: input.startDate,
            endDate: input.endDate ?? null,
            isActive: input.isActive,
          })
          .returning()

        if (!created) {
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed creating season',
          })
        }

        const previousSeason = await tx
          .select({ id: seasons.id })
          .from(seasons)
          .where(lt(seasons.id, created.id))
          .orderBy(desc(seasons.id))
          .limit(1)
          .then((rows) => rows[0])

        if (previousSeason) {
          const previousQueues = await tx
            .select({
              queueType: seasonSnapshots.queueType,
              queueId: seasonSnapshots.queueId,
              sortOrder: seasonSnapshots.sortOrder,
            })
            .from(seasonSnapshots)
            .where(eq(seasonSnapshots.seasonId, previousSeason.id))
            .orderBy(asc(seasonSnapshots.sortOrder), asc(seasonSnapshots.id))

          if (previousQueues.length > 0) {
            await tx.insert(seasonSnapshots).values(
              previousQueues.map((queue) => ({
                seasonId: created.id,
                queueType: queue.queueType,
                queueId: queue.queueId,
                sortOrder: queue.sortOrder,
                minioKey: null,
                uploadedBy: null,
              }))
            )
          }
        }

        return created
      })

      await redis.del(SEASONS_CACHE_KEY)
      if (createdSeason.isActive) {
        await redis.set(ACTIVE_SEASON_CACHE_KEY, createdSeason.id.toString())
      }
      await refreshSeasonSnapshotsCache(ctx.db, createdSeason.id)

      return createdSeason
    }),

  update: permissionProcedure('seasons.manage')
    .input(
      seasonInputSchema.extend({
        id: z.number().int().positive(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const existingSeason = await getSeasonByIdOrThrow(ctx.db, input.id)

      const [updatedSeason] = await ctx.db.transaction(async (tx) => {
        if (input.isActive) {
          await tx
            .update(seasons)
            .set({ isActive: false })
            .where(ne(seasons.id, input.id))
        }

        return tx
          .update(seasons)
          .set({
            name: input.name,
            startDate: input.startDate,
            endDate: input.endDate ?? null,
            isActive: input.isActive,
          })
          .where(eq(seasons.id, input.id))
          .returning()
      })

      if (!updatedSeason) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed updating season',
        })
      }

      await redis.del(SEASONS_CACHE_KEY)
      if (updatedSeason.isActive) {
        await redis.set(ACTIVE_SEASON_CACHE_KEY, updatedSeason.id.toString())
      } else if (existingSeason.isActive) {
        await redis.del(ACTIVE_SEASON_CACHE_KEY)
      }

      return updatedSeason
    }),

  list_snapshots: publicProcedure
    .input(
      z.object({
        seasonId: z.number().int().positive(),
      })
    )
    .query(async ({ ctx, input }) => {
      await getSeasonByIdOrThrow(ctx.db, input.seasonId)

      const cached = await redis.get(getSeasonQueuesCacheKey(input.seasonId))
      if (cached) {
        return deserializeSnapshots(cached)
      }

      return refreshSeasonSnapshotsCache(ctx.db, input.seasonId)
    }),

  upsert_queue: permissionProcedure('seasons.manage')
    .input(
      z.object({
        seasonId: z.number().int().positive(),
        queueType: z.string().trim().min(1),
        queueId: z.string().trim().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await getSeasonByIdOrThrow(ctx.db, input.seasonId)
      const sortOrder = await getNextSnapshotSortOrder(ctx.db, input.seasonId)

      const [snapshot] = await ctx.db
        .insert(seasonSnapshots)
        .values({
          seasonId: input.seasonId,
          queueType: input.queueType,
          queueId: input.queueId,
          sortOrder,
        })
        .onConflictDoUpdate({
          target: [seasonSnapshots.seasonId, seasonSnapshots.queueType],
          set: {
            queueId: input.queueId,
          },
        })
        .returning()

      if (!snapshot) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed upserting queue',
        })
      }

      await redis.del(getSeasonQueuesCacheKey(input.seasonId))

      return snapshot
    }),

  upload_snapshot: permissionProcedure('seasons.manage')
    .input(
      z.object({
        seasonId: z.number().int().positive(),
        queueType: z.string().trim().min(1),
        queueId: z.string().trim().min(1).optional(),
        fileName: z.string().trim().min(1).optional(),
        contentType: z.string().trim().min(1).optional(),
        buffer: binaryPayloadSchema,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const season = await getSeasonByIdOrThrow(ctx.db, input.seasonId)
      const existingSnapshot = await getSnapshotByQueueType(
        ctx.db,
        input.seasonId,
        input.queueType
      )
      const nextSortOrder = existingSnapshot
        ? existingSnapshot.sortOrder
        : await getNextSnapshotSortOrder(ctx.db, input.seasonId)

      const buffer = toBuffer(input.buffer)
      JSON.parse(buffer.toString('utf-8'))

      const objectKey = `leaderboard-snapshots/season${season.id}/${input.queueType}-${Date.now()}.json`

      await ensureBucketExists(env.MINIO_LEADERBOARD_BUCKET_NAME)
      await minioClient.putObject(
        env.MINIO_LEADERBOARD_BUCKET_NAME,
        objectKey,
        buffer,
        buffer.length,
        {
          'Content-Type': input.contentType ?? 'application/json',
        }
      )

      const resolvedQueueId = existingSnapshot?.queueId ?? input.queueId

      if (!resolvedQueueId) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: `Queue ${input.queueType} is missing a queueId`,
        })
      }

      const [updatedSnapshot] = existingSnapshot
        ? await ctx.db
            .update(seasonSnapshots)
            .set({
              queueId: resolvedQueueId,
              minioKey: objectKey,
              uploadedBy: ctx.session.user.id,
            })
            .where(eq(seasonSnapshots.id, existingSnapshot.id))
            .returning()
        : await ctx.db
            .insert(seasonSnapshots)
            .values({
              seasonId: input.seasonId,
              queueType: input.queueType,
              queueId: resolvedQueueId,
              sortOrder: nextSortOrder,
              minioKey: objectKey,
              uploadedBy: ctx.session.user.id,
            })
            .returning()

      if (!updatedSnapshot) {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed updating snapshot',
        })
      }

      await removeMinioObjectIfExists(existingSnapshot?.minioKey ?? null)
      await redis.del(getSeasonLeaderboardKey(season.id, resolvedQueueId))
      await redis.del(getSeasonQueuesCacheKey(season.id))

      return {
        ...updatedSnapshot,
        fileName: input.fileName ?? `${input.queueType}.json`,
      }
    }),

  delete_queue: permissionProcedure('seasons.manage')
    .input(
      z.object({
        seasonId: z.number().int().positive(),
        queueType: z.string().trim().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const snapshot = await getSnapshotByQueueTypeOrThrow(
        ctx.db,
        input.seasonId,
        input.queueType
      )

      await ctx.db
        .delete(seasonSnapshots)
        .where(eq(seasonSnapshots.id, snapshot.id))

      await removeMinioObjectIfExists(snapshot.minioKey)
      await redis.del(getSeasonLeaderboardKey(input.seasonId, snapshot.queueId))
      await redis.del(getSeasonQueuesCacheKey(input.seasonId))

      return { success: true }
    }),

  delete_snapshot: permissionProcedure('seasons.manage')
    .input(
      z.object({
        seasonId: z.number().int().positive(),
        queueType: z.string().trim().min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const snapshot = await getSnapshotByQueueTypeOrThrow(
        ctx.db,
        input.seasonId,
        input.queueType
      )

      await ctx.db
        .update(seasonSnapshots)
        .set({
          minioKey: null,
          uploadedBy: null,
        })
        .where(eq(seasonSnapshots.id, snapshot.id))

      await removeMinioObjectIfExists(snapshot.minioKey)
      await redis.del(getSeasonLeaderboardKey(input.seasonId, snapshot.queueId))
      await redis.del(getSeasonQueuesCacheKey(input.seasonId))

      return { success: true }
    }),

  reorder_snapshots: permissionProcedure('seasons.manage')
    .input(
      z.object({
        seasonId: z.number().int().positive(),
        snapshotIds: z.array(z.number().int().positive()).min(1),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await getSeasonByIdOrThrow(ctx.db, input.seasonId)

      const existingSnapshots = await ctx.db
        .select({
          id: seasonSnapshots.id,
        })
        .from(seasonSnapshots)
        .where(eq(seasonSnapshots.seasonId, input.seasonId))
        .orderBy(asc(seasonSnapshots.sortOrder), asc(seasonSnapshots.id))

      if (existingSnapshots.length !== input.snapshotIds.length) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Snapshot order is stale. Refresh and try again.',
        })
      }

      const expectedIds = new Set(
        existingSnapshots.map((snapshot) => snapshot.id)
      )
      const submittedIds = new Set(input.snapshotIds)

      if (
        submittedIds.size !== input.snapshotIds.length ||
        existingSnapshots.some((snapshot) => !submittedIds.has(snapshot.id)) ||
        input.snapshotIds.some((snapshotId) => !expectedIds.has(snapshotId))
      ) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'Snapshot order is stale. Refresh and try again.',
        })
      }

      await ctx.db.transaction(async (tx) => {
        await Promise.all(
          input.snapshotIds.map((snapshotId, index) =>
            tx
              .update(seasonSnapshots)
              .set({ sortOrder: index })
              .where(eq(seasonSnapshots.id, snapshotId))
          )
        )
      })

      return refreshSeasonSnapshotsCache(ctx.db, input.seasonId)
    }),

  invalidate_cache: permissionProcedure('seasons.manage')
    .input(
      z.object({
        seasonId: z.number().int().positive(),
        queueId: z.string().trim().min(1),
      })
    )
    .mutation(async ({ input }) => {
      await redis.del(getSeasonLeaderboardKey(input.seasonId, input.queueId))

      return { success: true }
    }),
})
