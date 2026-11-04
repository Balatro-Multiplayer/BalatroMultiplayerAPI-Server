'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
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
import { type AppealDecisionBody, decideAppeal, queueKeys } from '../lib/api'
import { DURATION_LABELS } from '../lib/format'
import type { AppealEvidence, ItemDetail } from '../lib/types'
import { ApiError } from '@/lib/api'

const SHORTEN_PRESETS = ['24h', '7d', '30d'] as const

type Mode = 'deny' | 'lift' | 'shorten'

const MODE_LABEL: Record<Mode, string> = {
  deny: 'Deny appeal',
  lift: 'Grant: lift punishment',
  shorten: 'Grant: shorten ban',
}

function DecisionDialog({
  detail,
  mode,
  onClose,
}: {
  detail: ItemDetail
  mode: Mode
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const [duration, setDuration] = useState<(typeof SHORTEN_PRESETS)[number]>(
    '7d'
  )
  const body: AppealDecisionBody =
    mode === 'deny'
      ? { decision: 'deny', reason }
      : mode === 'lift'
        ? { decision: 'grant', outcome: 'lift', reason }
        : { decision: 'grant', outcome: 'shorten', duration, reason }
  const mutation = useMutation({
    mutationFn: () => decideAppeal(detail.item.id, body),
    onSuccess: ({ appeal }) => {
      toast.success(`Appeal ${appeal.status}.`)
      qc.invalidateQueries({ queryKey: queueKeys.all })
      onClose()
    },
    onError: (err: Error) =>
      toast.error(
        err instanceof ApiError && typeof err.body.message === 'string'
          ? err.body.message
          : err.message
      ),
  })
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent data-testid={`appeal-dialog-${mode}`}>
        <DialogHeader>
          <DialogTitle>{MODE_LABEL[mode]}</DialogTitle>
          <DialogDescription>
            The player sees your reason. It is also kept in the staff log.
          </DialogDescription>
        </DialogHeader>
        <div className='space-y-3'>
          {mode === 'shorten' && (
            <div className='space-y-1'>
              <Label>New length, counted from now</Label>
              <div className='flex flex-wrap gap-1'>
                {SHORTEN_PRESETS.map((p) => (
                  <Button
                    key={p}
                    type='button'
                    size='sm'
                    variant={duration === p ? 'default' : 'outline'}
                    onClick={() => setDuration(p)}
                  >
                    {DURATION_LABELS[p]}
                  </Button>
                ))}
              </div>
            </div>
          )}
          <div className='space-y-1'>
            <Label htmlFor='appeal-reason'>Reason (required)</Label>
            <Input
              id='appeal-reason'
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button
            variant='outline'
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            data-testid='appeal-confirm'
            variant={mode === 'deny' ? 'destructive' : 'default'}
            disabled={!reason.trim() || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Working...' : MODE_LABEL[mode]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// The decisions the server allows this staff member on an open appeal.
// An appeal of a network ban or a warning has no length to shorten.
export function AppealDecisionBar({
  detail,
  heldByOther,
}: {
  detail: ItemDetail
  heldByOther: boolean
}) {
  const [open, setOpen] = useState<Mode | null>(null)
  const decisions = detail.appealDecisions
  if (detail.item.itemType !== 'appeal' || detail.item.status !== 'open')
    return null
  if (!decisions || (!decisions.deny && !decisions.grant)) return null
  const evidence = detail.evidence as AppealEvidence | null
  const canShorten =
    evidence?.target === 'ban' && evidence.punishment?.expiresAt != null
  const modes: Mode[] = [
    ...(decisions.deny ? (['deny'] as const) : []),
    ...(decisions.grant ? (['lift'] as const) : []),
    ...(decisions.grant && canShorten ? (['shorten'] as const) : []),
  ]
  return (
    <div
      className='flex flex-wrap gap-2 border-border border-t p-3'
      data-testid='appeal-decision-bar'
    >
      {modes.map((m) => (
        <Button
          key={m}
          size='sm'
          variant={m === 'deny' ? 'destructive' : 'outline'}
          disabled={heldByOther}
          onClick={() => setOpen(m)}
        >
          {MODE_LABEL[m]}
        </Button>
      ))}
      {open && (
        <DecisionDialog
          key={`${detail.item.id}-${open}`}
          detail={detail}
          mode={open}
          onClose={() => setOpen(null)}
        />
      )}
    </div>
  )
}
