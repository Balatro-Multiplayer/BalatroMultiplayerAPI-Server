'use client'

import { Badge } from '@/components/ui/badge'
import { Empty } from '../../service-queue/components/evidence/shared'
import { formatTime } from '../../service-queue/lib/format'
import type { PageChatLine } from '../lib/types'

// The Chat tab. For now it lists the newest lines the player page carries;
// the full paged history grouped by match replaces this body (same props
// plus the player id for its own query).
export function ChatTab({ lines }: { playerId: string; lines: PageChatLine[] }) {
  if (lines.length === 0) return <Empty>No chat lines.</Empty>
  return (
    <ul className='space-y-1' data-testid='chat-tab'>
      {lines.map((c) => (
        <li
          key={c.id}
          className='rounded-md border border-border p-2 text-sm'
        >
          {c.flagged && <Badge variant='destructive'>flagged</Badge>}{' '}
          {c.message}{' '}
          <span className='text-muted-foreground text-xs'>
            {c.lobbyCode}, {formatTime(c.sentAt)}
          </span>
        </li>
      ))}
    </ul>
  )
}
