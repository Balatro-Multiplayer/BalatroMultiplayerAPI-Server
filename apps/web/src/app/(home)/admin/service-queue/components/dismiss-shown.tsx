'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { dismissShown, queueKeys } from '../lib/api'

// With the Automatic chip on, dismisses every item the rail shows with one
// required note. Items someone else is handling stay and are reported.
export function DismissShown({ itemIds }: { itemIds: number[] }) {
  const queryClient = useQueryClient()
  const [note, setNote] = useState('')
  const dismiss = useMutation({
    mutationFn: () => dismissShown(itemIds, note.trim()),
    onSuccess: () => {
      setNote('')
      void queryClient.invalidateQueries({ queryKey: queueKeys.all })
    },
  })
  if (itemIds.length === 0 && !dismiss.data) return null
  return (
    <div className='border-border border-b p-2' data-testid='dismiss-shown'>
      <div className='flex items-center gap-2'>
        <Input
          className='h-8 flex-1'
          placeholder='Note for dismissing all shown'
          aria-label='Note'
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button
          size='sm'
          variant='outline'
          disabled={
            note.trim() === '' || itemIds.length === 0 || dismiss.isPending
          }
          onClick={() => dismiss.mutate()}
        >
          Dismiss all shown ({itemIds.length})
        </Button>
      </div>
      {dismiss.data && dismiss.data.failed.length > 0 && (
        <p className='mt-1 text-amber-400 text-xs'>
          {dismiss.data.failed.length} item(s) were not dismissed (for example,
          someone is handling them).
        </p>
      )}
      {dismiss.isError && (
        <p className='mt-1 text-red-400 text-xs'>Dismiss failed.</p>
      )}
    </div>
  )
}
