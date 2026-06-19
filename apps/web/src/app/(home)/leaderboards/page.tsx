import { LeaderboardPage } from '@/app/_components/leaderboard'
import {
  getActiveSeasonNumber,
  getSeasonKey,
  getSeasonNumber,
} from '@/server/seasons'
import type { PaginationOptions } from '@/server/services/leaderboard'
import { type Season, SeasonSchema } from '@/shared/seasons'
import { api, HydrateClient } from '@/trpc/server'
import { createMetadata } from '../../../../lib/metadata'

export const metadata = createMetadata({
  title: 'Leaderboards',
  description:
    'Track ranked, vanilla, smallworld, and legacy Balatro Multiplayer standings across every season.',
  path: '/leaderboards',
})

function getDefaultQueueType(snapshots: Array<{ queueType: string }>) {
  return snapshots[0]?.queueType ?? 'ranked'
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string
    season?: string
    page?: string
    search?: string
    minGames?: string
    maxGames?: string
    sortBy?: string
    sortOrder?: string
  }>
}) {
  const params = await searchParams

  const seasons = await api.seasons.list()
  const seasonIds = new Set(seasons.map((season) => season.id))

  const activeSeasonNumber =
    seasons.find((s) => s.isActive)?.id ??
    seasons.at(-1)?.id ??
    (await getActiveSeasonNumber())
  const activeSeason = getSeasonKey(activeSeasonNumber)

  const requestedSeason =
    SeasonSchema.safeParse(params.season).success &&
    params.season !== undefined &&
    seasonIds.has(getSeasonNumber(params.season as Season) ?? -1)
      ? (params.season as Season)
      : activeSeason
  const selectedSeasonId =
    getSeasonNumber(requestedSeason) ?? activeSeasonNumber
  const snapshots = await api.seasons.list_snapshots({
    seasonId: selectedSeasonId,
  })
  const type = snapshots.some((snapshot) => snapshot.queueType === params.type)
    ? (params.type ?? getDefaultQueueType(snapshots))
    : getDefaultQueueType(snapshots)
  const selectedSnapshot =
    snapshots.find((snapshot) => snapshot.queueType === type) ?? snapshots[0]
  const season = requestedSeason
  const page = params.page ? Number.parseInt(params.page, 10) : 1
  const search = params.search
  const minGames = params.minGames
    ? Number.parseInt(params.minGames, 10)
    : undefined
  const maxGames = params.maxGames
    ? Number.parseInt(params.maxGames, 10)
    : undefined
  const sortBy = params.sortBy
  const sortOrder = params.sortOrder as 'asc' | 'desc' | undefined

  if (selectedSnapshot) {
    await api.leaderboard.get_leaderboard.prefetch({
      channel_id: selectedSnapshot.queueId,
      season,
      page,
      pageSize: 50,
      search: search || undefined,
      minGames,
      maxGames,
      sortBy: sortBy as PaginationOptions['sortBy'],
      sortOrder,
    })
  }

  return (
    <HydrateClient>
      <LeaderboardPage
        activeSeason={activeSeason}
        initialSeason={season}
        initialSeasons={seasons}
        initialSnapshots={snapshots}
      />
    </HydrateClient>
  )
}
