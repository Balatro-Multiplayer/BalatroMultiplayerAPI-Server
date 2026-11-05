'use client'

import type { ReactNode } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty } from '../../service-queue/components/evidence/shared'
import { formatTime } from '../../service-queue/lib/format'
import { type HistoryEntry, isActiveBan } from '../lib/player-view'
import type { PageAppeal } from '../lib/types'
import type { LiftTarget } from '../lib/player-bar'

function Row({ children }: { children: ReactNode }) {
  return (
    <li className='rounded-md border border-border p-2 text-sm'>{children}</li>
  )
}

function punishmentLabel(p: PageAppeal['punishment']): string {
  if (p.kind === 'network_ban') return 'Network ban'
  if (p.kind === 'gone') return 'Punishment no longer on record'
  const what = p.kind === 'ban' ? `${p.banType ?? ''} ban` : 'Warning'
  return p.reason ? `${what}: ${p.reason}` : what
}

function Entry({
  entry,
  now,
  onLift,
}: {
  entry: HistoryEntry
  now: number
  // Null for staff who may not lift (moderators).
  onLift: ((target: LiftTarget) => void) | null
}) {
  if (entry.kind === 'ban') {
    const ban = entry.ban
    const active = isActiveBan(ban, now)
    return (
      <Row>
        <div className='flex items-start justify-between gap-2'>
          <div className='space-y-0.5'>
            <Badge variant={active ? 'destructive' : 'outline'}>
              {ban.banType} ban
            </Badge>{' '}
            {ban.reason || 'no reason'}
            <p className='text-muted-foreground text-xs'>
              Given by {ban.issuedByName ?? 'unknown'} on{' '}
              {formatTime(ban.issuedAt)}, until{' '}
              {ban.expiresAt ? formatTime(ban.expiresAt) : 'permanent'}
            </p>
            {ban.liftedAt && (
              <p className='text-muted-foreground text-xs'>
                Lifted by {ban.liftedByName ?? 'unknown'} on{' '}
                {formatTime(ban.liftedAt)}
              </p>
            )}
          </div>
          {active && onLift && (
            <Button
              size='sm'
              variant='outline'
              onClick={() => onLift({ kind: 'ban', id: ban.id })}
            >
              Lift
            </Button>
          )}
        </div>
      </Row>
    )
  }
  if (entry.kind === 'warning') {
    const w = entry.warning
    return (
      <Row>
        <div className='flex items-start justify-between gap-2'>
          <div>
            <Badge variant={w.liftedAt ? 'outline' : 'secondary'}>
              warning
            </Badge>{' '}
            {w.message}
            <p className='text-muted-foreground text-xs'>
              Given by {w.issuedByName ?? 'unknown'} on {formatTime(w.issuedAt)}
              {w.liftedAt ? `. Lifted ${formatTime(w.liftedAt)}` : ''}
            </p>
          </div>
          {onLift && !w.liftedAt && (
            <Button
              size='sm'
              variant='outline'
              onClick={() => onLift({ kind: 'warning', id: w.id })}
            >
              Lift
            </Button>
          )}
        </div>
      </Row>
    )
  }
  if (entry.kind === 'appeal') {
    const a = entry.appeal
    return (
      <Row>
        <Badge variant={a.status === 'open' ? 'secondary' : 'outline'}>
          appeal {a.status}
          {a.outcome ? ` (${a.outcome})` : ''}
        </Badge>{' '}
        {punishmentLabel(a.punishment)}
        <p className='text-muted-foreground text-xs'>
          Made {formatTime(a.createdAt)}: {a.message}
        </p>
        {a.decidedAt && (
          <p className='text-muted-foreground text-xs'>
            Decided by {a.decidedByName ?? 'unknown'} on{' '}
            {formatTime(a.decidedAt)}
            {a.decisionReason ? `: ${a.decisionReason}` : ''}
          </p>
        )}
      </Row>
    )
  }
  if (entry.kind === 'note') {
    return (
      <Row>
        <Badge variant='outline'>note</Badge> {entry.note.note}
        <p className='text-muted-foreground text-xs'>
          {entry.note.authorName ?? 'unknown'},{' '}
          {formatTime(entry.note.createdAt)}
        </p>
      </Row>
    )
  }
  return (
    <Row>
      <Badge variant='outline'>launcher</Badge> {entry.event.kind}:{' '}
      {entry.event.reason}{' '}
      <span className='text-muted-foreground text-xs'>
        {formatTime(entry.event.occurredAt)}
      </span>
    </Row>
  )
}

// Punishments, appeals, staff notes and launcher integrity failures in one
// list, newest first.
export function HistoryTab({
  entries,
  now,
  onLift,
}: {
  entries: HistoryEntry[]
  now: number
  onLift: ((target: LiftTarget) => void) | null
}) {
  if (entries.length === 0) return <Empty>Nothing on record.</Empty>
  return (
    <ul className='space-y-1' data-testid='history-list'>
      {entries.map((e) => (
        <Entry key={e.key} entry={e} now={now} onLift={onLift} />
      ))}
    </ul>
  )
}
