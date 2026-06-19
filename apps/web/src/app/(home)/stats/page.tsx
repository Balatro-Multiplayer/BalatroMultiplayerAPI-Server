import { createLoader } from 'nuqs/server'
import { Suspense } from 'react'
import { getActiveSeasonNumber, getSeasonKey } from '@/server/seasons'
import type { Season } from '@/shared/seasons'
import { api, HydrateClient } from '@/trpc/server'
import { createMetadata } from '../../../../lib/metadata'
import { StatsTabs } from './_components/stats-tabs'
import { getStatsSeasons, resolveStatsSeason } from './search-params.constants'
import { createStatsSearchParamsParsersServer } from './search-params.server'

export const metadata = createMetadata({
  title: 'Stats',
  description:
    'Explore Balatro Multiplayer charts for game activity, deck popularity, stake trends, and rating distribution.',
  path: '/stats',
})

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const [seasonRows, activeSeasonNumber] = await Promise.all([
    api.seasons.list(),
    getActiveSeasonNumber(),
  ])
  const statsSeasons = getStatsSeasons(seasonRows)
  const activeSeason = getSeasonKey(activeSeasonNumber)
  const defaultSeason =
    (statsSeasons.includes(activeSeason) ? activeSeason : statsSeasons[0]) ??
    ('season1' as Season)
  const defaultSeasonId = Number(defaultSeason.replace('season', ''))
  const defaultSeasonSnapshots = await api.seasons.list_snapshots({
    seasonId: defaultSeasonId,
  })
  const defaultRankedSnapshot =
    defaultSeasonSnapshots.find(
      (snapshot) => snapshot.queueType === 'ranked'
    ) ?? defaultSeasonSnapshots[0]
  const loadSearchParams = createLoader(
    createStatsSearchParamsParsersServer(defaultSeason)
  )
  const params = await loadSearchParams(searchParams)
  const deckSeason = resolveStatsSeason(
    params.deckSeason,
    statsSeasons,
    defaultSeason
  )
  const stakeSeason = resolveStatsSeason(
    params.stakeSeason,
    statsSeasons,
    defaultSeason
  )

  const deckPrefetchInput = {
    mode: params.deckMode,
    season: params.deckMode === 'season' ? deckSeason : undefined,
    startDate:
      params.deckMode === 'dateRange'
        ? (params.deckStartDate ?? undefined)
        : undefined,
    endDate:
      params.deckMode === 'dateRange'
        ? (params.deckEndDate ?? undefined)
        : undefined,
    queueId: params.deckQueueId === 'all' ? undefined : params.deckQueueId,
  } as const

  const stakePrefetchInput = {
    mode: params.stakeMode,
    season: params.stakeMode === 'season' ? stakeSeason : undefined,
    startDate:
      params.stakeMode === 'dateRange'
        ? (params.stakeStartDate ?? undefined)
        : undefined,
    endDate:
      params.stakeMode === 'dateRange'
        ? (params.stakeEndDate ?? undefined)
        : undefined,
    queueId: params.stakeQueueId === 'all' ? undefined : params.stakeQueueId,
  } as const

  await Promise.all([
    api.history.games_per_hour.prefetch({ groupBy: 'hour' }),
    api.stats.deck_popularity.prefetch(deckPrefetchInput),
    api.stats.stake_popularity.prefetch(stakePrefetchInput),
    api.stats.season_overview.prefetch(),
    ...(defaultRankedSnapshot
      ? [
          api.leaderboard.rating_distribution.prefetch({
            channel_id: defaultRankedSnapshot.queueId,
            season: defaultSeason,
          }),
        ]
      : []),
  ])

  return (
    <div className='mx-auto flex w-[calc(100%-1rem)] max-w-fd-container flex-1 flex-col py-8'>
      <h1 className='mb-6 font-bold text-3xl'>Stats</h1>
      <Suspense>
        <HydrateClient>
          <StatsTabs
            defaultSeason={defaultSeason}
            statsSeasons={statsSeasons}
          />
        </HydrateClient>
      </Suspense>
    </div>
  )
}
