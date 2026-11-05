'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetchWithReason } from '@/lib/api'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { type ModEntry, modChanges, upsertDraftMod } from '../lib/drafts'
import { SaveBar } from './save-bar'
import { SectionFrame } from './section-frame'

const EMPTY: ModEntry = {
  modId: '',
  displayName: '',
  version: '',
  downloadUrl: '',
}

export function ModsSection({
  saved,
  onDirtyChange,
  onSaved,
}: {
  saved: ModEntry[]
  onDirtyChange: (dirty: boolean) => void
  onSaved: () => void
}) {
  const [draft, setDraft] = useState(saved)
  const [form, setForm] = useState(EMPTY)
  const { upsert, remove } = modChanges(saved, draft)
  const count = upsert.length + remove.length
  useEffect(() => onDirtyChange(count > 0), [count, onDirtyChange])

  const save = useMutation({
    mutationFn: async (note: string) => {
      for (const mod of upsert)
        await apiFetchWithReason(
          `/webadmin/config/mods/${encodeURIComponent(mod.modId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              displayName: mod.displayName,
              version: mod.version,
              downloadUrl: mod.downloadUrl,
            }),
          },
          note
        )
      for (const modId of remove)
        await apiFetchWithReason(
          `/webadmin/config/mods/${encodeURIComponent(modId)}`,
          { method: 'DELETE' },
          note
        )
    },
    onSuccess: () => toast.success('Official mods saved'),
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : 'Request failed'),
    onSettled: onSaved,
  })

  const editField = (modId: string, patch: Partial<ModEntry>) =>
    setDraft((d) => d.map((m) => (m.modId === modId ? { ...m, ...patch } : m)))
  const formReady =
    form.modId.trim() &&
    form.displayName.trim() &&
    form.version.trim() &&
    form.downloadUrl.trim()
  const savedIds = new Set(saved.map((m) => m.modId))

  return (
    <SectionFrame
      testId='config-mods'
      title='Official mods'
      description='Saving a changed mod version sends an update notice to connected clients.'
      footer={
        <SaveBar
          changeCount={count}
          pending={save.isPending}
          saveLabel='Save official mods'
          onSave={(note) => save.mutate(note)}
          onReset={() => {
            setDraft(saved)
            setForm(EMPTY)
          }}
        />
      }
    >
      <div className='space-y-4'>
        {draft.length === 0 && (
          <p className='text-muted-foreground text-sm'>No official mods.</p>
        )}
        {draft.map((mod) => (
          <div
            key={mod.modId}
            className='space-y-2 rounded-md border border-border p-3 text-sm'
          >
            <div className='flex items-center justify-between gap-3'>
              <p className='font-semibold'>
                <span className='font-mono'>{mod.modId}</span>
                {!savedIds.has(mod.modId) && (
                  <span className='ml-2 text-bal-gold text-xs'>new</span>
                )}
              </p>
              <Button
                size='sm'
                variant='outline'
                onClick={() =>
                  setDraft((d) => d.filter((m) => m.modId !== mod.modId))
                }
              >
                Remove
              </Button>
            </div>
            <div className='grid gap-2 sm:grid-cols-3'>
              <Input
                aria-label={`${mod.modId} display name`}
                value={mod.displayName}
                onChange={(e) =>
                  editField(mod.modId, { displayName: e.target.value })
                }
              />
              <Input
                aria-label={`${mod.modId} version`}
                value={mod.version}
                onChange={(e) =>
                  editField(mod.modId, { version: e.target.value })
                }
              />
              <Input
                aria-label={`${mod.modId} download URL`}
                value={mod.downloadUrl}
                onChange={(e) =>
                  editField(mod.modId, { downloadUrl: e.target.value })
                }
              />
            </div>
          </div>
        ))}
        {remove.length > 0 && (
          <p className='text-muted-foreground text-sm'>
            Removed on save:{' '}
            <span className='font-mono'>{remove.join(', ')}</span>
          </p>
        )}
        <form
          className='grid grid-cols-2 gap-3 border-border border-t pt-4'
          onSubmit={(e) => {
            e.preventDefault()
            if (!formReady) return
            setDraft((d) => upsertDraftMod(d, form))
            setForm(EMPTY)
          }}
        >
          <Input
            placeholder='Mod ID'
            value={form.modId}
            onChange={(e) => setForm({ ...form, modId: e.target.value })}
          />
          <Input
            placeholder='Display Name'
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
          />
          <Input
            placeholder='Version'
            value={form.version}
            onChange={(e) => setForm({ ...form, version: e.target.value })}
          />
          <Input
            placeholder='Download URL'
            value={form.downloadUrl}
            onChange={(e) => setForm({ ...form, downloadUrl: e.target.value })}
          />
          <Button type='submit' className='col-span-2' disabled={!formReady}>
            Add or update mod
          </Button>
        </form>
      </div>
    </SectionFrame>
  )
}
