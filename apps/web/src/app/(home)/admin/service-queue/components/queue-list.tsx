'use client'

import {
  AlertTriangleIcon,
  FlagIcon,
  GavelIcon,
  type LucideIcon,
  MessageSquareWarningIcon,
  ScaleIcon,
  ShieldAlertIcon,
  SwordsIcon,
  TimerOffIcon,
} from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import type { ListFilters } from '../lib/api'
import {
  AUTOMATIC_TYPES,
  ageText,
  minutesLeft,
  type PriorityBand,
  priorityBand,
  TYPE_LABELS,
  TYPE_TABS,
} from '../lib/format'
import type { ItemType, QueueList as List, ListedItem } from '../lib/types'
import { DismissShown } from './dismiss-shown'

const TYPE_ICONS: Record<ItemType, LucideIcon> = {
  report: FlagIcon,
  flagged_chat: MessageSquareWarningIcon,
  match_conflict: ScaleIcon,
  forfeit_reconciliation: TimerOffIcon,
  contest: SwordsIcon,
  anti_cheat: ShieldAlertIcon,
  integrity: AlertTriangleIcon,
  appeal: GavelIcon,
  staff_report: FlagIcon,
}

const PRIORITY_DOT: Record<PriorityBand, string> = {
  high: 'bg-red-500',
  medium: 'bg-amber-400',
  low: 'bg-slate-500',
}

const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

// j/k move the cursor through the rows, Enter opens the row under it.
function useRowKeys(
  items: ListedItem[],
  cursor: number,
  setCursor: (i: number) => void,
  onOpen: (id: number) => void
) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return
      if (document.querySelector('[role="dialog"]')) return
      if (e.key === 'j') setCursor(Math.min(items.length - 1, cursor + 1))
      else if (e.key === 'k') setCursor(Math.max(0, cursor - 1))
      else if (e.key === 'Enter' && items[cursor]) onOpen(items[cursor].id)
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [items, cursor, setCursor, onOpen])
}

function Row({
  item,
  selected,
  waiting,
  cursor,
  now,
  onOpen,
}: {
  item: ListedItem
  selected: boolean
  // Its action is sent in a few seconds.
  waiting: boolean
  cursor: boolean
  now: number
  onOpen: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (cursor) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [cursor])
  const Icon = TYPE_ICONS[item.itemType]
  return (
    <button
      ref={ref}
      type='button'
      onClick={onOpen}
      data-item-id={item.id}
      data-cursor={cursor || undefined}
      className={cn(
        'flex w-full items-start gap-2 border-border border-b px-3 py-2 text-left text-sm hover:bg-accent/50',
        selected && 'bg-accent',
        waiting && 'line-through opacity-50',
        cursor && 'ring-1 ring-ring ring-inset'
      )}
    >
      <span
        className={cn(
          'mt-1.5 size-2 shrink-0 rounded-full',
          PRIORITY_DOT[priorityBand(item.priority)]
        )}
        title={`priority ${item.priority ?? '—'}`}
      />
      <Icon
        className='mt-0.5 size-4 shrink-0 text-muted-foreground'
        aria-label={TYPE_LABELS[item.itemType]}
      />
      <span className='min-w-0 flex-1'>
        <span className='flex items-center gap-1'>
          <span className='truncate font-medium'>
            {item.subjectName ?? 'No subject'}
          </span>
          {item.subjectOpenItems > 1 && (
            <Badge variant='secondary' title='Open items about this player'>
              {item.subjectOpenItems}
            </Badge>
          )}
          {item.status === 'resolved' && (
            <Badge variant='outline'>resolved</Badge>
          )}
        </span>
        <span className='block truncate text-muted-foreground'>
          {item.summary}
        </span>
        {item.claim && (
          <span className='block text-amber-400 text-xs'>
            {item.claim.claimedByName ?? 'Someone'} ·{' '}
            {minutesLeft(item.claim.claimedUntil, now)}m
          </span>
        )}
      </span>
      <span className='shrink-0 text-muted-foreground text-xs'>
        {ageText(item.createdAt, now)}
      </span>
    </button>
  )
}

export function QueueList({
  filters,
  setFilters,
  list,
  isLoading,
  selectedId,
  waitingId,
  cursor,
  setCursor,
  now,
  onOpen,
  automaticTab,
  setAutomaticTab,
}: {
  automaticTab: boolean
  setAutomaticTab: (on: boolean) => void
  filters: ListFilters
  setFilters: (patch: Partial<ListFilters>) => void
  list: List | undefined
  isLoading: boolean
  selectedId: number | null
  waitingId: number | null
  cursor: number
  setCursor: (i: number) => void
  now: number
  onOpen: (id: number) => void
}) {
  const items = list?.items ?? []
  useRowKeys(items, cursor, setCursor, onOpen)
  const automaticOpen = list
    ? AUTOMATIC_TYPES.reduce((n, type) => n + list.counts[type], 0)
    : 0
  const totalOpen = list
    ? Object.values(list.counts).reduce((a, b) => a + b, 0) - automaticOpen
    : 0

  return (
    <div className='flex min-h-0 flex-col'>
      <div
        className='flex flex-wrap gap-1.5 border-border border-b p-3'
        role='tablist'
      >
        {TYPE_TABS.map((tab) => {
          const count = tab.type ? list?.counts[tab.type] : totalOpen
          const active = !automaticTab && filters.itemType === tab.type
          return (
            <Button
              key={tab.label}
              role='tab'
              aria-selected={active}
              data-tab={tab.type ?? 'all'}
              size='sm'
              variant={active ? 'default' : 'ghost'}
              onClick={() => {
                setAutomaticTab(false)
                setFilters({ itemType: tab.type, page: 1 })
              }}
            >
              {tab.label}
              {count !== undefined && (
                <Badge variant={active ? 'secondary' : 'outline'}>
                  {count}
                </Badge>
              )}
            </Button>
          )
        })}
        <Button
          role='tab'
          aria-selected={automaticTab}
          data-tab='automatic'
          size='sm'
          variant={automaticTab ? 'default' : 'ghost'}
          onClick={() => setAutomaticTab(true)}
        >
          Automatic
          {list && (
            <Badge variant={automaticTab ? 'secondary' : 'outline'}>
              {automaticOpen}
            </Badge>
          )}
        </Button>
      </div>

      <div className='border-border border-b p-2'>
        <Input
          className='h-8'
          placeholder='Find a player by name or id'
          value={filters.subject}
          onChange={(e) => setFilters({ subject: e.target.value, page: 1 })}
        />
      </div>

      {automaticTab && (
        <DismissShown itemIds={items.map((i) => i.id)} />
      )}

      <div
        className='min-h-0 flex-1 overflow-y-auto'
        data-testid='queue-rows'
      >
        {isLoading ? (
          <p className='p-3 text-muted-foreground text-sm'>Loading…</p>
        ) : items.length === 0 ? (
          <p className='p-3 text-muted-foreground text-sm'>Nothing here.</p>
        ) : (
          items.map((item, i) => (
            <Row
              key={item.id}
              item={item}
              selected={item.id === selectedId}
              waiting={item.id === waitingId}
              cursor={i === cursor}
              now={now}
              onOpen={() => {
                setCursor(i)
                onOpen(item.id)
              }}
            />
          ))
        )}
      </div>

      {list && list.pages > 1 && (
        <div className='flex items-center justify-between gap-2 border-border border-t p-2 text-sm'>
          <Button
            size='sm'
            variant='outline'
            disabled={filters.page <= 1}
            onClick={() => setFilters({ page: filters.page - 1 })}
          >
            Previous
          </Button>
          <span className='text-muted-foreground'>
            Page {list.page} of {list.pages} · {list.total} items
          </span>
          <Button
            size='sm'
            variant='outline'
            disabled={filters.page >= list.pages}
            onClick={() => setFilters({ page: filters.page + 1 })}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  )
}
