'use client'

import { Badge } from '@/components/ui/badge'
import { formatDuration, formatTime, nameOf } from '../../lib/format'
import type {
  AntiCheatEvidence as Evidence,
  IntegrityEventRow,
} from '../../lib/types'
import { ItemLink } from '../item-link'
import { CheckBadge, Empty, Facts, RunSummary, Section } from './shared'

export function IntegrityEventList({
  events,
}: {
  events: IntegrityEventRow[]
}) {
  if (!events.length) return <Empty>No launcher integrity events.</Empty>
  return (
    <ul className='space-y-1 text-sm'>
      {events.map((e) => (
        <li key={e.id}>
          <span className='text-muted-foreground'>
            {formatTime(e.occurredAt)}
          </span>{' '}
          {e.kind} challenge: <Badge variant='destructive'>{e.reason}</Badge>
        </li>
      ))}
    </ul>
  )
}

export function AntiCheatEvidence({
  evidence,
  names,
}: {
  evidence: Evidence
  names: Map<string, string>
}) {
  const { flag } = evidence
  return (
    <div className='space-y-3'>
      <Section title='Flag'>
        <div className='flex flex-wrap items-center gap-2'>
          <Badge variant='destructive'>{flag.reason}</Badge>
          <CheckBadge check={evidence.check} />
        </div>
        <p className='text-sm'>{flag.text}</p>
        <Facts
          rows={[
            ...(flag.reason === 'elapsed_time_gate'
              ? ([
                  ['Scored hands', flag.hands],
                  ['Game lasted', formatDuration(flag.elapsedMs)],
                  ['Gate', formatDuration(flag.minimumMs)],
                ] as [string, string | number][])
              : []),
            ['Log events', evidence.log?.eventCount ?? '—'],
            ['Log status', evidence.log?.status ?? '—'],
            [
              'Log hash',
              <span key='h' className='break-all font-mono text-xs'>
                {evidence.log?.carbonHash ?? '—'}
              </span>,
            ],
            [
              'Also flagged',
              evidence.otherFlaggedPlayers.length
                ? evidence.otherFlaggedPlayers
                    .map((id) => nameOf(names, id))
                    .join(', ')
                : 'nobody else',
            ],
          ]}
        />
      </Section>

      <RunSummary run={evidence.run} replay={evidence.replay} names={names} />

      <Section title='Launcher integrity (last 20)'>
        <IntegrityEventList events={evidence.integrityEvents} />
      </Section>

      <Section title='Past anti-cheat flags'>
        {evidence.pastFlags.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <ul className='space-y-1 text-sm'>
            {evidence.pastFlags.map((f) => (
              <li key={f.runId}>
                <span className='text-muted-foreground'>
                  {formatTime(f.finalizedAt)}
                </span>{' '}
                <Badge variant='outline'>{f.flagReason}</Badge>{' '}
                <ItemLink
                  className='text-bal-blue hover:underline'
                  to={{ match: f.runId }}
                >
                  replay
                </ItemLink>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
