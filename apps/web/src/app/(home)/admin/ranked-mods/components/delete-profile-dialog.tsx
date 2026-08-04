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
import type { ModProfile } from './ranked-mods-types'

export function DeleteProfileDialog({
  target,
  isPending,
  onConfirm,
  onClose,
}: {
  target: ModProfile | null
  isPending: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <AlertDialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete profile?</AlertDialogTitle>
          <AlertDialogDescription>
            This permanently deletes
            {target && <strong> "{target.name}"</strong>} and all its mod
            entries. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className='bg-destructive text-white hover:bg-destructive/90'
            onClick={onConfirm}
            disabled={isPending}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
