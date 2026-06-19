import { z } from 'zod'

export const SEASON_1_START_DATE = new Date('2000-01-01T00:00:00.000Z')
export const SEASON_2_START_DATE = new Date('2025-04-02T13:00:00.000Z')
export const SEASON_3_START_DATE = new Date('2025-06-02T13:00:00.000Z')
export const SEASON_4_START_DATE = new Date('2025-09-01T05:00:00.000Z')
export const SEASON_5_START_DATE = new Date('2025-11-30T18:08:00.000Z')
export const SEASON_6_START_DATE = new Date('2026-02-27T18:00:00.000Z')

// Season type for selection
export const SeasonSchema = z.string().regex(/^season\d+$/)
export type Season = string

type SeasonRowLike = {
  id: number
  isActive: boolean
}

export function isSeason(value: unknown): value is Season {
  return SeasonSchema.safeParse(value).success
}

// Helper function to filter games by season
export function filterGamesBySeason<T extends { season?: string | null }>(
  games: T[],
  season: Season
): T[] {
  return games.filter((game) => game.season === season)
}

export function getSeasonKey(seasonId: number): Season {
  return `season${seasonId}`
}

export function getActiveSeason(
  seasons: SeasonRowLike[] | undefined
): Season | null {
  if (!seasons?.length) return null

  const activeSeason =
    seasons.find((season) => season.isActive) ?? seasons.at(-1)

  return activeSeason ? getSeasonKey(activeSeason.id) : null
}

// Helper function to get a display name for a season
export function getSeasonDisplayName(season: Season): string {
  const match = /^season(\d+)$/.exec(season)
  return match ? `Season ${match[1]}` : season
}
