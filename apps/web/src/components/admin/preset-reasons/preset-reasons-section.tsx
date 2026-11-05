'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetch, apiFetchWithReason } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { SaveBar } from '../../../app/(home)/admin/config/components/save-bar'
import { SectionFrame } from '../../../app/(home)/admin/config/components/section-frame'
import { TYPE_LABELS } from '../../../app/(home)/admin/service-queue/lib/format'
import {
  ITEM_TYPES,
  type ItemType,
} from '../../../app/(home)/admin/service-queue/lib/types'
import {
  MAX_PRESET_LENGTH,
  addReason,
  editReason,
  isChanged,
  listProblem,
  moveReason,
  presetReasonsKey,
  removeReason,
} from './lists'

// The Configuration page's Preset reasons section: one list per queue item
// type. Edits stay in a draft until an admin saves with a note. A save writes
// every list that changed.
export function PresetReasonsSection({
  onDirtyChange,
}: {
  onDirtyChange?: (dirty: boolean) => void
}) {
  const qc = useQueryClient()
  const { data } = useQuery<{ presetReasons: Record<ItemType, string[]> }>({
    queryKey: presetReasonsKey,
    queryFn: () => apiFetch('/webadmin/preset-reasons'),
  })
  const [type, setType] = useState<ItemType>(ITEM_TYPES[0])
  const [drafts, setDrafts] = useState<Partial<Record<ItemType, string[]>>>({})
  const [adding, setAdding] = useState('')

  const savedOf = (t: ItemType) => data?.presetReasons[t] ?? []
  const draftOf = (t: ItemType) => drafts[t] ?? savedOf(t)
  const changedTypes = ITEM_TYPES.filter((t) =>
    isChanged(savedOf(t), draftOf(t)),
  )
  const problem = changedTypes.map((t) => listProblem(draftOf(t))).find(Boolean)

  useEffect(
    () => onDirtyChange?.(changedTypes.length > 0),
    [changedTypes.length, onDirtyChange],
  )

  const save = useMutation({
    mutationFn: async (note: string) => {
      for (const t of changedTypes)
        await apiFetchWithReason(
          `/webadmin/config/preset-reasons/${t}`,
          {
            method: 'PUT',
            body: JSON.stringify({ reasons: draftOf(t).map((x) => x.trim()) }),
          },
          note,
        )
    },
    onSuccess: () => toast.success('Preset reasons saved'),
    onError: (e: unknown) =>
      toast.error(
        e instanceof Error ? e.message : 'Could not save preset reasons',
      ),
    onSettled: () => qc.invalidateQueries({ queryKey: presetReasonsKey }),
  })

  const draft = draftOf(type)
  const edit = (next: string[]) => setDrafts((d) => ({ ...d, [type]: next }))

  return (
    <SectionFrame
      testId='preset-reasons'
      title='Preset reasons'
      description='Ready-made notes staff pick for a queue item of one type, then edit. They show as chips above the note field. The first in the list shows first.'
      footer={
        <>
          {problem && (
            <p className='px-5 pb-1 text-amber-400 text-sm'>{problem}</p>
          )}
          <SaveBar
            changeCount={problem ? 0 : changedTypes.length}
            pending={save.isPending}
            saveLabel='Save preset reasons'
            onSave={(note) => save.mutate(note)}
            onReset={() => {
              setDrafts({})
              setAdding('')
            }}
          />
        </>
      }
    >
      <div className='grid gap-4 md:grid-cols-[200px_1fr]'>
        <div className='flex flex-col gap-0.5 text-sm'>
          {ITEM_TYPES.map((t) => (
            <button
              key={t}
              type='button'
              onClick={() => setType(t)}
              aria-pressed={t === type}
              className={cn(
                'flex items-center rounded-md px-2.5 py-1.5 text-left',
                t === type
                  ? 'bg-destructive/15 font-semibold'
                  : 'hover:bg-accent',
              )}
            >
              {TYPE_LABELS[t]}
              {changedTypes.includes(t) && (
                <span className='ml-1 text-bal-gold text-xs'>edited</span>
              )}
              <span className='ml-auto text-muted-foreground'>
                {draftOf(t).length}
              </span>
            </button>
          ))}
        </div>

        <div className='space-y-4'>
          <div className='space-y-2'>
            {draft.length === 0 && (
              <p className='text-muted-foreground text-sm'>
                No preset reasons for this type.
              </p>
            )}
            {draft.map((text, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are edited in place and reordered by index
              <div key={i} className='flex items-center gap-2'>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={i === 0}
                  onClick={() => edit(moveReason(draft, i, -1))}
                >
                  Up
                </Button>
                <Button
                  size='sm'
                  variant='outline'
                  disabled={i === draft.length - 1}
                  onClick={() => edit(moveReason(draft, i, 1))}
                >
                  Down
                </Button>
                <Input
                  aria-label={`Preset reason ${i + 1}`}
                  value={text}
                  maxLength={MAX_PRESET_LENGTH}
                  onChange={(e) => edit(editReason(draft, i, e.target.value))}
                />
                <Button
                  size='sm'
                  variant='outline'
                  onClick={() => edit(removeReason(draft, i))}
                >
                  Remove
                </Button>
              </div>
            ))}
            <form
              className='flex gap-2'
              onSubmit={(e) => {
                e.preventDefault()
                if (adding.trim()) {
                  edit(addReason(draft, adding))
                  setAdding('')
                }
              }}
            >
              <Input
                aria-label='New preset reason'
                placeholder='Add a note'
                value={adding}
                maxLength={MAX_PRESET_LENGTH}
                onChange={(e) => setAdding(e.target.value)}
              />
              <Button type='submit' disabled={!adding.trim()}>
                Add
              </Button>
            </form>
          </div>

          {draft.length > 0 && (
            <div className='rounded-lg border border-border p-4'>
              <h3 className='mb-2 font-pixel text-muted-foreground text-sm uppercase'>
                How staff see it
              </h3>
              <div className='flex flex-wrap gap-2'>
                {draft
                  .filter((t) => t.trim())
                  .map((t, i) => (
                    <span
                      // biome-ignore lint/suspicious/noArrayIndexKey: preview of an editable list
                      key={i}
                      className='rounded-full border border-border border-dashed px-3 py-1 text-muted-foreground text-xs'
                    >
                      {t}
                    </span>
                  ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </SectionFrame>
  )
}
