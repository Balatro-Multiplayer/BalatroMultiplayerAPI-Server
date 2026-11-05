'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiFetchWithReason } from '@/lib/api'
import { useMutation } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { addAllowlistMessage, allowlistChanges } from '../lib/drafts'
import { SaveBar } from './save-bar'
import { SectionFrame } from './section-frame'

export function AllowlistSection({
  saved,
  onDirtyChange,
  onSaved,
}: {
  saved: string[]
  onDirtyChange: (dirty: boolean) => void
  onSaved: () => void
}) {
  const [draft, setDraft] = useState(saved)
  const [adding, setAdding] = useState('')
  const { add, remove } = allowlistChanges(saved, draft)
  const count = add.length + remove.length
  useEffect(() => onDirtyChange(count > 0), [count, onDirtyChange])

  const save = useMutation({
    mutationFn: async (note: string) => {
      for (const message of add)
        await apiFetchWithReason(
          '/webadmin/config/chat-allowlist',
          { method: 'POST', body: JSON.stringify({ message }) },
          note,
        )
      for (const message of remove)
        await apiFetchWithReason(
          `/webadmin/config/chat-allowlist/${encodeURIComponent(message)}`,
          { method: 'DELETE' },
          note,
        )
    },
    onSuccess: () => toast.success('Chat allowlist saved'),
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : 'Request failed'),
    onSettled: onSaved,
  })

  const state = (m: string) =>
    add.includes(m) ? 'new' : remove.includes(m) ? 'removed' : null
  const shown = [...draft, ...remove]

  return (
    <SectionFrame
      testId='config-allowlist'
      title='Chat allowlist'
      description='A message on this list is allowed in chat. Removed messages show struck through until you save.'
      footer={
        <SaveBar
          changeCount={count}
          pending={save.isPending}
          saveLabel='Save chat allowlist'
          onSave={(note) => save.mutate(note)}
          onReset={() => {
            setDraft(saved)
            setAdding('')
          }}
        />
      }
    >
      <div className='space-y-4'>
        <div className='flex flex-wrap gap-2'>
          {shown.length === 0 && (
            <p className='text-muted-foreground text-sm'>Empty.</p>
          )}
          {shown.map((message) => {
            const s = state(message)
            return (
              <span
                key={message}
                className={`inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-sm ${
                  s === 'new' ? 'ring-1 ring-bal-gold' : ''
                } ${s === 'removed' ? 'text-muted-foreground line-through' : ''}`}
              >
                {message}
                {s === 'removed' ? (
                  <button
                    type='button'
                    className='text-bal-blue text-xs no-underline hover:underline'
                    onClick={() => setDraft((d) => [...d, message])}
                  >
                    Undo
                  </button>
                ) : (
                  <button
                    type='button'
                    aria-label={`Remove ${message}`}
                    className='text-muted-foreground hover:text-destructive'
                    onClick={() =>
                      setDraft((d) => d.filter((m) => m !== message))
                    }
                  >
                    ×
                  </button>
                )}
              </span>
            )
          })}
        </div>
        <form
          className='flex gap-2'
          onSubmit={(e) => {
            e.preventDefault()
            setDraft((d) => addAllowlistMessage(d, adding))
            setAdding('')
          }}
        >
          <Input
            aria-label='New allowed message'
            placeholder='New allowed message'
            value={adding}
            onChange={(e) => setAdding(e.target.value)}
            className='max-w-sm'
          />
          <Button type='submit' disabled={!adding.trim()}>
            Add
          </Button>
        </form>
      </div>
    </SectionFrame>
  )
}
