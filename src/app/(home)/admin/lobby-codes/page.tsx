import { Suspense } from 'react'
import { LobbyCodesClient } from '@/app/(home)/admin/lobby-codes/lobby-codes-client'
import { hasPermission } from '@/lib/permissions'
import { auth } from '@/server/auth'
import { api, HydrateClient } from '@/trpc/server'
import { createMetadata } from '../../../../../lib/metadata'

export const metadata = createMetadata({
  title: 'Lobby Codes',
  description: 'Search lobby codes extracted from internal match transcripts.',
  path: '/admin/lobby-codes',
  noIndex: true,
})

export default async function LobbyCodesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await auth()
  const canSearchLobbyCodes = hasPermission(session?.user, 'transcripts.search')

  if (!canSearchLobbyCodes) {
    return (
      <div className='mx-auto flex w-[calc(100%-1rem)] max-w-fd-container flex-col py-8'>
        <div className='prose'>
          <h1>Forbidden</h1>
        </div>
      </div>
    )
  }

  const params = await searchParams
  const search = typeof params.search === 'string' ? params.search.trim() : ''

  if (search.length > 0) {
    await api.history.searchTranscriptLobbyCodes.prefetch({
      query: search,
      limit: 50,
    })
  }

  return (
    <Suspense>
      <HydrateClient>
        <div className='mx-auto flex w-[calc(100%-1rem)] max-w-fd-container flex-col gap-4 py-8'>
          <div className='space-y-1'>
            <h1 className='font-bold text-3xl'>Lobby Codes</h1>
            <p className='text-fd-muted-foreground text-sm'>
              Search lobby codes extracted from match transcripts.
            </p>
          </div>
          <LobbyCodesClient
            canViewTranscripts={hasPermission(
              session?.user,
              'transcripts.view'
            )}
          />
        </div>
      </HydrateClient>
    </Suspense>
  )
}
