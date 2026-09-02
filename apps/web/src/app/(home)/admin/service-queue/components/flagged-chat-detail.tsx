'use client'

import type { BanType } from '@bmp/types'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { QueueItemEnvelope } from '../types'
import { BanDialog } from './ban-dialog'

interface ObscenityMatch {
  word: string
  startIndex: number
  endIndex: number
}

interface FlaggedChatDetailShape {
  playerId: string
  message: string
  matches: ObscenityMatch[]
  flaggedAt: string
  expiresAt: string
}

export function FlaggedChatDetail({ item, detail }: { item: QueueItemEnvelope; detail: unknown }) {
  const flagged = detail as FlaggedChatDetailShape | null
  const qc = useQueryClient()
  const [banDialogOpen, setBanDialogOpen] = useState(false)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-service-queue-item', String(item.id)] })

  const dismissMutation = useMutation({
    mutationFn: () => apiFetch(`/webadmin/service-queue/${item.id}/actions/dismiss`, { method: 'PATCH' }),
    onSuccess: invalidate,
  })

  const banMutation = useMutation({
    mutationFn: (params: { banType: BanType; reason: string; expiresAt: string | null }) =>
      apiFetch(`/webadmin/service-queue/${item.id}/actions/ban`, { method: 'PATCH', body: JSON.stringify(params) }),
    onSuccess: () => {
      setBanDialogOpen(false)
      invalidate()
    },
  })

  if (!flagged) return <p className='text-muted-foreground'>Flagged message not found.</p>

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className='space-y-2 text-sm'>
          <div>
            <span className='text-muted-foreground'>Player: </span>
            <a href={`/players/${flagged.playerId}`} className='text-bal-blue hover:underline'>
              {flagged.playerId.slice(0, 8)}…
            </a>
          </div>
          <div>
            <span className='text-muted-foreground'>Message: </span>
            {flagged.message}
          </div>
          <div>
            <span className='text-muted-foreground'>Matched words: </span>
            {flagged.matches.map((m) => m.word).join(', ') || 'none'}
          </div>
          <div>
            <span className='text-muted-foreground'>Flagged: </span>
            {new Date(flagged.flaggedAt).toLocaleString()}
          </div>

          {item.status === 'open' && (
            <div className='flex gap-2 pt-2'>
              <Button size='sm' onClick={() => dismissMutation.mutate()} disabled={dismissMutation.isPending}>
                Dismiss
              </Button>
              <Button
                size='sm'
                variant='destructive'
                onClick={() => setBanDialogOpen(true)}
                disabled={banMutation.isPending}
              >
                Ban
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <BanDialog
        open={banDialogOpen}
        isPending={banMutation.isPending}
        onConfirm={(params) => banMutation.mutate(params)}
        onClose={() => setBanDialogOpen(false)}
      />
    </>
  )
}
