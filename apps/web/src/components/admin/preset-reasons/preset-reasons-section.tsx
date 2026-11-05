'use client'

import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ApiError, apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { TYPE_LABELS } from '../../../app/(home)/admin/service-queue/lib/format'
import {
  ITEM_TYPES,
  type ItemType,
} from '../../../app/(home)/admin/service-queue/lib/types'
import {
  MAX_PRESET_LENGTH,
  addReason,
  canSaveList,
  editReason,
  isChanged,
  listProblem,
  moveReason,
  presetReasonsKey,
  removeReason,
} from './lists'

// The Configuration page's Preset reasons section: one list per queue item
// type. Edits stay in a draft until an admin saves with a note.
export function PresetReasonsSection() {
  const qc = useQueryClient()
  const { data } = useQuery<{ presetReasons: Record<ItemType, string[]> }>({
    queryKey: presetReasonsKey,
    queryFn: () => apiFetch('/webadmin/preset-reasons'),
  })
  const [type, setType] = useState<ItemType>(ITEM_TYPES[0])
  const [drafts, setDrafts] = useState<Partial<Record<ItemType, string[]>>>({})
  const [adding, setAdding] = useState('')
  const [note, setNote] = useState('')

  const save = useMutation({
    mutationFn: (body: { reasons: string[]; reason: string }) =>
      apiFetch(`/webadmin/config/preset-reasons/${type}`, {
        method: 'PUT',
        body: JSON.stringify({
          reasons: body.reasons.map((t) => t.trim()),
          reason: body.reason,
        }),
      }),
    onSuccess: () => {
      toast.success('Preset reasons saved')
      setDrafts((d) => ({ ...d, [type]: undefined }))
      setNote('')
      qc.invalidateQueries({ queryKey: presetReasonsKey })
    },
    onError: (e: unknown) =>
      toast.error(
        e instanceof ApiError && typeof e.body.message === 'string'
          ? e.body.message
          : 'Could not save preset reasons',
      ),
  })

  const saved = data?.presetReasons[type] ?? []
  const draft = drafts[type] ?? saved
  const edit = (next: string[]) => setDrafts((d) => ({ ...d, [type]: next }))
  const problem = listProblem(draft)
  const changed = isChanged(saved, draft)

  return (
    <Card data-testid='preset-reasons'>
      <CardHeader>
        <CardTitle>Preset reasons</CardTitle>
        <CardDescription>
          Ready-made notes staff pick for a queue item of one type, then edit.
          They show as chips above the note field. The first in the list shows
          first. Each save goes in the staff log.
        </CardDescription>
      </CardHeader>
      <CardContent className='space-y-4'>
        <div className='flex flex-wrap gap-2'>
          {ITEM_TYPES.map((t) => (
            <button
              key={t}
              type='button'
              onClick={() => setType(t)}
              aria-pressed={t === type}
              className={cn(
                'rounded-md border px-3 py-1.5 text-sm',
                t === type
                  ? 'border-primary bg-primary/10'
                  : 'border-border hover:bg-accent',
              )}
            >
              {TYPE_LABELS[t]}{' '}
              <span className='text-muted-foreground'>
                {(drafts[t] ?? data?.presetReasons[t] ?? []).length}
              </span>
            </button>
          ))}
        </div>

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
          {problem && <p className='text-amber-400 text-sm'>{problem}</p>}
        </div>

        {changed && (
          <form
            className='flex flex-wrap gap-2'
            onSubmit={(e) => {
              e.preventDefault()
              if (canSaveList(saved, draft, note, save.isPending))
                save.mutate({ reasons: draft, reason: note.trim() })
            }}
          >
            <Input
              aria-label='Note for the staff log'
              placeholder='Note for the staff log (needed)'
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className='max-w-md'
            />
            <Button
              type='submit'
              disabled={!canSaveList(saved, draft, note, save.isPending)}
            >
              Save preset reasons
            </Button>
            <Button
              type='button'
              variant='ghost'
              onClick={() => {
                edit(saved)
                setNote('')
              }}
            >
              Reset
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
