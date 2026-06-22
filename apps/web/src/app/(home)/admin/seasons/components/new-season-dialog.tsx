import { toast } from 'sonner'
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

export function NewSeasonDialog({
  open,
  name,
  endsAt,
  isPending,
  onNameChange,
  onEndsAtChange,
  onClose,
  onSubmit,
}: {
  open: boolean
  name: string
  endsAt: string
  isPending: boolean
  onNameChange: (v: string) => void
  onEndsAtChange: (v: string) => void
  onClose: () => void
  onSubmit: (name: string, endsAt: string | null) => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Season</DialogTitle>
          <DialogDescription>
            Starts a new season and makes it active. This ends the current
            season.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='s-name'>Name</Label>
            <Input
              id='s-name'
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder='Season 1'
              disabled={isPending}
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='s-ends'>Ends at (optional, defaults to +90 days)</Label>
            <Input
              id='s-ends'
              type='date'
              value={endsAt}
              onChange={(e) => onEndsAtChange(e.target.value)}
              disabled={isPending}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant='outline'
            onClick={onClose}
            disabled={isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!name.trim()) {
                toast.error('Name is required')
                return
              }
              onSubmit(name.trim(), endsAt ? new Date(endsAt).toISOString() : null)
            }}
            disabled={isPending}
          >
            {isPending ? 'Starting…' : 'Start Season'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
