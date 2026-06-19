import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { hasPermission } from '@/lib/permissions'
import { auth } from '@/server/auth'
import { api, HydrateClient } from '@/trpc/server'
import { createMetadata } from '../../../../../lib/metadata'
import { ModerationClient } from './moderation-client'

export const metadata = createMetadata({
  title: 'Moderation',
  description: 'Search and manage strikes and bans from the web admin panel.',
  path: '/admin/moderation',
  noIndex: true,
})

export default async function ModerationPage() {
  const session = await auth()
  const permissions = session?.user?.permissions ?? []

  if (!hasPermission(session?.user, 'moderation.view')) {
    redirect('/')
  }

  await api.moderation.listAllMembers.prefetch({
    page: 1,
    limit: 12,
  })

  return (
    <Suspense>
      <HydrateClient>
        <ModerationClient permissions={permissions} />
      </HydrateClient>
    </Suspense>
  )
}
