'use client'

import { useState } from 'react'
import { ApiError, apiFetch } from '@/lib/api'
import { formatDate } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { APPEAL_STATUS_LABEL, MAX_APPEAL_LENGTH, type AppealState } from './punishments'

// A player's appeal of one punishment, or of the network ban (no punishmentId):
// the status and the reason for the decision, and a form when another appeal
// can be made.
export function AppealControl({
  state,
  punishmentId,
  onSubmitted,
}: {
  state: AppealState
  punishmentId?: string
  onSubmitted: () => void
}) {
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { appeal } = state

  async function submit() {
    setBusy(true)
    setError(null)
    try {
      await apiFetch('/auth/appeals', {
        method: 'POST',
        body: JSON.stringify({ punishmentId, message }),
      })
      setOpen(false)
      setMessage('')
      onSubmitted()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not send the appeal.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className='space-y-2 text-sm'>
      {appeal && (
        <div className='space-y-1'>
          <Badge variant={appeal.status === 'granted' ? 'default' : 'secondary'}>
            {APPEAL_STATUS_LABEL[appeal.status]}
          </Badge>
          {appeal.reason && <p>Reason: {appeal.reason}</p>}
        </div>
      )}
      {!state.canAppeal && state.appealAvailableAt && (
        <p className='text-muted-foreground'>
          You can appeal again on {formatDate(state.appealAvailableAt)}.
        </p>
      )}
      {state.canAppeal && !open && (
        <Button size='sm' variant='outline' onClick={() => setOpen(true)}>
          Appeal
        </Button>
      )}
      {state.canAppeal && open && (
        <div className='space-y-2'>
          <Textarea
            value={message}
            maxLength={MAX_APPEAL_LENGTH}
            onChange={(e) => setMessage(e.target.value)}
            placeholder='Tell staff why this punishment should be lifted or shortened.'
          />
          {error && <p className='text-destructive'>{error}</p>}
          <div className='flex gap-2'>
            <Button size='sm' disabled={busy || !message.trim()} onClick={submit}>
              Send appeal
            </Button>
            <Button size='sm' variant='ghost' disabled={busy} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
