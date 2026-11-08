'use client'

import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import {
  ContentCard,
  EmptyLine,
  PageHeader,
  PageShell,
} from '@/components/page-kit'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { RunStatusBadge } from './components/status-badge'
import type { MyRunsResponse } from './lib/types'

const PAGE_SIZE = 20

export default function MyMatchesPage() {
  const { pending, isLoggedIn } = useAuth()
  const router = useRouter()
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (!pending && !isLoggedIn) router.replace('/login')
  }, [pending, isLoggedIn, router])

  const { data, isLoading } = useQuery<MyRunsResponse>({
    queryKey: ['my-matches', page],
    queryFn: () => apiFetch(`/runs/mine?page=${page}&pageSize=${PAGE_SIZE}`),
    enabled: isLoggedIn,
  })

  if (pending)
    return <div className='container py-8 text-muted-foreground'>Loading…</div>
  if (!isLoggedIn) return null

  const runs = data?.runs ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <PageShell>
      <PageHeader
        title='My Matches'
        meta={
          data
            ? `${total} recorded ${total === 1 ? 'match' : 'matches'}. Open one to read its log.`
            : 'Your recorded matches.'
        }
      />

      <ContentCard>
        {isLoading ? (
          <EmptyLine>Loading...</EmptyLine>
        ) : runs.length === 0 ? (
          <EmptyLine>No matches recorded yet.</EmptyLine>
        ) : (
          <ul className='-my-1 divide-y divide-border'>
            {runs.map((run) => (
              <li key={run.id}>
                <Link
                  href={`/matches/${run.id}`}
                  className='flex flex-wrap items-center gap-x-4 gap-y-1 rounded py-3 hover:bg-muted/30'
                >
                  <div className='min-w-40 flex-1'>
                    <div className='font-medium'>
                      {run.modId.replace('Multiplayer', '')} match
                    </div>
                    <div className='text-muted-foreground text-xs'>
                      {format(new Date(run.startedAt), 'MMM d, yyyy HH:mm')}
                    </div>
                  </div>
                  <span className='font-mono text-muted-foreground text-xs'>
                    {run.lobbyCode}
                  </span>
                  <RunStatusBadge status={run.status} />
                  <span className='text-bal-blue text-sm'>View log</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </ContentCard>

      {totalPages > 1 && (
        <div className='flex items-center justify-end gap-2'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
          >
            Previous
          </Button>
          <span className='text-muted-foreground text-sm'>
            Page {page} of {totalPages}
          </span>
          <Button
            variant='outline'
            size='sm'
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
          >
            Next
          </Button>
        </div>
      )}
    </PageShell>
  )
}
