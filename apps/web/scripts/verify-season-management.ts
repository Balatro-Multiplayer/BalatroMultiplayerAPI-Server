import { asc, eq } from 'drizzle-orm'
import postgres from 'postgres'
import { env } from '@/env'
import { db } from '@/server/db'
import { seasonSnapshots, seasons } from '@/server/db/schema'
import { ensureBucketExists, minioClient } from '@/server/minio'
import { redis } from '@/server/redis'
import {
  getActiveSeasonNumber,
  getSeasons,
  SEASONS_CACHE_KEY,
} from '@/server/seasons'
import {
  botlatro_service,
  type LeaderboardEntry,
} from '@/server/services/botlatro.service'
import { LeaderboardService } from '@/server/services/leaderboard'
import {
  SEASON_1_START_DATE,
  SEASON_2_START_DATE,
  SEASON_3_START_DATE,
  SEASON_4_START_DATE,
  SEASON_5_START_DATE,
  SEASON_6_START_DATE,
} from '@/shared/seasons'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

function makeEntry(
  id: string,
  name: string,
  mmr: number,
  rank: number
): LeaderboardEntry {
  return {
    id,
    name,
    mmr,
    wins: 10,
    losses: 2,
    streak: 4,
    totalgames: 12,
    peak_mmr: mmr,
    peak_streak: 4,
    rank,
    winrate: 10 / 12,
  }
}

function getLeaderboardKey(seasonId: number, queueId: string) {
  return `season:${seasonId}:leaderboard:${queueId}`
}

function getSeasonQueuesCacheKey(seasonId: number) {
  return `config:season:${seasonId}:queues`
}

async function verifySeedData() {
  const sqlClient = postgres(env.DATABASE_URL, { max: 1 })
  const [schemaReady] = await sqlClient.unsafe<
    {
      has_seasons: boolean
      has_season_snapshots: boolean
    }[]
  >(`
    select
      exists (
        select 1
        from information_schema.tables
        where table_schema = 'public' and table_name = 'seasons'
      ) as has_seasons,
      exists (
        select 1
        from information_schema.tables
        where table_schema = 'public' and table_name = 'season_snapshots'
      ) as has_season_snapshots
  `)
  await sqlClient.end()

  assert(
    schemaReady?.has_seasons,
    'Missing seasons table. Run migration first.'
  )
  assert(
    schemaReady?.has_season_snapshots,
    'Missing season_snapshots table. Run migration first.'
  )

  const loadedSeasons = await db
    .select({
      id: seasons.id,
      name: seasons.name,
      startDate: seasons.startDate,
      endDate: seasons.endDate,
      isActive: seasons.isActive,
    })
    .from(seasons)
    .orderBy(asc(seasons.id))

  assert(
    loadedSeasons.length >= 6,
    'Expected seasons table with at least 6 rows. Run migration + seed first.'
  )

  const expected = [
    {
      id: 1,
      name: 'Season 1',
      startDate: SEASON_1_START_DATE,
      endDate: SEASON_2_START_DATE,
      isActive: false,
    },
    {
      id: 2,
      name: 'Season 2',
      startDate: SEASON_2_START_DATE,
      endDate: SEASON_3_START_DATE,
      isActive: false,
    },
    {
      id: 3,
      name: 'Season 3',
      startDate: SEASON_3_START_DATE,
      endDate: SEASON_4_START_DATE,
      isActive: false,
    },
    {
      id: 4,
      name: 'Season 4',
      startDate: SEASON_4_START_DATE,
      endDate: SEASON_5_START_DATE,
      isActive: false,
    },
    {
      id: 5,
      name: 'Season 5',
      startDate: SEASON_5_START_DATE,
      endDate: SEASON_6_START_DATE,
      isActive: false,
    },
    {
      id: 6,
      name: 'Season 6',
      startDate: SEASON_6_START_DATE,
      endDate: null,
      isActive: true,
    },
  ]

  for (const season of expected) {
    const actual = loadedSeasons.find((row) => row.id === season.id)
    assert(actual, `Missing seeded season ${season.id}`)
    assert(
      actual.name === season.name,
      `Unexpected name for season ${season.id}`
    )
    assert(
      actual.startDate.toISOString() === season.startDate.toISOString(),
      `Unexpected start date for season ${season.id}`
    )
    assert(
      (actual.endDate?.toISOString() ?? null) ===
        (season.endDate?.toISOString() ?? null),
      `Unexpected end date for season ${season.id}`
    )
    assert(
      actual.isActive === season.isActive,
      `Unexpected active flag for season ${season.id}`
    )
  }

  await redis.del(SEASONS_CACHE_KEY)
  const cachedSeasons = await getSeasons()
  assert(cachedSeasons.length >= 6, 'Expected seasons cache to repopulate')

  const activeSeasonNumber = await getActiveSeasonNumber()
  assert(
    activeSeasonNumber === 6,
    'Expected active season cache to resolve to 6'
  )
}

async function verifyHistoricalPath(service: LeaderboardService) {
  const historicalPayload = [
    makeEntry('hist-1', 'History One', 1910, 1),
    makeEntry('hist-2', 'History Two', 1800, 2),
  ]
  const [historicalSeason] = await db
    .insert(seasons)
    .values({
      name: `Verify Historical ${Date.now()}`,
      startDate: new Date('2025-01-01T00:00:00.000Z'),
      endDate: new Date('2025-01-02T00:00:00.000Z'),
      isActive: false,
    })
    .returning({
      id: seasons.id,
    })

  assert(historicalSeason, 'Failed creating historical verification season')

  const queueType = 'verify-history'
  const queueId = `verify-history-${historicalSeason.id}`
  const objectKey = `leaderboard-snapshots/season${historicalSeason.id}/${queueType}-${Date.now()}.json`
  const leaderboardKey = getLeaderboardKey(historicalSeason.id, queueId)

  try {
    await minioClient.putObject(
      env.MINIO_LEADERBOARD_BUCKET_NAME,
      objectKey,
      Buffer.from(JSON.stringify(historicalPayload)),
      undefined,
      {
        'Content-Type': 'application/json',
      }
    )

    await db.insert(seasonSnapshots).values({
      seasonId: historicalSeason.id,
      queueType,
      queueId,
      minioKey: objectKey,
      uploadedBy: 'verify-script',
    })

    await redis.del(leaderboardKey)
    await redis.del(getSeasonQueuesCacheKey(historicalSeason.id))

    const firstLoad = await service.getSeasonLeaderboard(
      historicalSeason.id,
      queueType
    )
    assert(firstLoad.length === 2, 'Historical load returned wrong entry count')
    assert(
      firstLoad[0]?.name === 'History One',
      'Historical load did not come back sorted'
    )

    const cachedPayload = await redis.get(leaderboardKey)
    assert(cachedPayload, 'Historical path did not populate Redis cache')

    await minioClient.removeObject(env.MINIO_LEADERBOARD_BUCKET_NAME, objectKey)

    const secondLoad = await service.getSeasonLeaderboard(
      historicalSeason.id,
      queueType
    )
    assert(
      secondLoad.length === 2,
      'Historical cache hit failed after MinIO removal'
    )
  } finally {
    await redis.del(leaderboardKey)
    await redis.del(getSeasonQueuesCacheKey(historicalSeason.id))
    await db
      .delete(seasonSnapshots)
      .where(eq(seasonSnapshots.seasonId, historicalSeason.id))
    await db.delete(seasons).where(eq(seasons.id, historicalSeason.id))
    await minioClient
      .removeObject(env.MINIO_LEADERBOARD_BUCKET_NAME, objectKey)
      .catch(() => undefined)
  }
}

async function verifyActivePath(service: LeaderboardService) {
  const originalGetLeaderboard = botlatro_service.get_leaderboard
  const originalActiveSeason = await redis.get('config:active_season')
  const activePayload = [
    makeEntry('live-1', 'Live One', 2100, 1),
    makeEntry('live-2', 'Live Two', 2000, 2),
  ]
  let botCalls = 0

  const [activeSeason] = await db
    .insert(seasons)
    .values({
      name: `Verify Active ${Date.now()}`,
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: null,
      isActive: false,
    })
    .returning({
      id: seasons.id,
    })

  assert(activeSeason, 'Failed creating active verification season')

  const queueType = 'verify-live'
  const queueId = `verify-live-${activeSeason.id}`
  const leaderboardKey = getLeaderboardKey(activeSeason.id, queueId)

  try {
    await db.insert(seasonSnapshots).values({
      seasonId: activeSeason.id,
      queueType,
      queueId,
      minioKey: null,
      uploadedBy: null,
    })

    await redis.set('config:active_season', activeSeason.id.toString())
    await redis.del(leaderboardKey)
    await redis.del(getSeasonQueuesCacheKey(activeSeason.id))

    botlatro_service.get_leaderboard = async (
      requestedQueueId,
      requestedSeason
    ) => {
      botCalls += 1
      assert(
        requestedQueueId === queueId,
        'Active path called bot with wrong queue id'
      )
      assert(
        requestedSeason === activeSeason.id,
        'Active path called bot with wrong season id'
      )
      return activePayload
    }

    const firstLoad = await service.getSeasonLeaderboard(
      activeSeason.id,
      queueType
    )
    assert(firstLoad.length === 2, 'Active load returned wrong entry count')
    assert(botCalls === 1, 'Expected active load to hit bot path once')

    const cachedPayload = await redis.get(leaderboardKey)
    assert(cachedPayload, 'Active path did not populate Redis cache')

    const secondLoad = await service.getSeasonLeaderboard(
      activeSeason.id,
      queueType
    )
    assert(
      secondLoad.length === 2,
      'Active cache hit returned wrong entry count'
    )
    assert(botCalls === 1, 'Expected second active load to hit Redis cache')
  } finally {
    botlatro_service.get_leaderboard = originalGetLeaderboard

    if (originalActiveSeason) {
      await redis.set('config:active_season', originalActiveSeason)
    } else {
      await redis.del('config:active_season')
    }

    await redis.del(leaderboardKey)
    await redis.del(getSeasonQueuesCacheKey(activeSeason.id))
    await db
      .delete(seasonSnapshots)
      .where(eq(seasonSnapshots.seasonId, activeSeason.id))
    await db.delete(seasons).where(eq(seasons.id, activeSeason.id))
  }
}

async function main() {
  console.log('Verifying season management...')

  assert(
    env.MINIO_LEADERBOARD_BUCKET_NAME.trim().length > 0,
    'MINIO_LEADERBOARD_BUCKET_NAME is missing'
  )

  await ensureBucketExists(env.MINIO_LEADERBOARD_BUCKET_NAME)
  console.log(`leaderboard bucket: ${env.MINIO_LEADERBOARD_BUCKET_NAME}`)

  await verifySeedData()
  console.log('seed data ok')

  const service = new LeaderboardService()
  await verifyHistoricalPath(service)
  console.log('historical path ok')

  await verifyActivePath(service)
  console.log('active path ok')
}

main()
  .then(() => {
    console.log('season management verification passed')
    process.exit(0)
  })
  .catch((error) => {
    console.error('season management verification failed:', error)
    process.exit(1)
  })
