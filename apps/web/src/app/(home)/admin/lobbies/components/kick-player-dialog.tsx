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

export function KickPlayerDialog({
  target,
  isPending,
  onConfirm,
  onClose,
}: {
  target: { id: string; displayName: string } | null
  isPending: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <AlertDialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Kick {target?.displayName}?</AlertDialogTitle>
          <AlertDialogDescription>
            Removes them from this lobby immediately. If they're mid-match, it
            counts as a forfeit. They can rejoin a different lobby right away.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending}
            onClick={onConfirm}
            className='bg-destructive text-white hover:bg-destructive/90'
          >
            {isPending ? 'Kicking…' : 'Kick'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
