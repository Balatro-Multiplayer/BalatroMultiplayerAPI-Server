import path from 'node:path'
import { and, desc, eq, gte, lt } from 'drizzle-orm'
import { env } from '@/env'
import { db } from '@/server/db'
import {
  leaderboardSnapshots,
  seasonSnapshots,
  seasons,
} from '@/server/db/schema'
import { ensureBucketExists, minioClient } from '@/server/minio'
import { redis } from '@/server/redis'
import { botlatro_service } from '@/server/services/botlatro.service'
import {
  LEGACY_QUEUE_ID,
  OLD_RANKED_CHANNEL,
  OLD_SMALLWORLD_CHANNEL,
  OLD_VANILLA_CHANNEL,
  RANKED_QUEUE_ID,
  SMALLWORLD_QUEUE_ID,
  VANILLA_QUEUE_ID,
} from '@/shared/constants'

type SeasonRow = typeof seasons.$inferSelect

type SnapshotSeedSource =
  | {
      kind: 'file'
      filePath: string
    }
  | {
      kind: 'legacy-db'
      channelId: string
    }
  | {
      kind: 'bot'
      botQueueId: string
    }
  | {
      kind: 'live'
    }

type SnapshotSeed = {
  seasonId: number
  queueType: string
  queueId: string
  source: SnapshotSeedSource
}

const SEED_UPLOADER = 'seed-past-season-snapshots'
const DRY_RUN = process.argv.includes('--dry-run')

const SNAPSHOT_SEEDS: SnapshotSeed[] = [
  {
    seasonId: 1,
    queueType: 'ranked',
    queueId: RANKED_QUEUE_ID,
    source: {
      kind: 'file',
      filePath: 'src/data/leaderboard-snapshot-eos1.json',
    },
  },
  {
    seasonId: 2,
    queueType: 'ranked',
    queueId: RANKED_QUEUE_ID,
    source: {
      kind: 'file',
      filePath: 'src/data/leaderboard-snapshot-eos2.json',
    },
  },
  {
    seasonId: 3,
    queueType: 'ranked',
    queueId: RANKED_QUEUE_ID,
    source: {
      kind: 'legacy-db',
      channelId: OLD_RANKED_CHANNEL,
    },
  },
  {
    seasonId: 3,
    queueType: 'smallworld',
    queueId: SMALLWORLD_QUEUE_ID,
    source: {
      kind: 'legacy-db',
      channelId: OLD_SMALLWORLD_CHANNEL,
    },
  },
  {
    seasonId: 3,
    queueType: 'vanilla',
    queueId: VANILLA_QUEUE_ID,
    source: {
      kind: 'legacy-db',
      channelId: OLD_VANILLA_CHANNEL,
    },
  },
  {
    seasonId: 4,
    queueType: 'ranked',
    queueId: RANKED_QUEUE_ID,
    source: {
      kind: 'file',
      filePath: 'src/data/leaderboard-snapshot-eos4-1.json',
    },
  },
  {
    seasonId: 4,
    queueType: 'smallworld',
    queueId: SMALLWORLD_QUEUE_ID,
    source: {
      kind: 'file',
      filePath: 'src/data/leaderboard-snapshot-eos4-2.json',
    },
  },
  {
    seasonId: 4,
    queueType: 'vanilla',
    queueId: VANILLA_QUEUE_ID,
    source: {
      kind: 'file',
      filePath: 'src/data/leaderboard-snapshot-eos4-4.json',
    },
  },
  {
    seasonId: 5,
    queueType: 'ranked',
    queueId: RANKED_QUEUE_ID,
    source: {
      kind: 'bot',
      botQueueId: RANKED_QUEUE_ID,
    },
  },
  {
    seasonId: 5,
    queueType: 'smallworld',
    queueId: SMALLWORLD_QUEUE_ID,
    source: {
      kind: 'bot',
      botQueueId: SMALLWORLD_QUEUE_ID,
    },
  },
  {
    seasonId: 5,
    queueType: 'vanilla',
    queueId: VANILLA_QUEUE_ID,
    source: {
      kind: 'bot',
      botQueueId: VANILLA_QUEUE_ID,
    },
  },
  {
    seasonId: 6,
    queueType: 'ranked',
    queueId: RANKED_QUEUE_ID,
    source: {
      kind: 'live',
    },
  },
  {
    seasonId: 6,
    queueType: 'smallworld',
    queueId: SMALLWORLD_QUEUE_ID,
    source: {
      kind: 'live',
    },
  },
  {
    seasonId: 6,
    queueType: 'vanilla',
    queueId: VANILLA_QUEUE_ID,
    source: {
      kind: 'live',
    },
  },
  {
    seasonId: 6,
    queueType: 'legacy',
    queueId: LEGACY_QUEUE_ID,
    source: {
      kind: 'live',
    },
  },
]

function getSeasonQueuesCacheKey(seasonId: number) {
  return `config:season:${seasonId}:queues`
}

function getSeasonLeaderboardKey(seasonId: number, queueId: string) {
  return `season:${seasonId}:leaderboard:${queueId}`
}

function getObjectKey(seasonId: number, queueType: string) {
  return `leaderboard-snapshots/season${seasonId}/${queueType}-seeded.json`
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message)
  }
}

async function getSeasonOrThrow(seasonId: number): Promise<SeasonRow> {
  const season = await db
    .select()
    .from(seasons)
    .where(eq(seasons.id, seasonId))
    .limit(1)
    .then((rows) => rows[0])

  if (!season) {
    throw new Error(`Season ${seasonId} not found`)
  }

  if (seasonId !== 6 && !season.endDate) {
    throw new Error(`Season ${seasonId} is not a past season`)
  }

  return season
}

async function loadFilePayload(filePath: string) {
  const absolutePath = path.join(process.cwd(), filePath)
  const payload = await Bun.file(absolutePath).text()
  JSON.parse(payload)
  return payload
}

async function loadLegacyDbPayload(season: SeasonRow, channelId: string) {
  const snapshot = await db
    .select({
      id: leaderboardSnapshots.id,
      timestamp: leaderboardSnapshots.timestamp,
      data: leaderboardSnapshots.data,
    })
    .from(leaderboardSnapshots)
    .where(
      and(
        eq(leaderboardSnapshots.channelId, channelId),
        gte(leaderboardSnapshots.timestamp, season.startDate),
        lt(leaderboardSnapshots.timestamp, season.endDate)
      )
    )
    .orderBy(desc(leaderboardSnapshots.timestamp))
    .limit(1)
    .then((rows) => rows[0])

  assert(
    snapshot,
    `No legacy DB snapshot found for season ${season.id} channel ${channelId}`
  )

  return JSON.stringify(snapshot.data)
}

async function loadBotPayload(queueId: string, seasonId: number) {
  const entries = await botlatro_service.get_leaderboard(queueId, seasonId)
  assert(
    entries.length > 0,
    `Bot returned no entries for season ${seasonId} queue ${queueId}`
  )
  return JSON.stringify(entries)
}

async function loadSeedPayload(seed: SnapshotSeed, season: SeasonRow) {
  if (seed.source.kind === 'file') {
    return loadFilePayload(seed.source.filePath)
  }

  if (seed.source.kind === 'legacy-db') {
    return loadLegacyDbPayload(season, seed.source.channelId)
  }

  if (seed.source.kind === 'live') {
    return null
  }

  return loadBotPayload(seed.source.botQueueId, season.id)
}

async function upsertSnapshot(seed: SnapshotSeed, season: SeasonRow) {
  const payload = await loadSeedPayload(seed, season)
  const objectKey = getObjectKey(season.id, seed.queueType)
  const existing = await db
    .select()
    .from(seasonSnapshots)
    .where(
      and(
        eq(seasonSnapshots.seasonId, season.id),
        eq(seasonSnapshots.queueType, seed.queueType)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  console.log(
    `${DRY_RUN ? '[dry-run] ' : ''}season${season.id} ${seed.queueType} -> ${
      payload === null ? 'live-registration' : objectKey
    }`
  )

  if (DRY_RUN) {
    return
  }

  if (payload !== null) {
    await minioClient.putObject(
      env.MINIO_LEADERBOARD_BUCKET_NAME,
      objectKey,
      Buffer.from(payload),
      undefined,
      {
        'Content-Type': 'application/json',
      }
    )
  }

  await db
    .insert(seasonSnapshots)
    .values({
      seasonId: season.id,
      queueType: seed.queueType,
      queueId: seed.queueId,
      minioKey: payload === null ? null : objectKey,
      uploadedBy: SEED_UPLOADER,
    })
    .onConflictDoUpdate({
      target: [seasonSnapshots.seasonId, seasonSnapshots.queueType],
      set: {
        queueId: seed.queueId,
        minioKey: payload === null ? null : objectKey,
        uploadedBy: SEED_UPLOADER,
      },
    })

  if (
    payload !== null &&
    existing?.minioKey &&
    existing.minioKey !== objectKey
  ) {
    await minioClient
      .removeObject(env.MINIO_LEADERBOARD_BUCKET_NAME, existing.minioKey)
      .catch(() => undefined)
  }

  await redis.del(getSeasonLeaderboardKey(season.id, seed.queueId))
  await redis.del(getSeasonQueuesCacheKey(season.id))
}

async function main() {
  console.log(
    `${DRY_RUN ? 'Dry run:' : 'Seeding:'} season snapshot data into ${env.MINIO_LEADERBOARD_BUCKET_NAME}`
  )

  await ensureBucketExists(env.MINIO_LEADERBOARD_BUCKET_NAME)

  const seasonsById = new Map<number, SeasonRow>()
  for (const seasonId of new Set(SNAPSHOT_SEEDS.map((seed) => seed.seasonId))) {
    seasonsById.set(seasonId, await getSeasonOrThrow(seasonId))
  }

  for (const seed of SNAPSHOT_SEEDS) {
    const season = seasonsById.get(seed.seasonId)
    assert(season, `Missing cached season ${seed.seasonId}`)
    await upsertSnapshot(seed, season)
  }

  console.log(
    DRY_RUN ? 'Dry run complete' : 'Past season snapshot seed complete'
  )
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((error) => {
    console.error('Past season snapshot seed failed:', error)
    process.exit(1)
  })
