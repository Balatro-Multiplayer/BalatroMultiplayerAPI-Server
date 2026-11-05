'use client'

import { type ReactNode, useState } from 'react'
import { Button } from '@/components/ui/button'
import { canSendConfirm, cleanNote } from './confirm-note'

export interface ConfirmRow {
  label: string
  value: ReactNode
}

// The red card for a risky staff action. It lists what changes, needs a note
// (sent as the staff log reason) and has no undo. Mount it only while the
// action is open, so its note starts empty each time.
export function ConfirmCard({
  title,
  rows,
  presets = [],
  placeholder = 'Why do this?',
  confirmLabel,
  pending = false,
  onConfirm,
  onCancel,
}: {
  title: string
  rows: ConfirmRow[]
  presets?: string[]
  placeholder?: string
  confirmLabel: string
  pending?: boolean
  onConfirm: (note: string) => void
  onCancel: () => void
}) {
  const [note, setNote] = useState('')
  const ready = canSendConfirm(note, pending)

  return (
    <section
      data-slot='confirm-card'
      className='rounded-xl border border-destructive/60 bg-destructive/10 p-4'
    >
      <h2 className='font-pixel text-destructive text-lg'>{title}</h2>
      <dl className='mt-3 divide-y divide-border text-sm'>
        {rows.map((r) => (
          <div key={r.label} className='grid grid-cols-[7rem_1fr] gap-3 py-2'>
            <dt className='text-muted-foreground'>{r.label}</dt>
            <dd>{r.value}</dd>
          </div>
        ))}
      </dl>
      <form
        className='mt-3 space-y-2'
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) onConfirm(cleanNote(note))
        }}
      >
        <label
          htmlFor='confirm-note'
          className='block font-semibold text-muted-foreground text-xs'
        >
          Note for the staff log (needed)
        </label>
        <input
          id='confirm-note'
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={placeholder}
          disabled={pending}
          className='w-full rounded-md border border-border bg-background px-3 py-2 text-sm'
        />
        {presets.length > 0 && (
          <div className='flex flex-wrap gap-2'>
            {presets.map((p) => (
              <button
                key={p}
                type='button'
                disabled={pending}
                onClick={() => setNote(p)}
                className='rounded-full border border-border border-dashed px-3 py-1 text-muted-foreground text-xs hover:text-foreground'
              >
                {p}
              </button>
            ))}
          </div>
        )}
        <div className='flex justify-end gap-2 pt-1'>
          <Button
            type='button'
            variant='outline'
            onClick={onCancel}
            disabled={pending}
          >
            Cancel
          </Button>
          <Button type='submit' variant='destructive' disabled={!ready}>
            {pending ? 'Sending…' : confirmLabel}
          </Button>
        </div>
      </form>
    </section>
  )
}
