'use client'

import { Badge } from '@/components/ui/badge'
import { formatTime } from '../../lib/format'
import type { IntegrityEvidence as Evidence } from '../../lib/types'
import { ItemLink } from '../item-link'
import { IntegrityEventList } from './anti-cheat-evidence'
import { Empty, Facts, Section } from './shared'

const TRIGGER_TEXT = {
  ranked: 'Failed while in a ranked queue or game',
  repeated: 'Failed several times in one day',
} as const

export function IntegrityEvidence({ evidence }: { evidence: Evidence }) {
  return (
    <div className='space-y-3'>
      <Section title='Integrity failures'>
        <Facts
          rows={[
            ['Day (UTC)', evidence.day ?? '—'],
            [
              'Raised because',
              evidence.trigger ? TRIGGER_TEXT[evidence.trigger] : '—',
            ],
            ['That day', `${evidence.today.length} failed challenges`],
          ]}
        />
        <IntegrityEventList events={evidence.today} />
      </Section>

      <Section title='Recent challenge events (last 20)'>
        <IntegrityEventList events={evidence.recent} />
      </Section>

      <Section title='Recent ranked games'>
        {evidence.rankedGames.length === 0 ? (
          <Empty>No ranked games.</Empty>
        ) : (
          <ul className='space-y-1 text-sm'>
            {evidence.rankedGames.map((g) => (
              <li key={g.matchId}>
                <span className='text-muted-foreground'>
                  {formatTime(g.resultReportedAt)}
                </span>{' '}
                {g.gameMode} <Badge variant='outline'>{g.status}</Badge>{' '}
                <ItemLink
                  className='text-bal-blue hover:underline'
                  to={{ match: g.matchId }}
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
