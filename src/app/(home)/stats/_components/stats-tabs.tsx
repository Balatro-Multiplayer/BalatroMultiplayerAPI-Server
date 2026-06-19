'use client'

import { useQueryState } from 'nuqs'
import { Suspense, useMemo } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import type { Season } from '@/shared/seasons'
import { createStatsSearchParamsParsers, STAT_TABS } from '../search-params'
import { DeckPopularityChart } from './deck-popularity-chart'
import { GameActivityChart } from './game-activity-chart'
import { LiveMatchesTab } from './live-matches-tab'
import { RatingDistributionChart } from './rating-distribution-chart'
import { SeasonOverviewChart } from './season-overview-chart'
import { StakePopularityChart } from './stake-popularity-chart'

const TABS = STAT_TABS.map((value) => ({
  value,
  label:
    value === 'rating-distribution'
      ? 'Rating Distribution'
      : value === 'deck-popularity'
        ? 'Deck Popularity'
        : value === 'stake-popularity'
          ? 'Stake Popularity'
          : value === 'season-overview'
            ? 'Season Overview'
            : value === 'live-matches'
              ? 'Live Matches'
              : value === 'bounties'
                ? 'Bounties'
                : 'Game Activity',
}))

type StatsTabsProps = {
  defaultSeason: Season
  statsSeasons: Season[]
}

function StatsContent({
  tab,
  defaultSeason,
  statsSeasons,
}: {
  tab: string
  defaultSeason: Season
  statsSeasons: Season[]
}) {
  switch (tab) {
    case 'game-activity':
      return <GameActivityChart />
    case 'rating-distribution':
      return (
        <RatingDistributionChart
          defaultSeason={defaultSeason}
          statsSeasons={statsSeasons}
        />
      )
    case 'deck-popularity':
      return (
        <DeckPopularityChart
          defaultSeason={defaultSeason}
          statsSeasons={statsSeasons}
        />
      )
    case 'stake-popularity':
      return (
        <StakePopularityChart
          defaultSeason={defaultSeason}
          statsSeasons={statsSeasons}
        />
      )
    case 'season-overview':
      return <SeasonOverviewChart />
    case 'live-matches':
      return <LiveMatchesTab />
    default:
      return null
  }
}

export function StatsTabs({ defaultSeason, statsSeasons }: StatsTabsProps) {
  const parsers = useMemo(
    () => createStatsSearchParamsParsers(defaultSeason),
    [defaultSeason]
  )
  const [tab, setTab] = useQueryState('tab', parsers.tab)

  return (
    <div className='flex flex-col gap-2'>
      {/* Mobile: dropdown */}
      <Select
        value={tab}
        onValueChange={(value) => setTab(value as (typeof STAT_TABS)[number])}
      >
        <SelectTrigger className='w-full sm:hidden'>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {TABS.map((t) => (
            <SelectItem key={t.value} value={t.value}>
              {t.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Desktop: tabs */}
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as (typeof STAT_TABS)[number])}
      >
        <TabsList className='hidden w-full sm:inline-flex'>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <Suspense>
        <StatsContent
          tab={tab}
          defaultSeason={defaultSeason}
          statsSeasons={statsSeasons}
        />
      </Suspense>
    </div>
  )
}
