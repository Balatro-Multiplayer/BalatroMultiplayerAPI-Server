'use client'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { apiFetch } from '@/lib/api'
import { useAuth } from '@/lib/auth'

const PAGE_SIZE = 50

// The server's STAFF_ACTIONS (apps/server shared/staff-log/actions.ts).
const ACTION_LABELS: Record<string, string> = {
  warn: 'Warning',
  note: 'Note',
  chat_ban: 'Chat ban',
  queue_ban: 'Queue ban',
  account_ban: 'Account ban',
  lift_ban: 'Lift',
  lift_network_ban: 'Lift network ban',
  dismiss: 'Dismiss',
  resolve: 'Resolve',
  void: 'Void match',
  overturn: 'Change result',
  reopen: 'Reopen',
  match_result: 'Edit match result',
  match_void: 'Void match (match page)',
  role_grant: 'Give role',
  role_remove: 'Remove role',
  ladder_edit: 'Edit strike ladder',
}

interface StaffLogEntry {
  id: number
  staffPlayerId: string
  staffName: string | null
  staffRole: string
  action: string
  targetPlayerId: string | null
  targetName: string | null
  itemId: number | null
  reason: string
  at: string
}

interface StaffLogResponse {
  entries: StaffLogEntry[]
  total: number
  pages: number
}

interface Filters {
  staff: string
  player: string
  action: string
  from: string
  to: string
}

const NO_FILTERS: Filters = { staff: '', player: '', action: '', from: '', to: '' }

// The "to" day is inclusive on the page; the server's bound is exclusive.
function dayAfter(day: string): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString()
}

function paramsOf(filters: Filters, page: number): string {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(PAGE_SIZE),
  })
  if (filters.staff.trim()) params.set('staff', filters.staff.trim())
  if (filters.player.trim()) params.set('player', filters.player.trim())
  if (filters.action) params.set('action', filters.action)
  if (filters.from) params.set('from', new Date(`${filters.from}T00:00:00Z`).toISOString())
  if (filters.to) params.set('to', dayAfter(filters.to))
  return params.toString()
}

function PlayerLink({ id, name }: { id: string | null; name: string | null }) {
  if (!id) return <span className='text-muted-foreground'>-</span>
  return (
    <a href={`/admin/players/${id}`} className='text-bal-blue hover:underline'>
      {name ?? `${id.slice(0, 8)}…`}
    </a>
  )
}

export default function AdminStaffLogPage() {
  const { isAdmin, isModerator } = useAuth()
  const [page, setPage] = useState(1)
  const [draft, setDraft] = useState<Filters>(NO_FILTERS)
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)

  const { data } = useQuery<StaffLogResponse>({
    queryKey: ['admin-staff-log', filters, page],
    queryFn: () => apiFetch(`/webadmin/staff-log?${paramsOf(filters, page)}`),
    enabled: isAdmin || isModerator,
  })
  const entries = data?.entries ?? []
  const set = (change: Partial<Filters>) => setDraft((d) => ({ ...d, ...change }))

  return (
    <div className='container max-w-6xl space-y-6 py-8'>
      <div>
        <h1 className='font-bold text-2xl tracking-tight'>Staff Log</h1>
        <p className='text-muted-foreground text-sm'>
          {isAdmin
            ? 'Every staff action, with who did it and why.'
            : 'Your actions, and the actions taken on queue items.'}
        </p>
      </div>

      <form
        className='flex flex-wrap items-end gap-3'
        onSubmit={(e) => {
          e.preventDefault()
          setFilters(draft)
          setPage(1)
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
            value={draft.action}
            onChange={(e) => set({ action: e.target.value })}
          >
            <option value=''>Any action</option>
            {Object.entries(ACTION_LABELS).map(([key, label]) => (
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
        <Button type='submit'>Filter</Button>
        <Button
          type='button'
          variant='outline'
          onClick={() => {
            setDraft(NO_FILTERS)
            setFilters(NO_FILTERS)
            setPage(1)
          }}
        >
          Clear
        </Button>
      </form>

      <div className='overflow-x-auto rounded-lg border border-border'>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Time</TableHead>
              <TableHead>Staff member</TableHead>
              <TableHead>Action</TableHead>
              <TableHead>Player</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Queue item</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className='text-muted-foreground'>
                  No entries found.
                </TableCell>
              </TableRow>
            ) : (
              entries.map((entry) => (
                <TableRow key={entry.id}>
                  <TableCell className='whitespace-nowrap text-muted-foreground text-xs'>
                    {new Date(entry.at).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <PlayerLink id={entry.staffPlayerId} name={entry.staffName} />{' '}
                    <span className='text-muted-foreground text-xs'>
                      ({entry.staffRole})
                    </span>
                  </TableCell>
                  <TableCell>
                    {ACTION_LABELS[entry.action] ?? entry.action}
                  </TableCell>
                  <TableCell>
                    <PlayerLink
                      id={entry.targetPlayerId}
                      name={entry.targetName}
                    />
                  </TableCell>
                  <TableCell className='max-w-[420px] break-words'>
                    {entry.reason || (
                      <span className='text-muted-foreground'>
                        (no reason, from before the staff log)
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    {entry.itemId ? (
                      <a
                        href={`/admin/service-queue/${entry.itemId}`}
                        className='text-bal-blue hover:underline'
                      >
                        #{entry.itemId}
                      </a>
                    ) : (
                      <span className='text-muted-foreground'>-</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

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
          Page {page} of {Math.max(1, data?.pages ?? 1)}
        </span>
        <Button
          variant='outline'
          size='sm'
          onClick={() => setPage((p) => p + 1)}
          disabled={page >= (data?.pages ?? 1)}
        >
          Next
        </Button>
      </div>
    </div>
  )
}
