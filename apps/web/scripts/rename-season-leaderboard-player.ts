import { and, eq } from 'drizzle-orm'
import { env } from '@/env'
import { db } from '@/server/db'
import { seasonSnapshots, seasons } from '@/server/db/schema'
import { ensureBucketExists, minioClient } from '@/server/minio'
import { redis } from '@/server/redis'

const SCRIPT_UPLOADER = 'rename-season-leaderboard-player'

type Args = {
  seasonId: number
  queueType: string
  discordId: string
  newName: string
  dryRun: boolean
}

type RenameResult = {
  updatedPayload: unknown
  previousName: string | null
  updatedCount: number
}

function parseArgs(argv: string[]): Args {
  let seasonId = 5
  let queueType = 'ranked'
  let discordId = ''
  let newName = ''
  let dryRun = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]

    if (arg === '--season') {
      seasonId = Number(argv[i + 1] ?? '')
      i += 1
      continue
    }

    if (arg === '--queue') {
      queueType = argv[i + 1] ?? ''
      i += 1
      continue
    }

    if (arg === '--discord-id') {
      discordId = argv[i + 1] ?? ''
      i += 1
      continue
    }

    if (arg === '--name') {
      newName = argv[i + 1] ?? ''
      i += 1
      continue
    }

    if (arg === '--dry-run') {
      dryRun = true
    }
  }

  if (!Number.isInteger(seasonId) || seasonId <= 0) {
    throw new Error('Missing or invalid --season')
  }

  if (!queueType.trim()) {
    throw new Error('Missing --queue')
  }

  if (!discordId.trim()) {
    throw new Error('Missing --discord-id')
  }

  if (!newName.trim()) {
    throw new Error('Missing --name')
  }

  return {
    seasonId,
    queueType: queueType.trim(),
    discordId: discordId.trim(),
    newName: newName.trim(),
    dryRun,
  }
}

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return Buffer.concat(chunks).toString('utf-8')
}

function renameInEntryList(
  entries: unknown[],
  discordId: string,
  newName: string
) {
  let previousName: string | null = null
  let updatedCount = 0

  const updatedEntries = entries.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return entry
    }

    const currentId = String((entry as { id?: unknown }).id ?? '')
    if (currentId !== discordId) {
      return entry
    }

    const nextEntry = { ...(entry as Record<string, unknown>) }
    previousName = String(nextEntry.name ?? '')
    nextEntry.name = newName
    updatedCount += 1
    return nextEntry
  })

  return {
    updatedEntries,
    previousName,
    updatedCount,
  }
}

function renamePlayerInPayload(
  payload: unknown,
  discordId: string,
  newName: string
): RenameResult {
  if (Array.isArray(payload)) {
    const result = renameInEntryList(payload, discordId, newName)
    return {
      updatedPayload: result.updatedEntries,
      previousName: result.previousName,
      updatedCount: result.updatedCount,
    }
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('Unsupported snapshot payload shape')
  }

  if (Array.isArray((payload as { leaderboard?: unknown[] }).leaderboard)) {
    const result = renameInEntryList(
      (payload as { leaderboard: unknown[] }).leaderboard,
      discordId,
      newName
    )

    return {
      updatedPayload: {
        ...(payload as Record<string, unknown>),
        leaderboard: result.updatedEntries,
      },
      previousName: result.previousName,
      updatedCount: result.updatedCount,
    }
  }

  if (Array.isArray((payload as { data?: unknown[] }).data)) {
    const result = renameInEntryList(
      (payload as { data: unknown[] }).data,
      discordId,
      newName
    )

    return {
      updatedPayload: {
        ...(payload as Record<string, unknown>),
        data: result.updatedEntries,
      },
      previousName: result.previousName,
      updatedCount: result.updatedCount,
    }
  }

  if (Array.isArray((payload as { alltime?: unknown[] }).alltime)) {
    const result = renameInEntryList(
      (payload as { alltime: unknown[] }).alltime,
      discordId,
      newName
    )

    return {
      updatedPayload: {
        ...(payload as Record<string, unknown>),
        alltime: result.updatedEntries,
      },
      previousName: result.previousName,
      updatedCount: result.updatedCount,
    }
  }

  throw new Error('Unsupported snapshot payload shape')
}

function getSeasonLeaderboardKey(seasonId: number, queueId: string) {
  return `season:${seasonId}:leaderboard:${queueId}`
}

function getSeasonQueuesCacheKey(seasonId: number) {
  return `config:season:${seasonId}:queues`
}

function getObjectKey(seasonId: number, queueType: string) {
  return `leaderboard-snapshots/season${seasonId}/${queueType}-${Date.now()}.json`
}

async function getSnapshotOrThrow(seasonId: number, queueType: string) {
  const snapshot = await db
    .select({
      id: seasonSnapshots.id,
      seasonId: seasonSnapshots.seasonId,
      queueType: seasonSnapshots.queueType,
      queueId: seasonSnapshots.queueId,
      minioKey: seasonSnapshots.minioKey,
    })
    .from(seasonSnapshots)
    .where(
      and(
        eq(seasonSnapshots.seasonId, seasonId),
        eq(seasonSnapshots.queueType, queueType)
      )
    )
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!snapshot) {
    throw new Error(`No snapshot row for season ${seasonId} queue ${queueType}`)
  }

  return snapshot
}

async function getSeasonOrThrow(seasonId: number) {
  const season = await db
    .select({
      id: seasons.id,
      name: seasons.name,
      endDate: seasons.endDate,
    })
    .from(seasons)
    .where(eq(seasons.id, seasonId))
    .limit(1)
    .then((rows) => rows[0] ?? null)

  if (!season) {
    throw new Error(`Season ${seasonId} not found`)
  }

  return season
}

async function loadPayload(snapshot: {
  minioKey: string | null
  queueId: string
  seasonId: number
}) {
  if (snapshot.minioKey) {
    const stream = await minioClient.getObject(
      env.MINIO_LEADERBOARD_BUCKET_NAME,
      snapshot.minioKey
    )
    const payload = await streamToString(stream)
    return payload
  }

  throw new Error(
    `Snapshot for season ${snapshot.seasonId} queue ${snapshot.queueId} has no minio_key`
  )
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const season = await getSeasonOrThrow(args.seasonId)
  const snapshot = await getSnapshotOrThrow(args.seasonId, args.queueType)

  console.log(
    `season=${season.id} (${season.name}) queue=${snapshot.queueType} queueId=${snapshot.queueId}`
  )
  console.log(`source=${snapshot.minioKey ?? 'live'}`)

  const rawPayload = await loadPayload(snapshot)
  const parsedPayload = JSON.parse(rawPayload) as unknown
  const result = renamePlayerInPayload(
    parsedPayload,
    args.discordId,
    args.newName
  )

  if (result.updatedCount === 0) {
    throw new Error(
      `User ${args.discordId} not found in season ${args.seasonId} ${args.queueType} snapshot`
    )
  }

  console.log(
    `rename ${args.discordId}: "${result.previousName ?? ''}" -> "${args.newName}"`
  )

  if (args.dryRun) {
    console.log('dry run, no changes written')
    return
  }

  await ensureBucketExists(env.MINIO_LEADERBOARD_BUCKET_NAME)

  const nextObjectKey = getObjectKey(args.seasonId, args.queueType)
  const nextPayload = JSON.stringify(result.updatedPayload)
  const nextBuffer = Buffer.from(nextPayload)

  await minioClient.putObject(
    env.MINIO_LEADERBOARD_BUCKET_NAME,
    nextObjectKey,
    nextBuffer,
    nextBuffer.length,
    {
      'Content-Type': 'application/json',
    }
  )

  await db
    .update(seasonSnapshots)
    .set({
      minioKey: nextObjectKey,
      uploadedBy: SCRIPT_UPLOADER,
    })
    .where(eq(seasonSnapshots.id, snapshot.id))

  if (snapshot.minioKey && snapshot.minioKey !== nextObjectKey) {
    await minioClient
      .removeObject(env.MINIO_LEADERBOARD_BUCKET_NAME, snapshot.minioKey)
      .catch(() => undefined)
  }

  await redis.del(getSeasonLeaderboardKey(args.seasonId, snapshot.queueId))
  await redis.del(getSeasonQueuesCacheKey(args.seasonId))

  console.log(`uploaded=${nextObjectKey}`)
  console.log(
    `cleared=${getSeasonLeaderboardKey(args.seasonId, snapshot.queueId)}`
  )
}

main()
  .then(() => {
    process.exit(0)
  })
  .catch((error) => {
    console.error('rename failed:', error)
    process.exit(1)
  })
