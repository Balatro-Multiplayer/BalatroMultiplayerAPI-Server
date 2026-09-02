'use client'

import Link from 'next/link'
import { archiveDetailHref } from '../../lib/archive-path'
import type { ThreadSummary } from './message-list'

export function ThreadsSection({
  bundlePath,
  threads,
}: {
  bundlePath: string
  threads: ThreadSummary[]
}) {
  if (threads.length === 0) return null

  return (
    <div className='space-y-2'>
      <h2 className='font-semibold text-muted-foreground text-xs uppercase tracking-wide'>
        Threads ({threads.length})
      </h2>
      <div className='grid grid-cols-1 gap-2 sm:grid-cols-2 md:grid-cols-3'>
        {threads.map((t) => (
          <Link
            key={t.id}
            href={archiveDetailHref(`${bundlePath}/threads/${t.dirName}`)}
            className='block rounded-lg bg-muted px-3 py-2 hover:bg-accent'
          >
            <div className='font-semibold text-sm'>🧵 {t.name}</div>
            <div className='text-muted-foreground text-xs'>
              {t.messageCount} messages{t.completed ? '' : ' (partial)'}
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
