'use client'

import { Badge } from '@/components/ui/badge'
import { formatTime } from '../../lib/format'
import type { AppealEvidence as Evidence } from '../../lib/types'
import { Empty, Facts, Section } from './shared'

const STATUS_TEXT = {
  open: 'Open',
  denied: 'Denied',
  granted: 'Granted',
} as const

const TARGET_TEXT = {
  ban: 'Ban',
  warning: 'Warning',
  network: 'Network ban',
} as const

export function AppealEvidence({ evidence }: { evidence: Evidence }) {
  const { appeal, punishment } = evidence
  return (
    <div className='space-y-3'>
      <Section
        title='Appeal'
        aside={<Badge variant='outline'>{STATUS_TEXT[appeal.status]}</Badge>}
      >
        <p className='whitespace-pre-wrap text-sm'>{appeal.message}</p>
        <Facts
          rows={[
            ['Sent', formatTime(appeal.createdAt)],
            ...(appeal.decidedAt
              ? ([
                  ['Decided', formatTime(appeal.decidedAt)],
                  ['Reason', appeal.decisionReason ?? '-'],
                ] as [string, string][])
              : []),
          ]}
        />
      </Section>

      <Section title='Appealed punishment'>
        {punishment ? (
          <Facts
            rows={[
              ['Kind', punishment.type],
              ['Reason', punishment.reason ?? '-'],
              ['Issued by', punishment.issuedByName ?? punishment.issuedBy],
              [
                'Ends',
                punishment.expiresAt
                  ? formatTime(punishment.expiresAt)
                  : 'Permanent',
              ],
              [
                'Lifted',
                punishment.liftedAt ? formatTime(punishment.liftedAt) : 'No',
              ],
            ]}
          />
        ) : (
          <Empty>
            {TARGET_TEXT[evidence.target]} on the player's network. A grant
            lifts the bans that blocked them when they appealed.
          </Empty>
        )}
      </Section>

      <Section title='Earlier appeals of the same punishment'>
        {evidence.earlier.length === 0 ? (
          <Empty>None.</Empty>
        ) : (
          <ul className='space-y-2 text-sm'>
            {evidence.earlier.map((a) => (
              <li key={a.createdAt}>
                <span className='text-muted-foreground'>
                  {formatTime(a.createdAt)}
                </span>{' '}
                <Badge variant='outline'>{STATUS_TEXT[a.status]}</Badge>
                <p className='whitespace-pre-wrap'>{a.message}</p>
                {a.decisionReason && (
                  <p className='text-muted-foreground'>
                    Decision: {a.decisionReason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
