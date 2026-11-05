'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { LogRow } from './components/log-row'
import { STAFF_ACTION_LABELS } from './lib/action-labels'
import {
  CHIP_LABELS,
  CHIP_ORDER,
  type Filters,
  NO_FILTERS,
  type StaffLogEntry,
  apiQuery,
  chipActive,
  filtersOf,
  groupByDay,
  pageOf,
  paramsOfFilters,
  toggleChip,
} from './lib/log-view'

const PAGE_SIZE = 50

interface StaffLogResponse {
  entries: StaffLogEntry[]
  total: number
  pages: number
}

export default function AdminStaffLogPage() {
  // useSearchParams needs Suspense so static prerender does not bail out.
  return (
    <Suspense
      fallback={
        <div className='container py-8 text-muted-foreground'>Loading…</div>
      }
    >
      <StaffLog />
    </Suspense>
  )
}

function StaffLog() {
  const { player, isAdmin, isModerator } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  const search = useSearchParams()
  // The filters and the page live in the URL, so a reload keeps them.
  const filters = useMemo(() => filtersOf(new URLSearchParams(search)), [search])
  const page = pageOf(new URLSearchParams(search))
  const [draft, setDraft] = useState<Filters>(filters)
  useEffect(() => setDraft(filters), [filters])
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])

  const go = (next: Filters, nextPage: number) => {
    const query = paramsOfFilters(next, nextPage).toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
  }

  const { data } = useQuery<StaffLogResponse>({
    queryKey: ['admin-staff-log', filters, page],
    queryFn: () =>
      apiFetch(`/webadmin/staff-log?${apiQuery(filters, page, PAGE_SIZE)}`),
    enabled: isAdmin || isModerator,
    placeholderData: keepPreviousData,
  })
  const entries = data?.entries ?? []
  const groups = useMemo(() => groupByDay(entries, now), [entries, now])
  const set = (change: Partial<Filters>) => setDraft((d) => ({ ...d, ...change }))
  const total = data?.total ?? 0
  const pages = Math.max(1, data?.pages ?? 1)

  return (
    <div className='container max-w-7xl space-y-5 py-8'>
      <div className='flex flex-wrap items-end justify-between gap-2'>
        <div>
          <h1 className='font-pixel text-4xl tracking-tight'>Staff Log</h1>
          <p className='text-muted-foreground text-sm'>
            {isAdmin
              ? 'Every staff action, with who did it and why.'
              : 'Your actions, and the actions taken on queue items.'}
          </p>
        </div>
        <p className='text-muted-foreground text-xs'>
          Showing {entries.length} of {total.toLocaleString()} entries
        </p>
      </div>

      <form
        className='flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card/80 p-4'
        onSubmit={(e) => {
          e.preventDefault()
          go(draft, 1)
        }}
      >
        <div className='space-y-1'>
          <Label htmlFor='sl-staff'>Staff member</Label>
          <Input
            id='sl-staff'
            placeholder='Name or id'
            value={draft.staff}
            onChange={(e) => set({ staff: e.target.value })}
          />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='sl-player'>Player</Label>
          <Input
            id='sl-player'
            placeholder='Name or id'
            value={draft.player}
            onChange={(e) => set({ player: e.target.value })}
          />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='sl-action'>Action</Label>
          <select
            id='sl-action'
            className='h-9 rounded-md border border-input bg-background px-3 text-sm'
            value={draft.action.length === 1 ? (draft.action[0] ?? '') : ''}
            onChange={(e) =>
              set({ action: e.target.value ? [e.target.value] : [] })
            }
          >
            <option value=''>
              {draft.action.length > 1 ? 'Several actions' : 'Any action'}
            </option>
            {Object.entries(STAFF_ACTION_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className='space-y-1'>
          <Label htmlFor='sl-from'>From</Label>
          <Input
            id='sl-from'
            type='date'
            value={draft.from}
            onChange={(e) => set({ from: e.target.value })}
          />
        </div>
        <div className='space-y-1'>
          <Label htmlFor='sl-to'>To</Label>
          <Input
            id='sl-to'
            type='date'
            value={draft.to}
            onChange={(e) => set({ to: e.target.value })}
          />
        </div>
        <div className='ml-auto flex gap-2'>
          <Button type='submit'>Filter</Button>
          <Button
            type='button'
            variant='outline'
            onClick={() => {
              setDraft(NO_FILTERS)
              go(NO_FILTERS, 1)
            }}
          >
            Clear
          </Button>
        </div>
      </form>

      <div className='flex flex-wrap items-center gap-2'>
        <span className='text-muted-foreground text-sm'>Quick</span>
        {CHIP_ORDER.map((chip) => {
          const on = chipActive(chip, filters, now, player?.id ?? null)
          return (
            <button
              key={chip}
              type='button'
              aria-pressed={on}
              onClick={() =>
                go(toggleChip(chip, filters, now, player?.id ?? null), 1)
              }
              className={cn(
                'rounded-full border px-3 py-1 text-xs transition-colors',
                on
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border bg-card/60 hover:bg-accent',
              )}
            >
              {CHIP_LABELS[chip]}
            </button>
          )
        })}
      </div>

      <div className='overflow-hidden rounded-lg border border-border bg-card/80'>
        <div className='hidden grid-cols-[90px_150px_170px_190px_1fr_190px] gap-x-4 border-border border-b px-4 py-3 font-semibold text-muted-foreground text-xs md:grid'>
          <div>When</div>
          <div>Staff member</div>
          <div>Action</div>
          <div>Subject</div>
          <div>Note</div>
          <div className='text-right'>Source</div>
        </div>
        {groups.length === 0 ? (
          <p className='p-6 text-muted-foreground text-sm'>
            No entries found.
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.key}>
              <h2 className='border-border border-b bg-background/40 px-4 py-2 font-semibold text-muted-foreground text-xs'>
                {group.label}
              </h2>
              {group.entries.map((entry) => (
                <LogRow key={entry.id} entry={entry} now={now} />
              ))}
            </section>
          ))
        )}
      </div>

      <div className='flex items-center justify-end gap-2'>
        <Button
          variant='outline'
          size='sm'
          onClick={() => go(filters, Math.max(1, page - 1))}
          disabled={page <= 1}
        >
          Previous
        </Button>
        <span className='text-muted-foreground text-sm'>
          Page {page} of {pages}
        </span>
        <Button
          variant='outline'
          size='sm'
          onClick={() => go(filters, page + 1)}
          disabled={page >= pages}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
