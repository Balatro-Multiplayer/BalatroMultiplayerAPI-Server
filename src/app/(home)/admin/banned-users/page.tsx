import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { hasPermission } from '@/lib/permissions'
import { auth } from '@/server/auth'
import { api, HydrateClient } from '@/trpc/server'
import { createMetadata } from '../../../../../lib/metadata'
import { BannedUsersClient } from './banned-users-client'

export const metadata = createMetadata({
  title: 'Banned Users',
  description: 'Manage banned user aliases and ids used by the log parser.',
  path: '/admin/banned-users',
  noIndex: true,
})

export default async function BannedUsersPage() {
  const session = await auth()

  if (!hasPermission(session?.user, 'banned_users.manage')) {
    redirect('/')
  }

  await api.bannedUsers.list.prefetch({
    page: 1,
    pageSize: 50,
    sortBy: 'updatedAt',
    sortOrder: 'desc',
  })

  return (
    <Suspense>
      <HydrateClient>
        <div className='mx-auto flex w-[calc(100%-1rem)] max-w-fd-container flex-col gap-4 pt-8'>
          <h1 className='font-bold text-3xl'>Banned Users</h1>
          <BannedUsersClient />
        </div>
      </HydrateClient>
    </Suspense>
  )
}
