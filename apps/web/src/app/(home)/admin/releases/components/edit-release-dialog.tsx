import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { ReleaseFields } from './release-fields'
import type { Branch, ReleaseForm } from './releases-types'

export function EditReleaseDialog({
  open,
  form,
  branches,
  isPending,
  onFormChange,
  onSave,
  onClose,
}: {
  open: boolean
  form: ReleaseForm
  branches: Branch[]
  isPending: boolean
  onFormChange: (f: ReleaseForm) => void
  onSave: () => void
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='sm:max-w-[600px]'>
        <DialogHeader>
          <DialogTitle>Edit Release</DialogTitle>
          <DialogDescription>Update the release details.</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSave()
          }}
          className='space-y-4'
        >
          <ReleaseFields form={form} setForm={onFormChange} branches={branches} idPrefix='edit' />
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              Cancel
            </Button>
            <Button type='submit' disabled={isPending}>
              {isPending ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
