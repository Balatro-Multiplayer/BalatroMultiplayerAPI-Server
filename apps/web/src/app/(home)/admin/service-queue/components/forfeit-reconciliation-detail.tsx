'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { apiFetch } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useState } from 'react'
import type { QueueItemEnvelope } from '../types'

interface ForfeitReconciliationDetailShape {
  matchId: string
  lobbyCode: string
  playerId: string
  forfeitedAt: string
  reconnectedAt: string
  resolutionNotes: string | null
}

export function ForfeitReconciliationDetail({ item, detail }: { item: QueueItemEnvelope; detail: unknown }) {
  const flag = detail as ForfeitReconciliationDetailShape | null
  const qc = useQueryClient()
  const [voidDialogOpen, setVoidDialogOpen] = useState(false)

  const invalidate = () => qc.invalidateQueries({ queryKey: ['admin-service-queue-item', String(item.id)] })

  const dismissMutation = useMutation({
    mutationFn: () => apiFetch(`/webadmin/service-queue/${item.id}/actions/dismiss`, { method: 'PATCH' }),
    onSuccess: invalidate,
  })

  const voidMutation = useMutation({
    mutationFn: () => apiFetch(`/webadmin/service-queue/${item.id}/actions/void`, { method: 'PATCH' }),
    onSuccess: () => {
      setVoidDialogOpen(false)
      invalidate()
    },
  })

  if (!flag) return <p className='text-muted-foreground'>Forfeit reconciliation flag not found.</p>

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Details</CardTitle>
        </CardHeader>
        <CardContent className='space-y-2 text-sm'>
          <div>
            <span className='text-muted-foreground'>Lobby code: </span>
            {flag.lobbyCode}
          </div>
          <div>
            <span className='text-muted-foreground'>Player: </span>
            <a href={`/players/${flag.playerId}`} className='text-bal-blue hover:underline'>
              {flag.playerId.slice(0, 8)}…
            </a>
          </div>
          <div>
            <span className='text-muted-foreground'>Forfeited: </span>
            {new Date(flag.forfeitedAt).toLocaleString()}
          </div>
          <div>
            <span className='text-muted-foreground'>Reconnected: </span>
            {new Date(flag.reconnectedAt).toLocaleString()}
          </div>

          {item.status === 'open' && (
            <div className='flex gap-2 pt-2'>
              <Button size='sm' onClick={() => dismissMutation.mutate()} disabled={dismissMutation.isPending}>
                Dismiss
              </Button>
              <Button
                size='sm'
                variant='destructive'
                onClick={() => setVoidDialogOpen(true)}
                disabled={voidMutation.isPending}
              >
                Void Match
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={voidDialogOpen} onOpenChange={(o) => !o && setVoidDialogOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Void this match?</AlertDialogTitle>
            <AlertDialogDescription>
              Removes the match's rating impact entirely. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={voidMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={voidMutation.isPending}
              onClick={() => voidMutation.mutate()}
              className='bg-destructive text-white hover:bg-destructive/90'
            >
              {voidMutation.isPending ? 'Voiding…' : 'Void Match'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
