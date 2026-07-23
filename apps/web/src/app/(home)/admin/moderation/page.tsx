'use client'

import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

interface Report {
  id: number
  lobbyCode: string
  reporterId: string
  reporterName: string
  reportedId: string
  reportedName: string
  type: string
  status: 'open' | 'resolved'
  createdAt: string
}

interface ReportsResponse {
  reports: Report[]
  total: number
  page: number
  limit: number
  pages: number
}

const TYPE_LABELS: Record<string, string> = {
  cheating: 'Cheating',
  chat_abuse: 'Chat Abuse',
  griefing: 'Griefing',
  inappropriate_username: 'Inappropriate Username',
  other: 'Other',
}

export default function AdminModerationPage() {
  const { isAdmin, isModerator, pending } = useAuth()
  const router = useRouter()
  const canAccess = isAdmin || isModerator
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (!pending && !canAccess) router.replace('/')
  }, [pending, canAccess, router])

  const { data } = useQuery<ReportsResponse>({
    queryKey: ['admin-reports', page],
    queryFn: () => apiFetch(`/webadmin/reports?page=${page}&limit=50`),
    enabled: canAccess,
  })

  const reports = data?.reports ?? []

  if (pending) return <div className='container py-8'>Loading…</div>
  if (!canAccess) return null

  return (
    <div className='container max-w-5xl py-8 space-y-6'>
      <div>
        <h1 className='text-2xl font-bold tracking-tight'>Player Reports</h1>
        <p className='text-sm text-muted-foreground'>Reports filed by players from an in-game lobby.</p>
      </div>

      <div className='overflow-x-auto rounded-lg border border-border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Reporter</TableHead>
              <TableHead>Reported</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {reports.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className='text-muted-foreground'>No reports found.</TableCell>
              </TableRow>
            ) : (
              reports.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className='whitespace-nowrap text-xs text-muted-foreground'>
                    {new Date(r.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <a href={`/players/${r.reporterId}`} className='text-bal-blue hover:underline'>
                      {r.reporterName}
                    </a>
                  </TableCell>
                  <TableCell>
                    <a href={`/players/${r.reportedId}`} className='text-bal-blue hover:underline'>
                      {r.reportedName}
                    </a>
                  </TableCell>
                  <TableCell>{TYPE_LABELS[r.type] ?? r.type}</TableCell>
                  <TableCell>
                    <Badge variant={r.status === 'open' ? 'destructive' : 'secondary'}>
                      {r.status === 'open' ? 'Open' : 'Resolved'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <a href={`/admin/moderation/${r.id}`} className='text-bal-blue hover:underline'>
                      View
                    </a>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div className='flex items-center justify-end gap-2'>
        <Button variant='outline' size='sm' onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
          Previous
        </Button>
        <span className='text-sm text-muted-foreground'>
          Page {page} of {data?.pages ?? 1}
        </span>
        <Button
          variant='outline'
          size='sm'
          onClick={() => setPage((p) => p + 1)}
          disabled={page >= (data?.pages ?? 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
