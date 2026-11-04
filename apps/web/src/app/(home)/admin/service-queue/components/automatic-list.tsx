'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  dismissAutomatic,
  listAutomatic,
  listQueue,
  queueKeys,
} from '../lib/api'
import { ageText, TYPE_LABELS } from '../lib/format'
import type { AutomaticGroup } from '../lib/types'

const LIST_REFRESH_MS = 30_000

// The player's open automatic items. Staff open one at a time, or dismiss
// them all with one reason.
function GroupItems({
  group,
  now,
  onOpen,
}: {
  group: AutomaticGroup
  now: number
  onOpen: (id: number) => void
}) {
  const queryClient = useQueryClient()
  const [reason, setReason] = useState('')
  const filters = {
    lane: null,
    itemType: null,
    status: 'open',
    sort: 'age',
    subject: group.playerId,
    claimedByMe: false,
    olderThanHours: 0,
    page: 1,
  } as const
  const { data } = useQuery({
    queryKey: queueKeys.list(filters),
    queryFn: () => listQueue(filters),
  })
  const dismiss = useMutation({
    mutationFn: () => dismissAutomatic(group.playerId, reason.trim()),
    onSuccess: () => {
      setReason('')
      void queryClient.invalidateQueries({ queryKey: queueKeys.all })
    },
  })
  const items = (data?.items ?? []).filter(
    (i) => i.itemType === 'anti_cheat' || i.itemType === 'integrity'
  )
  return (
    <div className='border-border border-b bg-muted/30'>
      {items.map((item) => (
        <button
          key={item.id}
          type='button'
          onClick={() => onOpen(item.id)}
          className='flex w-full items-start gap-2 px-6 py-1.5 text-left text-xs hover:bg-accent/50'
        >
          <span className='shrink-0 text-muted-foreground'>
            {TYPE_LABELS[item.itemType]}
          </span>
          <span className='min-w-0 flex-1 truncate'>{item.summary}</span>
          <span className='shrink-0 text-muted-foreground'>
            {ageText(item.createdAt, now)}
          </span>
        </button>
      ))}
      <a
        href={`/admin/players/${group.playerId}`}
        className='block px-3 pt-2 text-bal-blue text-xs hover:underline'
      >
        Open player page
      </a>
      <div className='flex items-center gap-2 px-3 py-2'>
        <Input
          className='h-8 flex-1'
          placeholder='Reason for dismissing all'
          aria-label='Reason'
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <Button
          size='sm'
          variant='outline'
          disabled={reason.trim() === '' || dismiss.isPending}
          onClick={() => dismiss.mutate()}
        >
          Dismiss all {group.openItems}
        </Button>
      </div>
      {dismiss.data && dismiss.data.failed.length > 0 && (
        <p className='px-3 pb-2 text-amber-400 text-xs'>
          {dismiss.data.failed.length} item(s) were not dismissed (for example,
          someone is handling them).
        </p>
      )}
      {dismiss.isError && (
        <p className='px-3 pb-2 text-red-400 text-xs'>Dismiss failed.</p>
      )}
    </div>
  )
}

export function AutomaticList({
  now,
  onOpen,
}: {
  now: number
  onOpen: (id: number) => void
}) {
  const [openPlayer, setOpenPlayer] = useState<string | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: queueKeys.automatic,
    queryFn: listAutomatic,
    refetchInterval: LIST_REFRESH_MS,
  })
  const groups = data?.groups ?? []
  if (isLoading)
    return <p className='p-3 text-muted-foreground text-sm'>Loading…</p>
  if (groups.length === 0)
    return <p className='p-3 text-muted-foreground text-sm'>Nothing here.</p>
  return (
    <div
      className='min-h-0 flex-1 overflow-y-auto'
      data-testid='automatic-rows'
    >
      {groups.map((group) => (
        <div key={group.playerId}>
          <button
            type='button'
            onClick={() =>
              setOpenPlayer(
                openPlayer === group.playerId ? null : group.playerId
              )
            }
            aria-expanded={openPlayer === group.playerId}
            className='flex w-full items-start gap-2 border-border border-b px-3 py-2 text-left text-sm hover:bg-accent/50'
          >
            <span className='min-w-0 flex-1'>
              <span className='flex items-center gap-1'>
                <span className='truncate font-medium'>
                  {group.playerName ?? group.playerId}
                </span>
                <Badge variant='secondary' title='Open automatic items'>
                  {group.openItems}
                </Badge>
              </span>
              <span className='block truncate text-muted-foreground'>
                {group.latestItem.summary}
              </span>
            </span>
            <span className='shrink-0 text-muted-foreground text-xs'>
              {ageText(group.latestItem.createdAt, now)}
            </span>
          </button>
          {openPlayer === group.playerId && (
            <GroupItems group={group} now={now} onOpen={onOpen} />
          )}
        </div>
      ))}
    </div>
  )
}
