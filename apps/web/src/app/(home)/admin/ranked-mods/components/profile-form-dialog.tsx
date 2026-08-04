import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ProfileForm } from './ranked-mods-types'

export function ProfileFormDialog({
  open,
  mode,
  form,
  isPending,
  onFormChange,
  onSave,
  onClose,
}: {
  open: boolean
  mode: 'create' | 'edit'
  form: ProfileForm
  isPending: boolean
  onFormChange: (f: ProfileForm) => void
  onSave: () => void
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='sm:max-w-[500px]'>
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'New ranked mod profile' : 'Edit profile'}
          </DialogTitle>
          <DialogDescription>
            A named allow/deny list of mods. Info-only for now — nothing
            enforces this at queue time yet.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSave()
          }}
          className='space-y-4'
        >
          <div className='space-y-2'>
            <Label htmlFor='profile-name'>Name</Label>
            <Input
              id='profile-name'
              value={form.name}
              onChange={(e) => onFormChange({ ...form, name: e.target.value })}
              required
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='profile-slug'>Slug</Label>
            <Input
              id='profile-slug'
              value={form.slug}
              onChange={(e) => onFormChange({ ...form, slug: e.target.value })}
              required
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='profile-description'>Description</Label>
            <Input
              id='profile-description'
              value={form.description}
              onChange={(e) =>
                onFormChange({ ...form, description: e.target.value })
              }
            />
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              Cancel
            </Button>
            <Button
              type='submit'
              disabled={isPending || !form.name || !form.slug}
            >
              {isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
