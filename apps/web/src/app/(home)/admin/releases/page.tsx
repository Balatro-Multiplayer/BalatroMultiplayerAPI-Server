import { Suspense } from 'react'
import { ReleasesClient } from '@/app/(home)/admin/releases/releases-client'
import { hasPermission } from '@/lib/permissions'
import { auth } from '@/server/auth'
import { api, HydrateClient } from '@/trpc/server'
import { createMetadata } from '../../../../../lib/metadata'

export const metadata = createMetadata({
  title: 'Releases',
  description: 'Manage release records and associated branches.',
  path: '/admin/releases',
  noIndex: true,
})

export default async function ReleasesPage() {
  const session = await auth()
  if (!hasPermission(session?.user, 'releases.manage')) {
    return (
      <div className='mx-auto flex w-[calc(100%-1rem)] max-w-fd-container flex-col py-8'>
        <div className={'prose'}>
          <h1>Forbidden</h1>
        </div>
      </div>
    )
  }

  await Promise.all([
    api.releases.getReleases.prefetch({
      page: 1,
      pageSize: 50,
      sortBy: 'createdAt',
      sortOrder: 'desc',
    }),
    api.branches.getBranches.prefetch(),
  ])

  return (
    <Suspense>
      <HydrateClient>
        <div
          className={
            'mx-auto flex w-[calc(100%-1rem)] max-w-fd-container flex-col gap-4 pt-16 pb-8'
          }
        >
          <ReleasesClient />
        </div>
      </HydrateClient>
    </Suspense>
  )
}
