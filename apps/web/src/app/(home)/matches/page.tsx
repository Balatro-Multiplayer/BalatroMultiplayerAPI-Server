'use client'

import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
    <div className='container max-w-5xl space-y-6 py-8'>
      <div className='space-y-1'>
        <h1 className='font-bold text-2xl tracking-tight'>My Matches</h1>
        <p className='text-muted-foreground text-sm'>
          Your recorded match history and replay logs.{' '}
          {data ? `${total} total.` : ''}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Matches</CardTitle>
        </CardHeader>
        <CardContent className='p-0'>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Mod</TableHead>
                <TableHead>Lobby Code</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className='text-right'>Replay</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className='text-muted-foreground'>
                    Loading…
                  </TableCell>
                </TableRow>
              ) : runs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className='text-muted-foreground'>
                    No matches recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                runs.map((run) => (
                  <TableRow key={run.id}>
                    <TableCell className='text-muted-foreground'>
                      {format(new Date(run.startedAt), 'MMM d, yyyy HH:mm')}
                    </TableCell>
                    <TableCell>
                      {run.modId.replace('Multiplayer', '')}
                    </TableCell>
                    <TableCell className='font-mono text-xs'>
                      {run.lobbyCode}
                    </TableCell>
                    <TableCell>
                      <RunStatusBadge status={run.status} />
                    </TableCell>
                    <TableCell className='text-right'>
                      <Button variant='outline' size='sm' asChild>
                        <Link href={`/matches/${run.id}`}>View Log</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

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
    </div>
  )
}
