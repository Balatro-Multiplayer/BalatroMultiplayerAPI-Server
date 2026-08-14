'use client'

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

export function CloseLobbyDialog({
  target,
  isPending,
  onConfirm,
  onClose,
}: {
  target: { code: string; playerCount: number } | null
  isPending: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <AlertDialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Close lobby {target?.code}?</AlertDialogTitle>
          <AlertDialogDescription>
            Removes all {target?.playerCount} player
            {target?.playerCount === 1 ? '' : 's'} and deletes the lobby. Anyone
            mid-match forfeits. This can't be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending}
            onClick={onConfirm}
            className='bg-destructive text-white hover:bg-destructive/90'
          >
            {isPending ? 'Closing…' : 'Close Lobby'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
