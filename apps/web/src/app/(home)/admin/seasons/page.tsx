import { redirect } from 'next/navigation'
import { hasPermission } from '@/lib/permissions'
import { auth } from '@/server/auth'
import { api } from '@/trpc/server'
import { createMetadata } from '../../../../../lib/metadata'
import { type SeasonListRow, SeasonsClient } from './seasons-client'

export const metadata = createMetadata({
  title: 'Manage Seasons',
  description: 'Create seasons, track active status, and manage snapshots.',
  path: '/admin/seasons',
  noIndex: true,
})

async function loadSeasonRows(): Promise<SeasonListRow[]> {
  const seasonRows = await api.seasons.list()

  const snapshotRows = await Promise.all(
    seasonRows.map(async (season) => {
      const snapshots = await api.seasons.list_snapshots({
        seasonId: season.id,
      })

      return {
        id: season.id,
        name: season.name,
        startDate: season.startDate.toISOString(),
        endDate: season.endDate?.toISOString() ?? null,
        isActive: season.isActive,
        snapshotCount: snapshots.length,
      }
    })
  )

  return snapshotRows
}

export default async function AdminSeasonsPage() {
  const session = await auth()

  if (!hasPermission(session?.user, 'seasons.manage')) {
    redirect('/')
  }

  const seasons = await loadSeasonRows()

  return (
    <div className='mx-auto flex w-[calc(100%-1rem)] max-w-fd-container flex-col gap-6 pt-8'>
      <div className='flex flex-col gap-2'>
        <h1 className='font-bold text-3xl'>Manage Seasons</h1>
        <p className='text-muted-foreground text-sm'>
          Create seasons, review active status, jump into queue management.
        </p>
      </div>

      <SeasonsClient seasons={seasons} />
    </div>
  )
}
