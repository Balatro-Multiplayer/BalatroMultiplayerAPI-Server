'use client'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { apiFetchWithReason } from '@/lib/api'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  LADDERS,
  LADDER_LABELS,
  LADDER_STEPS,
  type Ladder,
  type LadderStep,
  STEP_LABELS,
} from '../../players/lib/strikes'
import { sameList } from '../lib/drafts'
import { SaveBar } from './save-bar'
import { SectionFrame } from './section-frame'

export function LaddersSection({
  saved,
  onDirtyChange,
  onSaved,
}: {
  saved: Record<Ladder, LadderStep[]>
  onDirtyChange: (dirty: boolean) => void
  onSaved: () => void
}) {
  const [draft, setDraft] = useState(saved)
  const changed = LADDERS.filter((l) => !sameList(saved[l], draft[l]))
  useEffect(
    () => onDirtyChange(changed.length > 0),
    [changed.length, onDirtyChange]
  )

  const save = useMutation({
    mutationFn: async (note: string) => {
      for (const ladder of changed)
        await apiFetchWithReason(
          `/webadmin/config/strike-ladders/${ladder}`,
          { method: 'PUT', body: JSON.stringify({ steps: draft[ladder] }) },
          note
        )
    },
    onSuccess: () => toast.success('Strike ladders saved'),
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : 'Request failed'),
    onSettled: onSaved,
  })

  return (
    <SectionFrame
      testId='config-ladders'
      title='Strike ladders'
      description='The next step on a ladder is the recommended punishment. The last step must be permanent.'
      footer={
        <SaveBar
          changeCount={changed.length}
          pending={save.isPending}
          saveLabel='Save strike ladders'
          onSave={(note) => save.mutate(note)}
          onReset={() => setDraft(saved)}
        />
      }
    >
      <div className='space-y-6'>
        {LADDERS.map((ladder) => {
          const steps = draft[ladder]
          const edit = (next: LadderStep[]) =>
            setDraft((d) => ({ ...d, [ladder]: next }))
          return (
            <div
              key={ladder}
              className='space-y-2'
              data-testid={`ladder-${ladder}`}
            >
              <Label>
                {LADDER_LABELS[ladder]}
                {!sameList(saved[ladder], steps) && (
                  <span className='ml-2 text-bal-gold text-xs'>changed</span>
                )}
              </Label>
              <div className='flex flex-wrap items-center gap-2'>
                {steps.map((step, i) => (
                  <span
                    // biome-ignore lint/suspicious/noArrayIndexKey: steps repeat, so the index is part of the key
                    key={`${step}-${i}`}
                    className='inline-flex items-center gap-1 rounded-full bg-muted px-3 py-1 text-sm'
                  >
                    {i + 1}. {STEP_LABELS[step]}
                    <button
                      type='button'
                      aria-label={`Remove step ${i + 1}`}
                      className='text-muted-foreground hover:text-destructive'
                      onClick={() => edit(steps.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </span>
                ))}
                {LADDER_STEPS.map((step) => (
                  <Button
                    key={step}
                    size='sm'
                    variant='outline'
                    onClick={() => edit([...steps, step])}
                  >
                    + {STEP_LABELS[step]}
                  </Button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </SectionFrame>
  )
}
