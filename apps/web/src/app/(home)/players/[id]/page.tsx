import type { Metadata } from 'next'
import { Suspense } from 'react'
import {
  LEGACY_QUEUE_ID,
  RANKED_QUEUE_ID,
  SMALLWORLD_QUEUE_ID,
  VANILLA_QUEUE_ID,
} from '@/shared/constants'
import { api, HydrateClient } from '@/trpc/server'
import { createMetadata } from '../../../../../lib/metadata'
import { UserInfo } from './user'

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    page?: string
    sortBy?: string
    sortOrder?: string
  }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params

  try {
    const user = await api.players.get_user_by_id({ user_id: id })
    const name = user.display_name

    return createMetadata({
      title: `${name} Profile`,
      description: `View ${name}'s Balatro Multiplayer profile, match history, ranks, and deck performance.`,
      path: `/players/${id}`,
    })
  } catch (_error) {
    return createMetadata({
      title: 'Player Profile',
      description:
        'View Balatro Multiplayer player history, ranks, and season performance.',
      path: `/players/${id}`,
      noIndex: true,
    })
  }
}

export default async function PlayerPage({ params, searchParams }: Props) {
  const { id } = await params
  const sp = await searchParams

  const page = sp.page ? Number.parseInt(sp.page, 10) : 1
  const sortByVals = [
    'gameTime',
    'opponentName',
    'gameType',
    'deck',
    'stake',
    'opponentMmr',
    'playerMmr',
    'mmrChange',
  ] as const
  type SortBy = (typeof sortByVals)[number]
  const sortBySet: ReadonlySet<string> = new Set(sortByVals)
  const sortBy = sortBySet.has(sp.sortBy ?? '')
    ? (sp.sortBy as SortBy)
    : 'gameTime'
  const sortOrder = sp.sortOrder === 'asc' ? 'asc' : 'desc'

  if (id) {
    await Promise.all([
      api.bounties.get_user_bounties.prefetch({ user_id: id }),
      api.history.user_games.prefetch({ user_id: id }),
      api.history.user_games_page.prefetch({
        user_id: id,
        season: 'season6',
        page: Number.isFinite(page) && page >= 1 ? page : 1,
        pageSize: 50,
        sortBy,
        sortOrder,
      }),
      api.players.get_user_by_id.prefetch({
        user_id: id,
      }),
      api.leaderboard.get_leaderboard.prefetch({
        channel_id: RANKED_QUEUE_ID,
      }),
      api.leaderboard.get_leaderboard.prefetch({
        channel_id: SMALLWORLD_QUEUE_ID,
      }),
      api.leaderboard.get_leaderboard.prefetch({
        channel_id: VANILLA_QUEUE_ID,
      }),
      api.leaderboard.get_leaderboard.prefetch({
        channel_id: LEGACY_QUEUE_ID,
      }),
      api.leaderboard.get_user_rank.prefetch({
        channel_id: RANKED_QUEUE_ID,
        user_id: id,
      }),
      api.leaderboard.get_user_rank.prefetch({
        channel_id: SMALLWORLD_QUEUE_ID,
        user_id: id,
      }),
      api.leaderboard.get_user_rank.prefetch({
        channel_id: VANILLA_QUEUE_ID,
        user_id: id,
      }),
      api.leaderboard.get_user_rank.prefetch({
        channel_id: LEGACY_QUEUE_ID,
        user_id: id,
      }),
    ])
  }
  return (
    <Suspense>
      <HydrateClient>
        <UserInfo />
      </HydrateClient>
    </Suspense>
  )
}
