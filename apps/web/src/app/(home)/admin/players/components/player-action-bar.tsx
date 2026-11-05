'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  DecisionBar,
  useDecisionBar,
} from '@/components/admin/decision-bar/decision-bar'
import { staffSend } from '@/components/admin/decision-bar/delayed-send'
import { actionTitle } from '@/components/admin/decision-bar/pick'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { apiFetch } from '@/lib/api'
import { formatTime } from '../../service-queue/lib/format'
import {
  deviatesFrom,
  type LiftTarget,
  type PlayerAction,
  playerBarActions,
  requestFor,
  wantedPick,
} from '../lib/player-bar'
import { isActiveBan } from '../lib/player-view'
import {
  type Ladder,
  LADDER_LABELS,
  LADDERS,
  STEP_LABELS,
} from '../lib/strikes'
import type { PlayerPage } from '../lib/types'

const WARNING_MAX = 500

export interface BarStart {
  action: PlayerAction
  // Set when the Lift button of a row opened the bar.
  lift?: LiftTarget
  // Counts opens, so a second open of the same button starts clean.
  nonce: number
}

// What can be lifted now: bans in force and warnings not yet lifted.
export function liftTargetsOf(
  page: PlayerPage,
  now: number
): { target: LiftTarget; label: string }[] {
  return [
    ...page.punishments.bans
      .filter((b) => isActiveBan(b, now))
      .map((b) => ({
        target: { kind: 'ban', id: b.id } as LiftTarget,
        label: `${b.banType} ban, ${b.expiresAt ? `until ${formatTime(b.expiresAt)}` : 'permanent'}`,
      })),
    ...page.punishments.warnings
      .filter((w) => !w.liftedAt)
      .map((w) => ({
        target: { kind: 'warning', id: w.id } as LiftTarget,
        label: `warning: ${w.message.slice(0, 60)}`,
      })),
  ]
}

// The player page's staff actions in the shared decision bar. Nothing here
// touches a queue item: the staff member may have come from one, and it stays
// open. Send waits 5 s for Undo (the shared sender), then calls the player
// routes.
export function PlayerActionBar({
  playerId,
  playerName,
  page,
  isAdmin,
  start,
  onClose,
}: {
  playerId: string
  playerName: string
  page: PlayerPage
  isAdmin: boolean
  start: BarStart
  onClose: () => void
}) {
  const qc = useQueryClient()
  const now = Date.now()
  const liftables = useMemo(() => liftTargetsOf(page, now), [page, now])
  const actions = useMemo(
    () => playerBarActions(isAdmin, liftables.length > 0),
    [isAdmin, liftables.length]
  )
  const wanted = useMemo(
    () => wantedPick(start.action, page.strikes),
    [start.action, page.strikes]
  )
  const bar = useDecisionBar(actions, wanted, start.nonce)
  const { pick, note } = bar
  const [message, setMessage] = useState('')
  const [warnLadder, setWarnLadder] = useState<Ladder>('play')
  const [endsOn, setEndsOn] = useState('')
  const [liftKey, setLiftKey] = useState<string>(() =>
    start.lift ? `${start.lift.kind}:${start.lift.id}` : ''
  )
  const lift =
    liftables.find((l) => `${l.target.kind}:${l.target.id}` === liftKey)
      ?.target ?? null

  const deviates = deviatesFrom(pick, warnLadder, page.strikes)
  const build = (text: string, at: number) =>
    pick
      ? requestFor({
          playerId,
          pick,
          note: text,
          warning: { message, ladder: warnLadder },
          endsOn,
          isAdmin,
          lift,
          strikes: page.strikes,
          now: at,
        })
      : null
  const checked = build(note.trim(), now)
  const missing = checked && !checked.ok ? checked.missing : null
  const isBan = pick?.action.endsWith('_ban') ?? false

  const send = (text: string) => {
    if (!pick) return
    const built = build(text, Date.now())
    if (!built?.ok) {
      toast.error(built ? built.missing : 'Pick an action.')
      return
    }
    const { request } = built
    staffSend.start({
      tag: `player:${playerId}`,
      label: `${actionTitle(actions, pick)} for ${playerName}`,
      run: () =>
        apiFetch(request.path, {
          method: request.method,
          body: JSON.stringify(request.body),
        }),
      onDone: () => {
        toast.success('Done.')
        void qc.invalidateQueries({ queryKey: ['admin-player-page', playerId] })
        void qc.invalidateQueries({ queryKey: ['admin-player-log', playerId] })
      },
      onError: (err) => {
        toast.error(err.message)
        void qc.invalidateQueries({ queryKey: ['admin-player-page', playerId] })
      },
    })
    onClose()
  }

  const extra = (
    <div className='space-y-2'>
      {pick?.action === 'warn' && (
        <div className='space-y-1'>
          <Textarea
            aria-label='Warning the player sees'
            placeholder='The warning the player sees'
            value={message}
            maxLength={WARNING_MAX}
            onChange={(e) => setMessage(e.target.value)}
          />
          <div className='flex items-center justify-between gap-2 text-sm'>
            <label className='flex items-center gap-2'>
              <span className='text-muted-foreground'>Counts on</span>
              <select
                value={warnLadder}
                onChange={(e) => setWarnLadder(e.target.value as Ladder)}
                className='rounded-md border border-border bg-card px-2 py-1.5'
              >
                {LADDERS.map((l) => (
                  <option key={l} value={l}>
                    {LADDER_LABELS[l]}
                  </option>
                ))}
              </select>
            </label>
            <span className='text-muted-foreground text-xs'>
              {message.length}/{WARNING_MAX}
            </span>
          </div>
        </div>
      )}
      {pick?.action === 'lift' && (
        <label className='flex items-center gap-2 text-sm'>
          <span className='text-muted-foreground'>Lift</span>
          <select
            value={liftKey}
            onChange={(e) => setLiftKey(e.target.value)}
            className='min-w-0 rounded-md border border-border bg-card px-2 py-1.5'
          >
            <option value=''>Pick one</option>
            {liftables.map((l) => (
              <option
                key={`${l.target.kind}:${l.target.id}`}
                value={`${l.target.kind}:${l.target.id}`}
              >
                {l.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {isAdmin && isBan && (
        <label className='flex items-center gap-2 text-sm'>
          <span className='text-muted-foreground'>Or end on</span>
          <input
            type='date'
            value={endsOn}
            onChange={(e) => setEndsOn(e.target.value)}
            className='rounded-md border border-border bg-card px-2 py-1.5'
          />
        </label>
      )}
      {deviates && (
        <p className='text-amber-400 text-sm' data-testid='ladder-deviation'>
          The ladder recommends {STEP_LABELS[deviates].toLowerCase()}. Your note
          must say why you pick another step.
        </p>
      )}
      {note.trim() && missing && (
        <p className='text-muted-foreground text-sm'>{missing}</p>
      )}
    </div>
  )

  return (
    <DecisionBar
      actions={actions}
      pick={pick}
      onChoose={bar.choose}
      onChooseLength={bar.chooseLength}
      note={note}
      onNoteChange={bar.setNote}
      onSend={send}
      sendHint=''
      sendBlocked={missing !== null}
      extra={extra}
      trailing={
        <Button
          type='button'
          size='sm'
          variant='secondary'
          data-testid='close-bar'
          onClick={onClose}
        >
          Close
        </Button>
      }
    />
  )
}
