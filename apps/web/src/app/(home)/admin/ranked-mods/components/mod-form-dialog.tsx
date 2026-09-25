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

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  required,
  disabled,
  hint,
}: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  required?: boolean
  disabled?: boolean
  hint?: string
}) {
  return (
    <div className='space-y-2'>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        placeholder={placeholder}
        required={required}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {hint && <p className='text-muted-foreground text-xs'>{hint}</p>}
    </div>
  )
}

const SOURCE_HINT: Record<ModSourceType, string> = {
  branch:
    "Resolved from Repo URL + the branch below — always tracks that branch's current commit. A branch archive can only be ranked-pinned at its current commit.",
  release:
    "Resolved from Repo URL's latest GitHub release. Any release version can be ranked-pinned.",
  custom:
    'A direct download URL with a version you type. Any version can be ranked-pinned; nothing is auto-resolved unless you enable the version check below.',
}

export function ModFormDialog({
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
  form: ModForm
  isPending: boolean
  onFormChange: (f: ModForm) => void
  onSave: () => void
  onClose: () => void
}) {
  const set =
    <K extends keyof ModForm>(key: K) =>
    (value: ModForm[K]) =>
      onFormChange({ ...form, [key]: value })

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className='sm:max-w-[500px]'>
        <DialogHeader>
          <DialogTitle>
            {mode === 'create' ? 'New custom mod' : 'Edit custom mod'}
          </DialogTitle>
          <DialogDescription>
            A catalog entry with no Thunderstore package — e.g. a partner mod or
            a GitHub-only mod. The hourly Thunderstore sync never touches it.
            Thunderstore mods themselves can't be edited here.
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
            <Field
              id='mod-id'
              label='Id'
              value={form.id}
              onChange={set('id')}
              required
              hint="Permanent — clients key on it. Must not match any Thunderstore 'Owner-Name'."
            />
          )}
          <Field
            id='mod-title'
            label='Title'
            value={form.title}
            onChange={set('title')}
            required
          />
          <Field
            id='mod-author'
            label='Author'
            value={form.author}
            onChange={set('author')}
            required
          />
          <Field
            id='mod-categories'
            label='Categories (comma-separated)'
            value={form.categories}
            onChange={set('categories')}
          />
          <Field
            id='mod-search-terms'
            label='Alternative search terms (comma-separated)'
            value={form.searchTerms}
            placeholder='e.g. wimf'
            onChange={set('searchTerms')}
            hint="Aliases players search by that aren't in the title."
          />
          <Field
            id='mod-repo-url'
            label='Repo URL'
            value={form.repoUrl}
            onChange={set('repoUrl')}
          />
          <Field
            id='mod-thumbnail-url'
            label='Thumbnail URL'
            value={form.thumbnailUrl}
            onChange={set('thumbnailUrl')}
          />
          <Field
            id='mod-description'
            label='Description'
            value={form.description}
            onChange={set('description')}
          />
          <div className='space-y-2'>
            <Label htmlFor='mod-source-type'>Source</Label>
            <Select
              value={form.sourceType}
              onValueChange={(v) => set('sourceType')(v as ModSourceType)}
            >
              <SelectTrigger id='mod-source-type' className='w-full'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value='branch'>Branch</SelectItem>
                <SelectItem value='release'>Release</SelectItem>
                <SelectItem value='custom'>Custom URL</SelectItem>
              </SelectContent>
            </Select>
            <p className='text-muted-foreground text-xs'>
              {SOURCE_HINT[form.sourceType]}
            </p>
          </div>
          {form.sourceType === 'branch' && (
            <Field
              id='mod-branch'
              label='Branch name'
              value={form.branch}
              placeholder='main'
              onChange={set('branch')}
            />
          )}
          {form.sourceType === 'custom' && (
            <>
              <Field
                id='mod-latest-version'
                label='Latest version'
                value={form.latestVersion}
                onChange={set('latestVersion')}
              />
              <Field
                id='mod-latest-download-url'
                label='Latest download URL'
                value={form.latestDownloadUrl}
                onChange={set('latestDownloadUrl')}
                hint='Editing this on a mod with a ranked pin on the same version clears the pin — re-pin it afterwards.'
              />
              <div className='flex items-center justify-between'>
                <div>
                  <Label htmlFor='mod-auto-version-check'>
                    Automatic version check
                  </Label>
                  <p className='text-muted-foreground text-xs'>
                    Requires a GitHub Repo URL — checks hourly for a new
                    release.
                  </p>
                </div>
                <Switch
                  id='mod-auto-version-check'
                  checked={form.automaticVersionCheck}
                  onCheckedChange={set('automaticVersionCheck')}
                />
              </div>
            </>
          )}
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
