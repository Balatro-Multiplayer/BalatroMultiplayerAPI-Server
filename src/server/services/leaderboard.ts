import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm'
import { env } from '@/env'
import { db } from '@/server/db'
import {
  leaderboardSnapshots,
  metadata,
  seasonSnapshots,
} from '@/server/db/schema'
import { minioClient } from '@/server/minio'
import { getActiveSeasonNumber, getSeasonConfig } from '@/server/seasons'
import { redis } from '../redis'
import { botlatro_service, type LeaderboardEntry } from './botlatro.service'

// Memory profiling utility
let currentRunId: string | null = null

type SnapshotEntry = {
  id: string
  name: string
  data: {
    mmr: number
    wins: number
    losses: number
    streak: number
    totalgames: number
    peak_mmr: number
    peak_streak: number
    rank: number
    winrate: number
  }
}

type SnapshotFile = {
  alltime: SnapshotEntry[]
}

type StoredLeaderboardSnapshot = {
  data: LeaderboardEntry[]
  timestamp: string
  queue_id: string
}

type CachedSeasonSnapshot = {
  id: number
  seasonId: number
  queueType: string
  queueId: string
  sortOrder: number
  minioKey: string | null
  uploadedBy: string | null
  createdAt: string
}

function logMemory(label: string, metadata?: Record<string, unknown>) {
  if (!currentRunId) return

  const mem = process.memoryUsage()
  const data = {
    runId: currentRunId,
    label,
    heapUsedMb: mem.heapUsed / 1024 / 1024,
    heapTotalMb: mem.heapTotal / 1024 / 1024,
    rssMb: mem.rss / 1024 / 1024,
    externalMb: mem.external / 1024 / 1024,
    metadata: metadata || null,
  }

  console.log(`[MEMORY ${label}]`, {
    heap: `${Math.round(data.heapUsedMb)}MB`,
    rss: `${Math.round(data.rssMb)}MB`,
    ...metadata,
  })
}

function mapSnapshotEntries(fileContent: SnapshotFile): LeaderboardEntry[] {
  return fileContent.alltime.map((entry) => ({
    id: entry.id,
    name: entry.name,
    mmr: entry.data.mmr,
    wins: entry.data.wins,
    losses: entry.data.losses,
    streak: entry.data.streak,
    totalgames: entry.data.totalgames,
    peak_mmr: entry.data.peak_mmr,
    peak_streak: entry.data.peak_streak,
    rank: entry.data.rank,
    winrate: entry.data.winrate,
  }))
}

function normalizeLeaderboardEntries(entries: unknown[]): LeaderboardEntry[] {
  return entries.map((entry, index) => {
    const data = entry as Partial<LeaderboardEntry>

    const wins = Number(data.wins ?? 0)
    const losses = Number(data.losses ?? 0)
    const totalgames = Number(data.totalgames ?? wins + losses)

    return {
      id: String(data.id ?? ''),
      name: String(data.name ?? data.id ?? ''),
      mmr: Number(data.mmr ?? 0),
      wins,
      losses,
      streak: Number(data.streak ?? 0),
      totalgames,
      decay: data.decay,
      ign: data.ign,
      peak_mmr: Number(data.peak_mmr ?? data.mmr ?? 0),
      peak_streak: Number(data.peak_streak ?? data.streak ?? 0),
      rank: Number(data.rank ?? index + 1),
      winrate:
        data.winrate !== undefined
          ? Number(data.winrate)
          : totalgames > 0
            ? wins / totalgames
            : 0,
    }
  })
}

function parseLeaderboardPayload(payload: unknown): LeaderboardEntry[] {
  if (Array.isArray(payload)) {
    return normalizeLeaderboardEntries(payload)
  }

  if (!payload || typeof payload !== 'object') {
    return []
  }

  const maybeLeaderboard = (payload as { leaderboard?: unknown[] }).leaderboard
  if (Array.isArray(maybeLeaderboard)) {
    return normalizeLeaderboardEntries(maybeLeaderboard)
  }

  const maybeData = (payload as { data?: unknown[] }).data
  if (Array.isArray(maybeData)) {
    return normalizeLeaderboardEntries(maybeData)
  }

  const maybeAlltime = (payload as SnapshotFile).alltime
  if (Array.isArray(maybeAlltime)) {
    return mapSnapshotEntries({ alltime: maybeAlltime })
  }

  return []
}

function sortLeaderboard(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return [...entries]
    .sort((a, b) => b.mmr - a.mmr)
    .map((entry, index) => ({
      ...entry,
      rank: index + 1,
    }))
}

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = []

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  return Buffer.concat(chunks).toString('utf-8')
}

function serializeSeasonSnapshots(snapshots: CachedSeasonSnapshot[]) {
  return JSON.stringify(snapshots)
}

function deserializeSeasonSnapshots(value: string): CachedSeasonSnapshot[] {
  return (
    JSON.parse(value) as Array<
      Omit<CachedSeasonSnapshot, 'sortOrder'> & { sortOrder?: number }
    >
  ).map((snapshot, index) => ({
    ...snapshot,
    sortOrder: snapshot.sortOrder ?? index,
  }))
}

function toRedisLeaderboardEntry(
  entry: LeaderboardEntry,
  queue_id: string
): Record<string, string> {
  return {
    id: entry.id,
    name: entry.name,
    mmr: entry.mmr.toString(),
    wins: entry.wins.toString(),
    losses: entry.losses.toString(),
    streak: entry.streak.toString(),
    totalgames: entry.totalgames.toString(),
    peak_mmr: entry.peak_mmr.toString(),
    peak_streak: entry.peak_streak.toString(),
    rank: entry.rank.toString(),
    winrate: entry.winrate.toString(),
    queue_id,
  }
}

export type LeaderboardResponse = {
  data: LeaderboardEntry[]
  isStale: boolean
  total?: number
  page?: number
  pageSize?: number
  totalPages?: number
}

export type PaginationOptions = {
  page?: number
  pageSize?: number
  search?: string
  minGames?: number
  maxGames?: number
  sortBy?:
    | 'rank'
    | 'mmr'
    | 'wins'
    | 'losses'
    | 'winrate'
    | 'totalgames'
    | 'streak'
    | 'peak_mmr'
    | 'peak_streak'
  sortOrder?: 'asc' | 'desc'
}

export type LeaderboardSnapshotResponse = {
  data: LeaderboardEntry[]
  timestamp: string
  queue_id: string
}

export type UserRankResponse = {
  data: LeaderboardEntry
  isStale: boolean
} | null

export class LeaderboardService {
  private static readonly LIVE_SEASON_CACHE_TTL_SECONDS = 180

  private legacySeasonDataCache = new Map<string, LeaderboardEntry[]>()

  private getZSetKey(queue_id: string) {
    return `zset:leaderboard:${queue_id}`
  }

  private getLegacySeasonKey(seasonId: number, queue_id: string) {
    return `legacy-season:${seasonId}:${queue_id}`
  }

  private getSeasonQueuesCacheKey(seasonId: number) {
    return `config:season:${seasonId}:queues`
  }

  private async loadSeason3LegacyData(
    queue_id: string
  ): Promise<LeaderboardEntry[]> {
    const cacheKey = this.getLegacySeasonKey(3, queue_id)
    const cached = this.legacySeasonDataCache.get(cacheKey)
    if (cached) return cached

    try {
      const seasonConfig = await getSeasonConfig(3)
      const conditions = [eq(leaderboardSnapshots.channelId, queue_id)]

      if (seasonConfig) {
        conditions.push(
          gte(leaderboardSnapshots.timestamp, seasonConfig.startDate)
        )
        if (seasonConfig.endDate) {
          conditions.push(
            lt(leaderboardSnapshots.timestamp, seasonConfig.endDate)
          )
        }
      }

      const snapshot = await db
        .select()
        .from(leaderboardSnapshots)
        .where(and(...conditions))
        .orderBy(desc(leaderboardSnapshots.timestamp))
        .limit(1)
        .then((rows) => rows[0])

      if (!snapshot) {
        console.warn(`No Season 3 snapshot found for channel ${queue_id}`)
        this.legacySeasonDataCache.set(cacheKey, [])
        return []
      }

      const sortedEntries = sortLeaderboard(
        parseLeaderboardPayload(snapshot.data)
      )

      this.legacySeasonDataCache.set(cacheKey, sortedEntries)
      return sortedEntries
    } catch (error) {
      console.error('Error loading Season 3 data from DB:', error)
      return []
    }
  }

  private async loadLiveSeasonData(
    seasonId: number,
    queue_id: string
  ): Promise<LeaderboardEntry[]> {
    const cacheKey = this.getSeasonKey(queue_id, seasonId)
    const cached = await redis.get(cacheKey)
    if (cached) {
      return sortLeaderboard(parseLeaderboardPayload(JSON.parse(cached)))
    }

    try {
      const entries = await botlatro_service.get_leaderboard(queue_id, seasonId)
      await redis.setEx(
        cacheKey,
        LeaderboardService.LIVE_SEASON_CACHE_TTL_SECONDS,
        JSON.stringify(entries)
      )
      return sortLeaderboard(entries)
    } catch (error) {
      console.error(`Error loading Season ${seasonId} data from bot:`, error)
      return []
    }
  }

  private async loadLegacySeasonData(
    seasonId: number,
    queue_id: string
  ): Promise<LeaderboardEntry[]> {
    switch (seasonId) {
      case 3:
        return this.loadSeason3LegacyData(queue_id)
      default:
        return []
    }
  }

  private async loadSeasonSnapshots(
    seasonId: number
  ): Promise<CachedSeasonSnapshot[]> {
    const cacheKey = this.getSeasonQueuesCacheKey(seasonId)
    const cached = await redis.get(cacheKey)
    if (cached) {
      return deserializeSeasonSnapshots(cached)
    }

    const snapshots = await db
      .select()
      .from(seasonSnapshots)
      .where(eq(seasonSnapshots.seasonId, seasonId))
      .orderBy(asc(seasonSnapshots.sortOrder), asc(seasonSnapshots.id))
      .then((rows) =>
        rows.map((row) => ({
          id: row.id,
          seasonId: row.seasonId,
          queueType: row.queueType,
          queueId: row.queueId,
          sortOrder: row.sortOrder,
          minioKey: row.minioKey,
          uploadedBy: row.uploadedBy,
          createdAt: row.createdAt.toISOString(),
        }))
      )

    await redis.set(cacheKey, serializeSeasonSnapshots(snapshots))
    return snapshots
  }

  private async getSeasonSnapshot(seasonId: number, queueIdentifier: string) {
    const snapshots = await this.loadSeasonSnapshots(seasonId)
    return snapshots.find(
      (snapshot) =>
        snapshot.queueType === queueIdentifier ||
        snapshot.queueId === queueIdentifier
    )
  }

  private async loadSnapshotFromMinio(
    minioKey: string
  ): Promise<LeaderboardEntry[]> {
    const objectStream = await minioClient.getObject(
      env.MINIO_LEADERBOARD_BUCKET_NAME,
      minioKey
    )
    const payload = await streamToString(objectStream)
    return sortLeaderboard(parseLeaderboardPayload(JSON.parse(payload)))
  }

  async getActiveSeasonNumber(): Promise<number> {
    return getActiveSeasonNumber()
  }

  async getSeasonLeaderboard(
    seasonId: number,
    queueType: string
  ): Promise<LeaderboardEntry[]> {
    const activeSeasonNumber = await this.getActiveSeasonNumber()
    const snapshot = await this.getSeasonSnapshot(seasonId, queueType)
    const queueId = snapshot?.queueId ?? queueType
    const cacheKey = this.getSeasonKey(queueId, seasonId)

    if (snapshot?.minioKey === null) {
      return this.loadLiveSeasonData(seasonId, queueId)
    }

    if (snapshot?.minioKey) {
      const cached = await redis.get(cacheKey)
      if (cached) {
        return sortLeaderboard(parseLeaderboardPayload(JSON.parse(cached)))
      }

      try {
        const entries = await this.loadSnapshotFromMinio(snapshot.minioKey)
        await redis.set(cacheKey, JSON.stringify(entries))
        return entries
      } catch (error) {
        console.error(
          `Error loading Season ${seasonId} snapshot ${snapshot.minioKey}:`,
          error
        )
      }
    }

    if (seasonId === activeSeasonNumber) {
      return this.loadLiveSeasonData(seasonId, queueId)
    }

    return this.loadLegacySeasonData(seasonId, queueId)
  }

  async getSeasonUserRank(
    seasonId: number,
    queueId: string,
    userId: string
  ): Promise<LeaderboardEntry | null> {
    const leaderboard = await this.getSeasonLeaderboard(seasonId, queueId)
    return leaderboard.find((entry) => entry.id === userId) ?? null
  }

  private getRawKey(queue_id: string) {
    return `raw:leaderboard:${queue_id}`
  }

  private getUserKey(user_id: string, queue_id: string) {
    return `user:${user_id}:${queue_id}`
  }

  private getBackupKey(queue_id: string) {
    return `backup_leaderboard_${queue_id}`
  }

  private getSeasonKey(queue_id: string, season: number) {
    return `season:${season}:leaderboard:${queue_id}`
  }

  private getSnapshotPrefix(queue_id: string): string {
    return `snapshot_leaderboard_${queue_id}_`
  }

  private applyFiltersAndPagination(
    data: LeaderboardEntry[],
    options: PaginationOptions
  ): LeaderboardResponse {
    let filtered = data

    if (options.search) {
      const searchLower = options.search.toLowerCase()
      filtered = filtered.filter(
        (entry) =>
          entry.name.toLowerCase().includes(searchLower) ||
          entry.id.toLowerCase().includes(searchLower)
      )
    }
    if (options.minGames !== undefined) {
      const minGames = options.minGames
      filtered = filtered.filter((entry) => entry.totalgames >= minGames)
    }
    if (options.maxGames !== undefined) {
      const maxGames = options.maxGames
      filtered = filtered.filter((entry) => entry.totalgames <= maxGames)
    }

    if (options.sortBy) {
      const sortBy = options.sortBy
      filtered = [...filtered].sort((a, b) => {
        const aVal = a[sortBy]
        const bVal = b[sortBy]
        const order = options.sortOrder === 'asc' ? 1 : -1
        return aVal < bVal ? -order : aVal > bVal ? order : 0
      })
    }

    const total = filtered.length

    if (options.page !== undefined || options.pageSize !== undefined) {
      const page = options.page ?? 1
      const pageSize = options.pageSize ?? 50
      const offset = (page - 1) * pageSize
      const paginated = filtered.slice(offset, offset + pageSize)

      return {
        data: paginated,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
        isStale: false,
      }
    }

    return {
      data: filtered,
      total,
      isStale: false,
    }
  }

  async refreshLeaderboard(queue_id: string): Promise<LeaderboardResponse> {
    currentRunId = crypto.randomUUID()
    logMemory('refresh_start', { queue_id })

    try {
      console.log('Refreshing leaderboard for queue:', queue_id)
      const start = performance.now()
      const fresh = await botlatro_service.get_leaderboard(queue_id)
      const end = performance.now()
      console.log(
        `Fetching fresh data took ${(end - start).toFixed(2)}ms for queue ${queue_id}`
      )

      logMemory('after_api_fetch', { entries_count: fresh.length })

      const start2 = performance.now()
      console.log('Updating Redis cache for leaderboard:', queue_id)
      const zsetKey = this.getZSetKey(queue_id)
      const rawKey = this.getRawKey(queue_id)
      const activeSeasonNumber = await this.getActiveSeasonNumber()
      const activeSeasonKey = this.getSeasonKey(queue_id, activeSeasonNumber)

      logMemory('before_initial_pipeline')
      console.log('Clearing leaderboard caches:', {
        queue_id,
        rawKey,
        zsetKey,
        activeSeasonKey,
      })

      const initialPipeline = redis.multi()
      initialPipeline.setEx(
        rawKey,
        LeaderboardService.LIVE_SEASON_CACHE_TTL_SECONDS,
        JSON.stringify(fresh)
      )
      initialPipeline.del(zsetKey)
      initialPipeline.del(activeSeasonKey)
      await initialPipeline.exec()

      logMemory('after_initial_pipeline')

      const BATCH_SIZE = 1000
      for (let i = 0; i < fresh.length; i += BATCH_SIZE) {
        const batch = fresh.slice(i, i + BATCH_SIZE)
        const batchPipeline = redis.multi()

        for (const entry of batch) {
          batchPipeline.zAdd(zsetKey, { score: entry.mmr, value: entry.id })
          batchPipeline.hSet(
            this.getUserKey(entry.id, queue_id),
            toRedisLeaderboardEntry(entry, queue_id)
          )
        }

        await batchPipeline.exec()

        logMemory(`after_redis_batch_${Math.floor(i / BATCH_SIZE)}`, {
          batch_index: Math.floor(i / BATCH_SIZE),
          batch_size: batch.length,
        })
      }

      await redis.expire(
        zsetKey,
        LeaderboardService.LIVE_SEASON_CACHE_TTL_SECONDS
      )

      logMemory('after_expire')
      if (global.gc) {
        console.log('[debug] forcing gc...')
        const before = process.memoryUsage().heapUsed / 1024 / 1024
        global.gc()
        const after = process.memoryUsage().heapUsed / 1024 / 1024
        console.log(
          `[debug] heapUsed before gc: ${before.toFixed(2)} MB, after: ${after.toFixed(2)} MB`
        )
      } else {
        console.warn('[debug] gc not exposed, run node with --expose-gc')
      }
      const end2 = performance.now()
      console.log('Redis cache update took:', (end2 - start2).toFixed(2))
      console.log('Leaderboard refresh complete:', {
        queue_id,
        entries: fresh.length,
        durationMs: Number((end2 - start2).toFixed(2)),
      })

      logMemory('refresh_end')
      currentRunId = null

      if (global.gc) {
        global.gc()
      }

      return { data: fresh, isStale: false }
    } catch (error) {
      console.error('Error refreshing leaderboard:', error)
      logMemory('refresh_error', { error: String(error) })
      currentRunId = null

      const backupKey = this.getBackupKey(queue_id)
      const backup = await db
        .select()
        .from(metadata)
        .where(eq(metadata.key, backupKey))
        .limit(1)
        .then((res) => res[0])

      if (backup) {
        const parsedBackup = JSON.parse(backup.value)
        console.log(
          `Using backup leaderboard data from ${parsedBackup.timestamp} in refreshLeaderboard`
        )
        return { data: parsedBackup.data as LeaderboardEntry[], isStale: true }
      }

      console.log(
        'No backup leaderboard data available for refreshLeaderboard, returning empty array'
      )
      return { data: [], isStale: true }
    }
  }

  async getLeaderboard(
    queue_id: string,
    options?: PaginationOptions
  ): Promise<LeaderboardResponse> {
    try {
      const cached = await redis.get(this.getRawKey(queue_id))
      let data: LeaderboardEntry[]
      let isStale = false

      if (cached) {
        data = JSON.parse(cached) as LeaderboardEntry[]
      } else {
        const result = await this.refreshLeaderboard(queue_id)
        data = result.data
        isStale = result.isStale
      }

      if (!options) {
        return { data, isStale }
      }

      const result = this.applyFiltersAndPagination(data, options)
      return { ...result, isStale }
    } catch (error) {
      console.error('Error getting leaderboard from botlatro:', error)

      const backupKey = this.getBackupKey(queue_id)
      const backup = await db
        .select()
        .from(metadata)
        .where(eq(metadata.key, backupKey))
        .limit(1)
        .then((res) => res[0])

      if (backup) {
        const parsedBackup = JSON.parse(backup.value)
        console.log(
          `Using backup leaderboard data from ${parsedBackup.timestamp}`
        )
        const data = parsedBackup.data as LeaderboardEntry[]

        if (!options) {
          return { data, isStale: true }
        }

        const result = this.applyFiltersAndPagination(data, options)
        return { ...result, isStale: true }
      }

      console.log(
        'No backup leaderboard data available for getLeaderboard, returning empty array'
      )
      return {
        data: [],
        isStale: true,
        total: 0,
        page: options?.page ?? 1,
        pageSize: options?.pageSize ?? 50,
        totalPages: 0,
      }
    }
  }

  async getLeaderboardSnapshots(
    queue_id: string,
    limit = 100
  ): Promise<LeaderboardSnapshotResponse[]> {
    try {
      const snapshots = await db
        .select()
        .from(leaderboardSnapshots)
        .where(eq(leaderboardSnapshots.channelId, queue_id))
        .orderBy(desc(leaderboardSnapshots.timestamp))
        .limit(limit)

      return snapshots.map((snapshot) => {
        return {
          data: parseLeaderboardPayload(snapshot.data),
          timestamp: snapshot.timestamp.toISOString(),
          queue_id: snapshot.channelId,
        }
      })
    } catch (error) {
      console.error(
        'Error getting leaderboard snapshots from dedicated table:',
        error
      )

      try {
        const prefix = this.getSnapshotPrefix(queue_id)

        const oldSnapshots = await db
          .select()
          .from(metadata)
          .where(sql`${metadata.key} LIKE ${`${prefix}%`}`)
          .orderBy(sql`${metadata.key} DESC`)
          .limit(limit)

        return oldSnapshots.map((snapshot) => {
          const parsedValue = JSON.parse(
            snapshot.value
          ) as StoredLeaderboardSnapshot
          return {
            data: parsedValue.data as LeaderboardEntry[],
            timestamp: parsedValue.timestamp,
            queue_id: parsedValue.queue_id,
          }
        })
      } catch (fallbackError) {
        console.error(
          'Error getting leaderboard snapshots from metadata fallback:',
          fallbackError
        )
        return []
      }
    }
  }

  async getUserRank(
    queue_id: string,
    user_id: string
  ): Promise<UserRankResponse> {
    try {
      const userData = await redis.hGetAll(this.getUserKey(user_id, queue_id))
      if (userData && Object.keys(userData).length > 0) {
        return {
          data: {
            ...userData,
            mmr: Number(userData.mmr),
            streak: userData.streak,
          } as unknown as LeaderboardEntry,
          isStale: false,
        }
      }

      try {
        const { data: freshLeaderboard } =
          await this.refreshLeaderboard(queue_id)
        const userEntry = freshLeaderboard.find((entry) => entry.id === user_id)
        if (userEntry) {
          return { data: userEntry, isStale: false }
        }
      } catch (refreshError) {
        console.error(
          'Error refreshing leaderboard for user rank:',
          refreshError
        )
      }

      const backupKey = this.getBackupKey(queue_id)
      const backup = await db
        .select()
        .from(metadata)
        .where(eq(metadata.key, backupKey))
        .limit(1)
        .then((res) => res[0])

      if (backup) {
        const parsedBackup = JSON.parse(
          backup.value
        ) as StoredLeaderboardSnapshot
        const userEntry = parsedBackup.data.find(
          (entry) => entry.id === user_id
        )
        if (userEntry) {
          console.log(
            `Using backup leaderboard data for user ${user_id} from ${parsedBackup.timestamp}`
          )
          return { data: userEntry as LeaderboardEntry, isStale: true }
        }
      }

      return null
    } catch (error) {
      console.error('Error getting user rank:', error)
      return null
    }
  }
}

export const leaderboardService = new LeaderboardService()
