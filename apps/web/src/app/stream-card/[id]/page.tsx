import type { Metadata } from 'next'
import { Suspense } from 'react'
import { StreamCardClient } from '@/app/stream-card/[id]/_components/stream-card-client'
import { RANKED_QUEUE_ID } from '@/shared/constants'
import { api, HydrateClient } from '@/trpc/server'
import { createMetadata } from '../../../../lib/metadata'

type Props = {
  params: Promise<{ id: string }>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params

  return createMetadata({
    title: 'Stream Card',
    description: 'Broadcast-ready Balatro Multiplayer player card overlay.',
    path: `/stream-card/${id}`,
    noIndex: true,
  })
}

export default async function StreamCardPage({ params }: Props) {
  const { id } = await params
  if (id) {
    await Promise.all([
      api.history.user_games.prefetch({
        user_id: id,
      }),

      api.leaderboard.get_user_rank.prefetch({
        channel_id: RANKED_QUEUE_ID,
        user_id: id,
      }),
    ])
  }

  return (
    <Suspense>
      <HydrateClient>
        <StreamCardClient />
      </HydrateClient>
    </Suspense>
  )
}
