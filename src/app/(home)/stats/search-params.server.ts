import { parseAsString, parseAsStringLiteral } from 'nuqs/server'
import type { Season } from '@/shared/seasons'
import {
  STAT_TABS,
  STATS_FILTER_MODES,
  STATS_QUEUES,
} from './search-params.constants'

export function createStatsSearchParamsParsersServer(defaultSeason: Season) {
  return {
    tab: parseAsStringLiteral(STAT_TABS).withDefault('rating-distribution'),

    deckMode: parseAsStringLiteral(STATS_FILTER_MODES).withDefault('season'),
    deckSeason: parseAsString.withDefault(defaultSeason),
    deckStartDate: parseAsString,
    deckEndDate: parseAsString,
    deckQueueId: parseAsStringLiteral(STATS_QUEUES).withDefault('all'),

    stakeMode: parseAsStringLiteral(STATS_FILTER_MODES).withDefault('season'),
    stakeSeason: parseAsString.withDefault(defaultSeason),
    stakeStartDate: parseAsString,
    stakeEndDate: parseAsString,
    stakeQueueId: parseAsStringLiteral(STATS_QUEUES).withDefault('all'),
  }
}
