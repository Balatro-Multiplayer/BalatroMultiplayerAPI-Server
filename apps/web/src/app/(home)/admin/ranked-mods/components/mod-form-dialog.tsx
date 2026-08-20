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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type { ModForm, ModSourceType } from './ranked-mods-types'

// Pinned badge next to a field name -- shown when that field is in the
// edited mod's overriddenFields, meaning an admin already edited it and
// upsertModFromIndex will skip it on every future sync (see
// mods.gateway.ts's doc comment) until "Reset overrides" is used.
function PinnedBadge({ shown }: { shown: boolean }) {
  if (!shown) return null
  return (
    <span className='ml-2 text-amber-600 text-xs dark:text-amber-400'>
      pinned — stays fixed on the next sync
    </span>
  )
}

export function ModFormDialog({
  open,
  mode,
  form,
  overriddenFields,
  isPending,
  isResetPending,
  onFormChange,
  onSave,
  onReset,
  onClose,
}: {
  open: boolean
  mode: 'create' | 'edit'
  form: ModForm
  overriddenFields: string[]
  isPending: boolean
  isResetPending?: boolean
  onFormChange: (f: ModForm) => void
  onSave: () => void
  onReset?: () => void
  onClose: () => void
}) {
  const pinned = (field: string) => overriddenFields.includes(field)

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='sm:max-w-[500px]'>
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'New custom mod' : 'Edit mod'}
          </DialogTitle>
          <DialogDescription>
            {mode === 'create'
              ? 'A mod entry with no BETModIndex counterpart — e.g. a partner mod not listed upstream. Folded into the same hourly sync/hash pass as every other mod.'
              : 'Fields you change here are pinned against the mod — the hourly sync will keep updating every other field normally, but a pinned one only changes again once you reset it.'}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            onSave()
          }}
          className='max-h-[70vh] space-y-4 overflow-y-auto'
        >
          {mode === 'create' && (
            <div className='space-y-2'>
              <Label htmlFor='mod-id'>Id</Label>
              <Input
                id='mod-id'
                value={form.id}
                onChange={(e) => onFormChange({ ...form, id: e.target.value })}
                required
              />
            </div>
          )}
          <div className='space-y-2'>
            <Label htmlFor='mod-title'>
              Title
              <PinnedBadge shown={pinned('title')} />
            </Label>
            <Input
              id='mod-title'
              value={form.title}
              onChange={(e) => onFormChange({ ...form, title: e.target.value })}
              required
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='mod-author'>
              Author
              <PinnedBadge shown={pinned('author')} />
            </Label>
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
            <Label htmlFor='mod-categories'>
              Categories (comma-separated)
              <PinnedBadge shown={pinned('categories')} />
            </Label>
            <Input
              id='mod-categories'
              value={form.categories}
              onChange={(e) =>
                onFormChange({ ...form, categories: e.target.value })
              }
            />
          </div>
          <div className='flex items-center justify-between'>
            <Label htmlFor='mod-requires-steamodded'>
              Requires Steamodded
              <PinnedBadge shown={pinned('requiresSteamodded')} />
            </Label>
            <Switch
              id='mod-requires-steamodded'
              checked={form.requiresSteamodded}
              onCheckedChange={(v) =>
                onFormChange({ ...form, requiresSteamodded: v })
              }
            />
          </div>
          <div className='flex items-center justify-between'>
            <Label htmlFor='mod-requires-talisman'>
              Requires Talisman
              <PinnedBadge shown={pinned('requiresTalisman')} />
            </Label>
            <Switch
              id='mod-requires-talisman'
              checked={form.requiresTalisman}
              onCheckedChange={(v) =>
                onFormChange({ ...form, requiresTalisman: v })
              }
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='mod-repo-url'>
              Repo URL
              <PinnedBadge shown={pinned('repoUrl')} />
            </Label>
            <Input
              id='mod-repo-url'
              value={form.repoUrl}
              onChange={(e) =>
                onFormChange({ ...form, repoUrl: e.target.value })
              }
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='mod-thumbnail-url'>
              Thumbnail URL
              <PinnedBadge shown={pinned('thumbnailUrl')} />
            </Label>
            <Input
              id='mod-thumbnail-url'
              value={form.thumbnailUrl}
              onChange={(e) =>
                onFormChange({ ...form, thumbnailUrl: e.target.value })
              }
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='mod-description'>
              Description
              <PinnedBadge shown={pinned('description')} />
            </Label>
            <Input
              id='mod-description'
              value={form.description}
              onChange={(e) =>
                onFormChange({ ...form, description: e.target.value })
              }
            />
          </div>
          <div className='space-y-2'>
            <Label htmlFor='mod-source-type'>
              Source
              <PinnedBadge
                shown={pinned('latestDownloadUrl') || pinned('latestVersion')}
              />
            </Label>
            <Select
              value={form.sourceType}
              onValueChange={(v) =>
                onFormChange({ ...form, sourceType: v as ModSourceType })
              }
            >
              <SelectTrigger id='mod-source-type' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='branch'>Branch</SelectItem>
                <SelectItem value='release'>Release</SelectItem>
                <SelectItem value='custom'>Custom</SelectItem>
              </SelectContent>
            </Select>
            <p className='text-muted-foreground text-xs'>
              {form.sourceType === 'branch' &&
                'Resolved from Repo URL + the branch below - always tracks that branch\'s current commit.'}
              {form.sourceType === 'release' &&
                'Resolved from Repo URL\'s latest GitHub release - no other input needed.'}
              {form.sourceType === 'custom' &&
                'A direct download URL this server has no way to auto-resolve or auto-update.'}
            </p>
          </div>
          {form.sourceType === 'branch' && (
            <div className='space-y-2'>
              <Label htmlFor='mod-branch'>Branch name</Label>
              <Input
                id='mod-branch'
                value={form.branch}
                placeholder='main'
                onChange={(e) =>
                  onFormChange({ ...form, branch: e.target.value })
                }
              />
            </div>
          )}
          {form.sourceType === 'custom' && (
            <>
              <div className='space-y-2'>
                <Label htmlFor='mod-latest-version'>
                  Latest version
                  <PinnedBadge shown={pinned('latestVersion')} />
                </Label>
                <Input
                  id='mod-latest-version'
                  value={form.latestVersion}
                  onChange={(e) =>
                    onFormChange({ ...form, latestVersion: e.target.value })
                  }
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='mod-latest-download-url'>
                  Latest download URL
                  <PinnedBadge shown={pinned('latestDownloadUrl')} />
                </Label>
                <Input
                  id='mod-latest-download-url'
                  value={form.latestDownloadUrl}
                  onChange={(e) =>
                    onFormChange({
                      ...form,
                      latestDownloadUrl: e.target.value,
                    })
                  }
                />
              </div>
              <div className='flex items-center justify-between'>
                <div>
                  <Label htmlFor='mod-auto-version-check'>
                    Automatic version check
                  </Label>
                  <p className='text-muted-foreground text-xs'>
                    Requires Repo URL — checks GitHub hourly for a new
                    release.
                  </p>
                </div>
                <Switch
                  id='mod-auto-version-check'
                  checked={form.automaticVersionCheck}
                  onCheckedChange={(v) =>
                    onFormChange({ ...form, automaticVersionCheck: v })
                  }
                />
              </div>
            </>
          )}
          <DialogFooter>
            {mode === 'edit' && overriddenFields.length > 0 && onReset && (
              <Button
                type='button'
                variant='ghost'
                className='mr-auto'
                disabled={isResetPending}
                onClick={onReset}
              >
                {isResetPending ? 'Resetting…' : 'Reset overrides'}
              </Button>
            )}
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
