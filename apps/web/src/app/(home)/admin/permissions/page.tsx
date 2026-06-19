import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { hasPermission } from '@/lib/permissions'
import { auth } from '@/server/auth'
import { api, HydrateClient } from '@/trpc/server'
import { createMetadata } from '../../../../../lib/metadata'
import { PermissionsClient } from './permissions-client'

export const metadata = createMetadata({
  title: 'Manage Permissions',
  description: 'Manage per-user permissions for Balatro Multiplayer.',
  path: '/admin/permissions',
  noIndex: true,
})

export default async function PermissionsPage() {
  const session = await auth()

  if (!hasPermission(session?.user, 'permissions.manage')) {
    redirect('/')
  }

  await api.users.listUsers.prefetch({
    page: 1,
    pageSize: 50,
    sortBy: 'name',
    sortOrder: 'asc',
  })

  return (
    <Suspense>
      <HydrateClient>
        <div className='mx-auto flex w-[calc(100%-1rem)] max-w-fd-container flex-col gap-4 pt-8'>
          <h1 className='font-bold text-3xl'>Manage Permissions</h1>
          <PermissionsClient />
        </div>
      </HydrateClient>
    </Suspense>
  )
}
