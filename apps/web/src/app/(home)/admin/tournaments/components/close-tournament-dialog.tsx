'use client'

import { useEffect, useState } from 'react'
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
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

// Nakama keeps the first 200 characters (closeByModerator).
export const CLOSE_REASON_MAX = 200

export function CloseTournamentDialog({
  target,
  isPending,
  error,
  onConfirm,
  onClose,
}: {
  target: { name: string; players: number } | null
  isPending: boolean
  error: string | null
  onConfirm: (reason: string) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState('')
  useEffect(() => {
    if (target) setReason('')
  }, [target])
  const trimmed = reason.trim()

  return (
    <AlertDialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className='break-words'>
            Close {target?.name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Cancels the tournament for all {target?.players} player
            {target?.players === 1 ? '' : 's'} and its organisers. Anyone in a
            match is removed from their lobby, even mid-game, and no more
            results count. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className='space-y-1'>
          <Label htmlFor='close-tournament-reason'>
            Reason (shown in game to players and organisers)
          </Label>
          <Textarea
            id='close-tournament-reason'
            value={reason}
            maxLength={CLOSE_REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className='flex justify-between text-xs'>
            <span className='text-destructive'>{error}</span>
            <span className='text-muted-foreground'>
              {reason.length}/{CLOSE_REASON_MAX}
            </span>
          </div>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending || trimmed === ''}
            onClick={(e) => {
              // Stays open until the close goes through (or fails).
              e.preventDefault()
              onConfirm(trimmed)
            }}
            className='bg-destructive text-white hover:bg-destructive/90'
          >
            {isPending ? 'Closing…' : 'Close Tournament'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
