'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
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

interface PlacementEntry {
  playerId: string
  place: number
}

interface MatchConflict {
  id: number
  matchId: string
  lobbyCode: string
  firstReporterId: string
  firstPlacements: PlacementEntry[]
  conflictingReporterId: string
  conflictingPlacements: PlacementEntry[]
  status: 'open' | 'resolved'
  resolutionNotes: string | null
  createdAt: string
}

interface ConflictsResponse {
  conflicts: MatchConflict[]
  total: number
  page: number
  pages: number
}

function formatPlacements(placements: PlacementEntry[]): string {
  return placements
    .slice()
    .sort((a, b) => a.place - b.place)
    .map((p) => `#${p.place} ${p.playerId.slice(0, 8)}…`)
    .join(', ')
}

export default function AdminMatchConflictsPage() {
  const { isAdmin, isModerator, pending } = useAuth()
  const router = useRouter()
  const canAccess = isAdmin || isModerator
  const [page, setPage] = useState(1)
  const qc = useQueryClient()

  useEffect(() => {
    if (!pending && !canAccess) router.replace('/')
  }, [pending, canAccess, router])

  const { data } = useQuery<ConflictsResponse>({
    queryKey: ['admin-match-conflicts', page],
    queryFn: () => apiFetch(`/webadmin/match-conflicts?page=${page}&limit=50`),
    enabled: canAccess,
  })

  const resolveMutation = useMutation({
    mutationFn: (id: number) =>
      apiFetch(`/webadmin/match-conflicts/${id}/resolve`, { method: 'PATCH', body: JSON.stringify({}) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-match-conflicts'] }),
  })

  if (pending) return <div className='container py-8'>Loading…</div>
  if (!canAccess) return null

  const conflicts = data?.conflicts ?? []

  return (
    <div className='container max-w-5xl py-8 space-y-6'>
      <div>
        <h1 className='text-2xl font-bold tracking-tight'>Match Result Conflicts</h1>
        <p className='text-sm text-muted-foreground'>
          A second, differing result report for an already-resolved match. The first report always
          stands automatically -- these are flagged here purely for manual review.
        </p>
      </div>

      <div className='overflow-x-auto rounded-lg border border-border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Match</TableHead>
              <TableHead>First report (applied)</TableHead>
              <TableHead>Conflicting report</TableHead>
              <TableHead>Status</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {conflicts.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className='text-muted-foreground'>No conflicts found.</TableCell>
              </TableRow>
            ) : (
              conflicts.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className='whitespace-nowrap text-xs text-muted-foreground'>
                    {new Date(c.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className='font-mono text-xs'>{c.lobbyCode}</TableCell>
                  <TableCell className='text-xs'>
                    <div>{formatPlacements(c.firstPlacements)}</div>
                    <a href={`/players/${c.firstReporterId}`} className='text-bal-blue hover:underline'>
                      reported by {c.firstReporterId.slice(0, 8)}…
                    </a>
                  </TableCell>
                  <TableCell className='text-xs'>
                    <div>{formatPlacements(c.conflictingPlacements)}</div>
                    <a href={`/players/${c.conflictingReporterId}`} className='text-bal-blue hover:underline'>
                      reported by {c.conflictingReporterId.slice(0, 8)}…
                    </a>
                  </TableCell>
                  <TableCell>
                    <Badge variant={c.status === 'open' ? 'destructive' : 'secondary'}>
                      {c.status === 'open' ? 'Open' : 'Resolved'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {c.status === 'open' && (
                      <Button
                        variant='outline'
                        size='sm'
                        onClick={() => resolveMutation.mutate(c.id)}
                        disabled={resolveMutation.isPending}
                      >
                        Mark Reviewed
                      </Button>
                    )}
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
