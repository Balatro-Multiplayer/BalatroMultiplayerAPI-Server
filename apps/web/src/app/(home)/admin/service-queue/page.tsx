'use client'

import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type ItemType = 'report' | 'flagged_chat' | 'match_conflict' | 'forfeit_reconciliation' | 'anti_cheat'

interface QueueItem {
  id: number
  itemType: ItemType
  subjectPlayerId: string | null
  status: 'open' | 'resolved'
  summary: string
  createdAt: string
}

interface QueueResponse {
  items: QueueItem[]
  total: number
  page: number
  limit: number
  pages: number
}

const TYPE_LABELS: Record<ItemType, string> = {
  report: 'Report',
  flagged_chat: 'Flagged Chat',
  match_conflict: 'Match Conflict',
  forfeit_reconciliation: 'Forfeit Reconciliation',
  anti_cheat: 'Anti-Cheat',
}

const TYPE_FILTERS: { value: ItemType | 'all'; label: string }[] = [
  { value: 'all', label: 'All Types' },
  { value: 'report', label: 'Reports' },
  { value: 'flagged_chat', label: 'Flagged Chat' },
  { value: 'match_conflict', label: 'Match Conflicts' },
  { value: 'forfeit_reconciliation', label: 'Forfeit Reconciliation' },
  { value: 'anti_cheat', label: 'Anti-Cheat' },
]

const STATUS_FILTERS: { value: 'all' | 'open' | 'resolved'; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'all', label: 'All Statuses' },
]

export default function AdminServiceQueuePage() {
  const { isAdmin, isModerator, pending } = useAuth()
  const router = useRouter()
  const canAccess = isAdmin || isModerator
  const [itemType, setItemType] = useState<ItemType | 'all'>('all')
  const [status, setStatus] = useState<'all' | 'open' | 'resolved'>('open')
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (!pending && !canAccess) router.replace('/')
  }, [pending, canAccess, router])

  const { data } = useQuery<QueueResponse>({
    queryKey: ['admin-service-queue', itemType, status, page],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: '50' })
      if (itemType !== 'all') params.set('itemType', itemType)
      if (status !== 'all') params.set('status', status)
      return apiFetch(`/webadmin/service-queue?${params}`)
    },
    enabled: canAccess,
  })

  const items = data?.items ?? []

  if (pending) return <div className='container py-8'>Loading…</div>
  if (!canAccess) return null

  return (
    <div className='container max-w-5xl py-8 space-y-6'>
      <div>
        <h1 className='text-2xl font-bold tracking-tight'>Service Queue</h1>
        <p className='text-sm text-muted-foreground'>
          Reports, flagged chat, match conflicts, forfeit reconciliation, and anti-cheat signals needing review.
        </p>
      </div>

      <div className='flex flex-wrap gap-3'>
        <Select
          value={itemType}
          onValueChange={(v) => {
            setItemType(v as ItemType | 'all')
            setPage(1)
          }}
        >
          <SelectTrigger className='w-56'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TYPE_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as 'all' | 'open' | 'resolved')
            setPage(1)
          }}
        >
          <SelectTrigger className='w-44'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((f) => (
              <SelectItem key={f.value} value={f.value}>
                {f.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className='overflow-x-auto rounded-lg border border-border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className='text-muted-foreground'>No queue items found.</TableCell>
              </TableRow>
            ) : (
              items.map((it) => (
                <TableRow key={it.id}>
                  <TableCell className='whitespace-nowrap text-xs text-muted-foreground'>
                    {new Date(it.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>{TYPE_LABELS[it.itemType]}</TableCell>
                  <TableCell className='max-w-[420px] truncate'>{it.summary}</TableCell>
                  <TableCell>
                    <Badge variant={it.status === 'open' ? 'destructive' : 'secondary'}>
                      {it.status === 'open' ? 'Open' : 'Resolved'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <a href={`/admin/service-queue/${it.id}`} className='text-bal-blue hover:underline'>
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
