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
import { Switch } from '@/components/ui/switch'
import type { ModForm } from './ranked-mods-types'

export function ModFormDialog({
  open,
  form,
  isPending,
  onFormChange,
  onSave,
  onClose,
}: {
  open: boolean
  form: ModForm
  isPending: boolean
  onFormChange: (f: ModForm) => void
  onSave: () => void
  onClose: () => void
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='sm:max-w-[500px]'>
        <DialogHeader>
          <DialogTitle>New custom mod</DialogTitle>
          <DialogDescription>
            A mod entry with no BETModIndex counterpart — e.g. a partner mod not
            listed upstream. Folded into the same hourly sync/hash pass as every
            other mod.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSave()
          }}
          className='max-h-[70vh] space-y-4 overflow-y-auto'
        >
          <div className='space-y-2'>
            <Label htmlFor='mod-id'>Id</Label>
            <Input
              id='mod-id'
              value={form.id}
              onChange={(e) => onFormChange({ ...form, id: e.target.value })}
              required
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='mod-title'>Title</Label>
            <Input
              id='mod-title'
              value={form.title}
              onChange={(e) => onFormChange({ ...form, title: e.target.value })}
              required
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='mod-author'>Author</Label>
            <Input
              id='mod-author'
              value={form.author}
              onChange={(e) =>
                onFormChange({ ...form, author: e.target.value })
              }
              required
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='mod-categories'>Categories (comma-separated)</Label>
            <Input
              id='mod-categories'
              value={form.categories}
              onChange={(e) =>
                onFormChange({ ...form, categories: e.target.value })
              }
            />
          </div>
          <div className='flex items-center justify-between'>
            <Label htmlFor='mod-requires-steamodded'>Requires Steamodded</Label>
            <Switch
              id='mod-requires-steamodded'
              checked={form.requiresSteamodded}
              onCheckedChange={(v) =>
                onFormChange({ ...form, requiresSteamodded: v })
              }
            />
          </div>
          <div className='flex items-center justify-between'>
            <Label htmlFor='mod-requires-talisman'>Requires Talisman</Label>
            <Switch
              id='mod-requires-talisman'
              checked={form.requiresTalisman}
              onCheckedChange={(v) =>
                onFormChange({ ...form, requiresTalisman: v })
              }
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='mod-repo-url'>Repo URL</Label>
            <Input
              id='mod-repo-url'
              value={form.repoUrl}
              onChange={(e) =>
                onFormChange({ ...form, repoUrl: e.target.value })
              }
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='mod-thumbnail-url'>Thumbnail URL</Label>
            <Input
              id='mod-thumbnail-url'
              value={form.thumbnailUrl}
              onChange={(e) =>
                onFormChange({ ...form, thumbnailUrl: e.target.value })
              }
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='mod-description'>Description</Label>
            <Input
              id='mod-description'
              value={form.description}
              onChange={(e) =>
                onFormChange({ ...form, description: e.target.value })
              }
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='mod-latest-version'>Latest version</Label>
            <Input
              id='mod-latest-version'
              value={form.latestVersion}
              onChange={(e) =>
                onFormChange({ ...form, latestVersion: e.target.value })
              }
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='mod-latest-download-url'>Latest download URL</Label>
            <Input
              id='mod-latest-download-url'
              value={form.latestDownloadUrl}
              onChange={(e) =>
                onFormChange({ ...form, latestDownloadUrl: e.target.value })
              }
            />
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={onClose}>
              Cancel
            </Button>
            <Button
              type='submit'
              disabled={isPending || !form.id || !form.title || !form.author}
            >
              {isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
