'use client'

import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { apiFetch } from '@/lib/api'
import { cn } from '@/lib/utils'
import { formatTime } from '../../service-queue/lib/format'
import { Empty } from '../../service-queue/components/evidence/shared'
import {
  ladderSentence,
  ladderTrack,
  type StepState,
} from '../lib/ladder-track'
import { type LastAction, lastActionsOf, standingOf } from '../lib/player-view'
import { LADDER_LABELS, LADDERS } from '../lib/strikes'
import type { PlayerLogEntry, PlayerPage } from '../lib/types'

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className='space-y-2 rounded-lg border border-border bg-card/80 p-4'>
      <h3 className='font-pixel text-lg uppercase tracking-wide'>{title}</h3>
      {children}
    </section>
  )
}

const STEP_STYLE: Record<StepState, string> = {
  hit: 'border-bal-red/60 bg-bal-red/20 text-bal-red',
  next: 'border-bal-gold bg-bal-gold/10 text-bal-gold',
  ahead: 'border-transparent bg-muted/40 text-muted-foreground',
}

function Ladder({
  ladder,
  summary,
}: {
  ladder: (typeof LADDERS)[number]
  summary: PlayerPage['strikes'][typeof ladder]
}) {
  return (
    <div className='space-y-1.5' data-testid={`strikes-${ladder}`}>
      <h4 className='font-pixel text-base uppercase'>
        {LADDER_LABELS[ladder]}
      </h4>
      <div className='flex flex-wrap gap-1'>
        {ladderTrack(ladder, summary).map((s) => (
          <span
            key={s.step}
            data-state={s.state}
            className={cn(
              'rounded border px-2 py-1 text-xs',
              STEP_STYLE[s.state]
            )}
          >
            {s.label}
          </span>
        ))}
      </div>
      <p className='text-muted-foreground text-sm'>
        {ladderSentence(ladder, summary)}
      </p>
    </div>
  )
}

export function useLastActions(playerId: string) {
  return useQuery<LastAction[]>({
    queryKey: ['admin-player-log', playerId],
    queryFn: async () => {
      const r = await apiFetch<{ entries: PlayerLogEntry[] }>(
        `/webadmin/staff-log?player=${playerId}&limit=5`
      )
      return lastActionsOf(r.entries)
    },
    retry: false,
  })
}

// Standing, both strike ladders (steps used and the next one) and the last
// staff actions. `children` are further cards below (the admin Staff role).
export function SideColumn({
  playerId,
  page,
  now,
  children,
}: {
  playerId: string
  page: PlayerPage
  now: number
  children?: ReactNode
}) {
  const actions = useLastActions(playerId)
  return (
    <div className='space-y-4'>
      <Card title='Standing'>
        <dl className='grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm'>
          {standingOf(page, now).map(([label, value]) => (
            <div key={label} className='contents'>
              <dt className='text-muted-foreground'>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </Card>
      <Card title='Strike ladders'>
        <div className='space-y-4'>
          {LADDERS.map((l) => (
            <Ladder key={l} ladder={l} summary={page.strikes[l]} />
          ))}
        </div>
      </Card>
      <Card title='Last actions'>
        {actions.isLoading ? (
          <Empty>Loading…</Empty>
        ) : !actions.data || actions.data.length === 0 ? (
          <Empty>No staff actions on this player.</Empty>
        ) : (
          <ul className='divide-y divide-border' data-testid='last-actions'>
            {actions.data.map((a) => (
              <li
                key={a.id}
                className='grid grid-cols-[auto_1fr_auto] gap-2 py-2 text-sm'
              >
                <span className='font-mono text-muted-foreground text-xs'>
                  {formatTime(a.at)}
                </span>
                <span>
                  {a.text}
                  {a.note && (
                    <span className='block text-muted-foreground text-xs'>
                      "{a.note}"
                    </span>
                  )}
                </span>
                <span className='text-muted-foreground text-xs'>{a.by}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {children}
    </div>
  )
}
