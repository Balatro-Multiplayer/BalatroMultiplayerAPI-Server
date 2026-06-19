import {
  CASUAL_QUEUE_ID,
  RANKED_QUEUE_ID,
  SMALLWORLD_QUEUE_ID,
  VANILLA_QUEUE_ID,
} from '@/shared/constants'
import type { Season } from '@/shared/seasons'

export const STAT_TABS = [
  'rating-distribution',
  'deck-popularity',
  'stake-popularity',
  'season-overview',
  'game-activity',
  'live-matches',
  'bounties',
] as const

export const STATS_FILTER_MODES = ['season', 'dateRange'] as const

export function getStatsSeasons(seasons: Array<{ id: number }>): Season[] {
  return [...seasons]
    .sort((a, b) => b.id - a.id)
    .map((season) => `season${season.id}` as Season)
}

export function resolveStatsSeason(
  value: string | null | undefined,
  availableSeasons: readonly Season[],
  fallbackSeason: Season
): Season {
  return availableSeasons.includes(value as Season)
    ? (value as Season)
    : fallbackSeason
}

export const STATS_QUEUES = [
  'all',
  RANKED_QUEUE_ID,
  VANILLA_QUEUE_ID,
  SMALLWORLD_QUEUE_ID,
  CASUAL_QUEUE_ID,
] as const
