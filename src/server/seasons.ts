import { asc } from 'drizzle-orm'
import { db } from '@/server/db'
import { seasons } from '@/server/db/schema'
import { redis } from '@/server/redis'
import type { Season } from '@/shared/seasons'

export type SeasonConfig = {
  id: number
  name: string
  startDate: Date
  endDate: Date | null
  isActive: boolean
}

export const SEASONS_CACHE_KEY = 'config:seasons'
const ACTIVE_SEASON_CACHE_KEY = 'config:active_season'

function serializeSeasons(seasons: SeasonConfig[]) {
  return JSON.stringify(
    seasons.map((season) => ({
      ...season,
      startDate: season.startDate.toISOString(),
      endDate: season.endDate?.toISOString() ?? null,
    }))
  )
}

function deserializeSeasons(value: string): SeasonConfig[] {
  const parsed = JSON.parse(value) as Array<{
    id: number
    name: string
    startDate: string
    endDate: string | null
    isActive: boolean
  }>

  return parsed.map((season) => ({
    ...season,
    startDate: new Date(season.startDate),
    endDate: season.endDate ? new Date(season.endDate) : null,
  }))
}

async function loadSeasons(): Promise<SeasonConfig[]> {
  const cached = await redis.get(SEASONS_CACHE_KEY)
  if (cached) {
    return deserializeSeasons(cached)
  }

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

  await redis.set(SEASONS_CACHE_KEY, serializeSeasons(loadedSeasons))

  return loadedSeasons
}

export async function getSeasons(): Promise<SeasonConfig[]> {
  return loadSeasons()
}

export function getSeasonNumber(season: Season): number | null {
  const match = /^season(\d+)$/.exec(season)
  if (!match) return null

  const seasonNumber = Number(match[1])
  return Number.isInteger(seasonNumber) ? seasonNumber : null
}

export function getSeasonKey(seasonId: number): Season {
  return `season${seasonId}`
}

export async function getSeasonConfig(
  season: Season | number
): Promise<SeasonConfig | undefined> {
  const seasonId = typeof season === 'number' ? season : getSeasonNumber(season)
  if (!seasonId) return undefined

  const loadedSeasons = await loadSeasons()
  return loadedSeasons.find((entry) => entry.id === seasonId)
}

export async function getActiveSeasonNumber(): Promise<number> {
  const cached = await redis.get(ACTIVE_SEASON_CACHE_KEY)
  if (cached) {
    const seasonNumber = Number(cached)
    if (Number.isInteger(seasonNumber) && seasonNumber > 0) {
      return seasonNumber
    }
  }

  const loadedSeasons = await loadSeasons()
  const activeSeason =
    loadedSeasons.find((season) => season.isActive) ??
    loadedSeasons[loadedSeasons.length - 1]

  const seasonNumber = activeSeason?.id ?? 1
  await redis.set(ACTIVE_SEASON_CACHE_KEY, seasonNumber.toString())

  return seasonNumber
}

export async function getSeasonDateRange(
  season: Season
): Promise<{ start: Date; end: Date }> {
  const config = await getSeasonConfig(season)
  if (!config) {
    throw new Error(`Unknown season: ${season}`)
  }

  return {
    start: config.startDate,
    end: config.endDate ?? new Date('2099-01-01T00:00:00.000Z'),
  }
}

export async function getSeasonForDate(date: Date): Promise<Season> {
  const loadedSeasons = await loadSeasons()

  const matchedSeason = loadedSeasons.find((season) => {
    if (date < season.startDate) {
      return false
    }

    return season.endDate ? date < season.endDate : season.isActive
  })

  if (matchedSeason) {
    return getSeasonKey(matchedSeason.id)
  }

  for (let i = loadedSeasons.length - 1; i >= 0; i -= 1) {
    const season = loadedSeasons[i]
    if (season && date >= season.startDate) {
      return getSeasonKey(season.id)
    }
  }

  if (loadedSeasons[0]) {
    return getSeasonKey(loadedSeasons[0].id)
  }

  return 'season1'
}
