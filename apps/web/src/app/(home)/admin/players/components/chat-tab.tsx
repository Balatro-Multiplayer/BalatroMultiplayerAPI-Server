'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import Link from 'next/link'
import { useState } from 'react'
import { apiFetch } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Empty } from '../../service-queue/components/evidence/shared'
import { formatTime } from '../../service-queue/lib/format'
import { matchHref } from '../../service-queue/lib/links'
import type { PlayerChatPage } from '../lib/types'

const PAGE_SIZE = 100

// The Chat tab: the player's whole chat, newest first, one group per lobby.
// A group links to its match when the lobby ran one; flagged lines are marked.
export function ChatTab({
  playerId,
  fromItem,
}: {
  playerId: string
  fromItem: number | null
}) {
  const [page, setPage] = useState(1)
  const [flaggedFirst, setFlaggedFirst] = useState(false)
  const { data, isLoading, isError } = useQuery<PlayerChatPage>({
    queryKey: ['admin-player-chat', playerId, page, flaggedFirst],
    queryFn: () =>
      apiFetch(
        `/webadmin/players/${playerId}/chat?page=${page}&limit=${PAGE_SIZE}${
          flaggedFirst ? '&flaggedFirst=true' : ''
        }`
      ),
    placeholderData: keepPreviousData,
  })

  if (isLoading) return <Empty>Loading…</Empty>
  if (isError || !data) return <Empty>Could not load chat.</Empty>

  return (
    <div className='space-y-3' data-testid='chat-tab'>
      <Label className='flex cursor-pointer items-center gap-2 text-sm'>
        <Checkbox
          checked={flaggedFirst}
          onCheckedChange={(c) => {
            setFlaggedFirst(c === true)
            setPage(1)
          }}
        />
        Show flagged lines and their matches first
      </Label>

      {data.groups.length === 0 ? (
        <Empty>No chat lines.</Empty>
      ) : (
        data.groups.map((g) => (
          <section
            key={`${g.key}-${g.lines[0]?.id}`}
            className='space-y-1 rounded-md border border-border p-2'
          >
            <div className='flex flex-wrap items-center justify-between gap-2 text-xs'>
              <span className='font-mono text-muted-foreground'>
                Lobby {g.lobbyCode}
                {g.flagged && (
                  <>
                    {' '}
                    <Badge variant='destructive'>flagged</Badge>
                  </>
                )}
              </span>
              {g.runId && (
                <Link
                  href={matchHref(g.runId, fromItem)}
                  className='text-bal-blue hover:underline'
                >
                  Open match
                </Link>
              )}
            </div>
            <ul className='space-y-1'>
              {g.lines.map((c) => (
                <li
                  key={c.id}
                  className={`rounded px-2 py-1 text-sm ${
                    c.flagged ? 'bg-bal-red/10' : ''
                  }`}
                >
                  {c.flagged && <Badge variant='destructive'>flagged</Badge>}{' '}
                  {c.message}{' '}
                  <span className='text-muted-foreground text-xs'>
                    {formatTime(c.sentAt)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}

      <div className='flex items-center justify-end gap-2'>
        <Button
          variant='outline'
          size='sm'
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
        >
          Previous
        </Button>
        <span className='text-muted-foreground text-sm'>
          Page {data.page} of {Math.max(1, data.pages)}
        </span>
        <Button
          variant='outline'
          size='sm'
          onClick={() => setPage((p) => p + 1)}
          disabled={page >= data.pages}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
