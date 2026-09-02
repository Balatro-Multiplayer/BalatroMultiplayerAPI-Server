'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { QueueItemEnvelope } from '../types'

interface PlacementEntry {
  playerId: string
  place: number
}

interface MatchConflictDetailShape {
  matchId: string
  lobbyCode: string
  firstReporterId: string
  firstPlacements: PlacementEntry[]
  conflictingReporterId: string
  conflictingPlacements: PlacementEntry[]
  resolutionNotes: string | null
}

function formatPlacements(placements: PlacementEntry[]): string {
  return placements
    .slice()
    .sort((a, b) => a.place - b.place)
    .map((p) => `#${p.place} ${p.playerId.slice(0, 8)}…`)
    .join(', ')
}

export function MatchConflictDetail({ item, detail }: { item: QueueItemEnvelope; detail: unknown }) {
  const conflict = detail as MatchConflictDetailShape | null
  const qc = useQueryClient()

  const resolveMutation = useMutation({
    mutationFn: () => apiFetch(`/webadmin/service-queue/${item.id}/actions/resolve`, { method: 'PATCH' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-service-queue-item', String(item.id)] }),
  })

  if (!conflict) return <p className='text-muted-foreground'>Match conflict not found.</p>

  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <CardContent className='space-y-3 text-sm'>
        <div>
          <span className='text-muted-foreground'>Lobby code: </span>
          {conflict.lobbyCode}
        </div>
        <div>
          <div className='text-muted-foreground'>First report</div>
          <div>{formatPlacements(conflict.firstPlacements)}</div>
          <a href={`/players/${conflict.firstReporterId}`} className='text-bal-blue hover:underline text-xs'>
            reported by {conflict.firstReporterId.slice(0, 8)}…
          </a>
        </div>
        <div>
          <div className='text-muted-foreground'>Conflicting report</div>
          <div>{formatPlacements(conflict.conflictingPlacements)}</div>
          <a href={`/players/${conflict.conflictingReporterId}`} className='text-bal-blue hover:underline text-xs'>
            reported by {conflict.conflictingReporterId.slice(0, 8)}…
          </a>
        </div>

        {item.status === 'open' && (
          <div className='flex gap-2 pt-2'>
            <Button size='sm' onClick={() => resolveMutation.mutate()} disabled={resolveMutation.isPending}>
              Mark Reviewed
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
