'use client'

import { useQuery } from '@tanstack/react-query'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import type { MatchStatus } from '@bmp/types'

interface Match {
  matchId: string
  lobbyCode: string
  modId: string
  gameMode: string
  status: MatchStatus
  gameStartedAt: string | null
  createdAt: string
  playerNames: string[]
}

interface MatchesResponse {
  data: Match[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

const MODS = [
  { value: 'all', label: 'All mods' },
  { value: 'MultiplayerSpeedrunning', label: 'Speedrun' },
  { value: 'MultiplayerPvP', label: 'PvP' },
]
const STATUSES = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active' },
  { value: 'resolved', label: 'Resolved' },
]

export default function AdminGamesPage() {
  const { isAdmin, isModerator, pending } = useAuth()
  const router = useRouter()
  const canAccess = isAdmin || isModerator

  const [modId, setModId] = useState('all')
  const [status, setStatus] = useState<MatchStatus | 'all'>('all')
  const [page, setPage] = useState(1)

  useEffect(() => {
    if (!pending && !canAccess) router.replace('/')
  }, [pending, canAccess, router])

  const { data, isLoading } = useQuery<MatchesResponse>({
    queryKey: ['admin-matches', modId, status, page],
    queryFn: () => {
      const p = new URLSearchParams({ page: String(page), pageSize: '50' })
      if (modId !== 'all') p.set('modId', modId)
      if (status !== 'all') p.set('status', status)
      return apiFetch(`/webadmin/matches?${p.toString()}`)
    },
    enabled: canAccess,
  })

  if (pending) {
    return <div className='container py-8 text-muted-foreground'>Loading…</div>
  }
  if (!canAccess) return null

  const matches = data?.data ?? []
  const totalPages = data?.totalPages ?? 1

  return (
    <div className='container max-w-6xl py-8 space-y-6'>
      <div>
        <h1 className='text-2xl font-bold tracking-tight'>Match History</h1>
        <p className='text-sm text-muted-foreground'>
          Ranked/casual matches recorded by matchmaking.{' '}
          {data ? `${data.total} total.` : ''}
        </p>
      </div>

      <div className='flex flex-wrap gap-3'>
        <Select
          value={modId}
          onValueChange={(v) => {
            setModId(v)
            setPage(1)
          }}
        >
          <SelectTrigger className='w-44'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODS.map((m) => (
              <SelectItem key={m.value} value={m.value}>
                {m.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status}
          onValueChange={(v) => {
            setStatus(v as MatchStatus | 'all')
            setPage(1)
          }}
        >
          <SelectTrigger className='w-44'>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className='overflow-x-auto rounded-lg border border-border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Code</TableHead>
              <TableHead>Mod</TableHead>
              <TableHead>Game Mode</TableHead>
              <TableHead>Players</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className='text-muted-foreground'>
                  Loading…
                </TableCell>
              </TableRow>
            ) : matches.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className='text-muted-foreground'>
                  No matches
                </TableCell>
              </TableRow>
            ) : (
              matches.map((m) => (
                <TableRow key={m.matchId}>
                  <TableCell className='font-mono text-xs'>{m.lobbyCode}</TableCell>
                  <TableCell>{m.modId.replace('Multiplayer', '')}</TableCell>
                  <TableCell className='font-mono text-xs'>{m.gameMode}</TableCell>
                  <TableCell>{m.playerNames.join(' vs ')}</TableCell>
                  <TableCell>
                    {m.status === 'active' ? (
                      <Badge>Active</Badge>
                    ) : (
                      <Badge variant='outline'>{m.status}</Badge>
                    )}
                  </TableCell>
                  <TableCell className='text-muted-foreground'>
                    {new Date(m.createdAt).toLocaleString()}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
          <span className='text-sm text-muted-foreground'>
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
