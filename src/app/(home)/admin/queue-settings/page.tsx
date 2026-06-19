import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { hasPermission } from '@/lib/permissions'
import { auth } from '@/server/auth'
import { api, HydrateClient } from '@/trpc/server'
import { createMetadata } from '../../../../../lib/metadata'
import { QueueSettingsClient } from './queue-settings-client'

export const metadata = createMetadata({
  title: 'Queue Settings',
  description: 'View and edit queue settings from the bot.',
  path: '/admin/queue-settings',
  noIndex: true,
})

export default async function AdminQueueSettingsPage() {
  const session = await auth()

  if (!hasPermission(session?.user, 'queues.manage')) {
    redirect('/')
  }

  await api.queues.getSettings.prefetch()

  return (
    <Suspense>
      <HydrateClient>
        <div className='mx-auto flex w-[calc(100%-1rem)] max-w-fd-container flex-col gap-6 pt-8 pb-12'>
          <div className='flex flex-col gap-2'>
            <h1 className='font-bold text-3xl'>Queue Settings</h1>
            <p className='text-muted-foreground text-sm'>
              View and edit queue configuration from the bot.
            </p>
          </div>
          <QueueSettingsClient />
        </div>
      </HydrateClient>
    </Suspense>
  )
}
