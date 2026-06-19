import { Suspense } from 'react'
import { GamesClient } from '@/app/(home)/admin/games/games-client'
import { hasPermission } from '@/lib/permissions'
import { auth } from '@/server/auth'
import { createMetadata } from '../../../../../lib/metadata'

export const metadata = createMetadata({
  title: 'Games',
  description: 'Browse extracted multiplayer games.',
  path: '/admin/games',
  noIndex: true,
})

export default async function GamesPage() {
  const session = await auth()
  const canViewGames = hasPermission(session?.user, 'games.view')

  if (!canViewGames) {
    return (
      <div className='mx-auto flex w-[calc(100%-1rem)] max-w-fd-container flex-col py-8'>
        <div className='prose'>
          <h1>Forbidden</h1>
        </div>
      </div>
    )
  }

  return (
    <Suspense>
      <div className='mx-auto flex w-[calc(100%-1rem)] max-w-fd-container flex-col gap-4 py-8'>
        <h1 className='font-bold text-3xl'>Games</h1>
        <GamesClient />
      </div>
    </Suspense>
  )
}
