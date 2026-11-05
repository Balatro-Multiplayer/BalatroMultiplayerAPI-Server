'use client'

import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Empty } from '../../service-queue/components/evidence/shared'
import { formatTime } from '../../service-queue/lib/format'
import { matchHref } from '../../service-queue/lib/links'
import type { PageMatch, PageQueueItem } from '../lib/types'

// The player's matches. Links keep the queue item staff came from, so the
// match page can send them back to it.
export function MatchesTab({
  matches,
  total,
  fromItem,
}: {
  matches: PageMatch[]
  total: number
  fromItem: number | null
}) {
  if (matches.length === 0) return <Empty>No matches.</Empty>
  return (
    <div className='space-y-2'>
      <ul className='space-y-1'>
        {matches.map((m) => (
          <li
            key={m.id}
            className='flex items-center justify-between gap-2 rounded-md border border-border p-2 text-sm'
          >
            <Link
              href={matchHref(m.id, fromItem)}
              className='text-bal-blue hover:underline'
            >
              {m.modId} ({m.lobbyType}, {m.status})
            </Link>
            <span className='font-mono text-muted-foreground text-xs'>
              {formatTime(m.startedAt)}
            </span>
          </li>
        ))}
      </ul>
      {total > matches.length && (
        <p className='text-muted-foreground text-xs'>
          Showing the newest {matches.length} of {total}.
        </p>
      )}
    </div>
  )
}

// Every queue item about the player, open and closed.
export function ReportsTab({ items }: { items: PageQueueItem[] }) {
  if (items.length === 0) return <Empty>No queue items about this player.</Empty>
  return (
    <ul className='space-y-1'>
      {items.map((i) => (
        <li key={i.id} className='rounded-md border border-border p-2 text-sm'>
          <Link
            href={`/admin/service-queue?item=${i.id}`}
            className='text-bal-blue hover:underline'
          >
            #{i.id}
          </Link>{' '}
          <Badge variant='outline'>{i.itemType}</Badge> {i.summary}{' '}
          <span className='text-muted-foreground text-xs'>
            {i.status === 'open'
              ? 'open'
              : `closed (${i.resolutionAction ?? 'resolved'})`}
            , {formatTime(i.createdAt)}
          </span>
        </li>
      ))}
    </ul>
  )
}
