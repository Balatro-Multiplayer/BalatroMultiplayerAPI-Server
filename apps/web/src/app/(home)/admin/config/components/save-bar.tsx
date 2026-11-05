'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useEffect, useState } from 'react'
import { canSaveSection, changeLabel } from '../lib/drafts'

// The bottom bar of a section: the change count, the staff log note and the
// Reset and Save buttons. Save stays off until there is a change and a note.
export function SaveBar({
  changeCount,
  pending,
  saveLabel,
  onSave,
  onReset,
}: {
  changeCount: number
  pending: boolean
  saveLabel: string
  onSave: (note: string) => void
  onReset: () => void
}) {
  const [note, setNote] = useState('')
  useEffect(() => {
    if (changeCount === 0) setNote('')
  }, [changeCount])
  const ready = canSaveSection(changeCount, note, pending)

  return (
    <form
      data-slot='save-bar'
      className='flex flex-wrap items-center gap-2 border-border border-t px-4 py-3'
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) onSave(note.trim())
      }}
    >
      {changeCount > 0 ? (
        <span className='rounded-full border border-bal-gold/60 bg-bal-gold/10 px-2.5 py-0.5 text-bal-gold text-xs'>
          {changeLabel(changeCount)}
        </span>
      ) : (
        <span className='text-muted-foreground text-xs'>No changes</span>
      )}
      <Input
        aria-label='Note for the staff log'
        placeholder='Note for the staff log (needed)'
        value={note}
        disabled={pending || changeCount === 0}
        onChange={(e) => setNote(e.target.value)}
        className='min-w-48 flex-1'
      />
      <Button
        type='button'
        variant='outline'
        disabled={pending || changeCount === 0}
        onClick={() => {
          setNote('')
          onReset()
        }}
      >
        Reset
      </Button>
      <Button type='submit' disabled={!ready}>
        {pending ? 'Saving…' : saveLabel}
      </Button>
    </form>
  )
}
