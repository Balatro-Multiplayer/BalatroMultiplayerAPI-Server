'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  DecisionBar,
  UndoStrip,
  useDecisionBar,
} from '@/components/admin/decision-bar/decision-bar'
import { staffSend } from '@/components/admin/decision-bar/delayed-send'
import { actionTitle } from '@/components/admin/decision-bar/pick'
import { Button } from '@/components/ui/button'
import { ApiError, apiFetch } from '@/lib/api'
import {
  initialPlaces,
  matchBarActions,
  type Places,
  placesProblem,
  resultBody,
  type StaffRole,
} from '../lib/match-edit'
import type { StaffQueueItem, StaffResultRow } from '../lib/types'

interface Props {
  runId: string
  role: StaffRole
  items: readonly StaffQueueItem[]
  result: readonly StaffResultRow[] | null
  /** Every player of the match, for a match with no recorded result. */
  players: readonly { id: string; name: string }[]
}

// Header buttons: Set result and Void match, or Report to admins.
export function MatchEditButtons({
  role,
  items,
  onOpen,
}: {
  role: StaffRole
  items: readonly StaffQueueItem[]
  onOpen: (action: string) => void
}) {
  return (
    <div className='ml-auto flex items-center gap-2'>
      {matchBarActions(role, items)
        .slice()
        .reverse()
        .map((a) => (
          <Button
            key={a.key}
            size='sm'
            variant={a.destructive && a.key === 'void' ? 'destructive' : 'outline'}
            onClick={() => onOpen(a.key)}
          >
            {a.label}
          </Button>
        ))}
    </div>
  )
}

// The shared decision bar for the match: Void match, Set result or Report to
// admins, each with a required note and the 5 s undo. A void closes every
// open queue item about the match and changes only its players' ratings.
export function MatchEditBar({
  runId,
  role,
  items,
  result,
  players,
  picked,
  onClose,
}: Props & { picked: string; onClose: () => void }) {
  const queryClient = useQueryClient()
  const actions = matchBarActions(role, items)
  const wanted = actions.some((a) => a.key === picked)
    ? { action: picked, length: null }
    : null
  const bar = useDecisionBar(actions, wanted, `${runId}:${picked}`)
  const [places, setPlaces] = useState<Places>({})
  const startPlaces = initialPlaces(
    result && result.length > 0
      ? result
      : players.map((p, i) => ({ playerId: p.id, place: i + 1 }))
  )
  // biome-ignore lint/correctness/useExhaustiveDependencies: the places restart only for another match or a newly opened bar
  useEffect(() => setPlaces(startPlaces), [runId, picked])

  const problem = bar.pick?.action === 'result' ? placesProblem(places) : null
  const nameOf = (id: string) =>
    result?.find((r) => r.playerId === id)?.displayName ??
    players.find((p) => p.id === id)?.name ??
    id.slice(0, 8)

  const send = (note: string) => {
    if (!bar.pick) return
    const action = bar.pick.action
    const title = actionTitle(actions, bar.pick)
    const base = `/webadmin/matches/${runId}`
    const request =
      action === 'void'
        ? () =>
            apiFetch(`${base}/void`, {
              method: 'POST',
              body: JSON.stringify({ reason: note }),
            })
        : action === 'result'
          ? () =>
              apiFetch(`${base}/result`, {
                method: 'POST',
                body: JSON.stringify(resultBody(places, note)),
              })
          : () =>
              apiFetch(`${base}/report`, {
                method: 'POST',
                body: JSON.stringify({ note }),
              })
    staffSend.start({
      tag: `match:${runId}`,
      label: title,
      run: request,
      onDone: () => {
        toast.success(
          action === 'report' ? 'Reported to admins.' : `${title} saved.`
        )
        void queryClient.invalidateQueries({ queryKey: ['match-staff', runId] })
        void queryClient.invalidateQueries({ queryKey: ['match-replay', runId] })
      },
      onError: (err) =>
        toast.error(
          err instanceof ApiError && err.status === 403
            ? 'You cannot change this match now. Report it to admins instead.'
            : err.message
        ),
    })
    onClose()
  }

  return (
    <div className='sticky bottom-0 z-10 mx-auto w-full max-w-6xl'>
      <DecisionBar
        actions={actions}
        pick={bar.pick}
        onChoose={bar.choose}
        onChooseLength={bar.chooseLength}
        note={bar.note}
        onNoteChange={bar.setNote}
        onSend={send}
        sendHint=''
        sendBlocked={problem !== null}
        trailing={
          <Button size='sm' variant='ghost' onClick={onClose}>
            Close
          </Button>
        }
        extra={
          bar.pick?.action === 'result' ? (
            <div className='space-y-1'>
              <div className='flex flex-wrap gap-3'>
                {Object.entries(places).map(([id, place]) => (
                  <label key={id} className='flex items-center gap-2 text-sm'>
                    <span>{nameOf(id)}</span>
                    <input
                      type='number'
                      min={1}
                      value={Number.isNaN(place) ? '' : place}
                      onChange={(e) =>
                        setPlaces({ ...places, [id]: e.target.valueAsNumber })
                      }
                      aria-label={`Place of ${nameOf(id)}`}
                      className='w-16 rounded-md border border-border bg-background px-2 py-1'
                    />
                  </label>
                ))}
              </div>
              <p className='text-muted-foreground text-xs'>
                Only the ratings of these players change. Place 1 wins.
              </p>
              {problem && (
                <p className='text-destructive text-xs'>{problem}</p>
              )}
            </div>
          ) : bar.pick?.action === 'void' ? (
            <p className='text-muted-foreground text-xs'>
              Voiding closes every open queue item about this match with the
              same note. Only the ratings of its players change.
            </p>
          ) : bar.pick?.action === 'report' ? (
            <p className='text-muted-foreground text-xs'>
              Admins get a queue item with your note. You cannot change this
              match without an open queue item.
            </p>
          ) : null
        }
      />
    </div>
  )
}

// The undo strip of a waiting send, shown at the top of the match page.
export const MatchUndoStrip = () => <UndoStrip className='rounded-md border' />
