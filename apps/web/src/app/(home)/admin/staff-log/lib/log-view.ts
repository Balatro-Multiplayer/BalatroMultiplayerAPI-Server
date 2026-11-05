import { TYPE_LABELS } from '../../service-queue/lib/format'
import {
  matchHref,
  playerHref,
  queueItemHref,
} from '../../service-queue/lib/links'
import { isItemType } from '../../service-queue/lib/types'

// The staff log page's pure logic: the filters and their URL form, the quick
// chips, grouping by day, and the links of one row.

export interface StaffLogEntry {
  id: number
  staffPlayerId: string
  staffName: string | null
  staffRole: string
  action: string
  targetPlayerId: string | null
  targetName: string | null
  itemId: number | null
  itemType: string | null
  reason: string
  detail: unknown
  at: string
}

export interface Filters {
  staff: string
  player: string
  // Action keys, joined by commas in the URL.
  action: string[]
  // Days as YYYY-MM-DD, both inclusive.
  from: string
  to: string
}

export const NO_FILTERS: Filters = {
  staff: '',
  player: '',
  action: [],
  from: '',
  to: '',
}

const DAY = /^\d{4}-\d{2}-\d{2}$/

// The filters in a URL's search params. A wrong day or page reads as unset.
export function filtersOf(params: URLSearchParams): Filters {
  const day = (key: string) => {
    const value = params.get(key) ?? ''
    return DAY.test(value) && !Number.isNaN(Date.parse(value)) ? value : ''
  }
  return {
    staff: params.get('staff')?.trim() ?? '',
    player: params.get('player')?.trim() ?? '',
    action: (params.get('action') ?? '')
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean),
    from: day('from'),
    to: day('to'),
  }
}

export function pageOf(params: URLSearchParams): number {
  const page = Number.parseInt(params.get('page') ?? '', 10)
  return Number.isInteger(page) && page > 0 ? page : 1
}

// The page's search params; empty filters and page 1 are left out.
export function paramsOfFilters(
  filters: Filters,
  page: number
): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.staff.trim()) params.set('staff', filters.staff.trim())
  if (filters.player.trim()) params.set('player', filters.player.trim())
  if (filters.action.length) params.set('action', filters.action.join(','))
  if (filters.from) params.set('from', filters.from)
  if (filters.to) params.set('to', filters.to)
  if (page > 1) params.set('page', String(page))
  return params
}

// The API query. The "to" day is inclusive on the page; the server's bound is
// exclusive, so it gets the day after. Days are read as UTC, as the server
// stores times.
export function apiQuery(
  filters: Filters,
  page: number,
  limit: number
): string {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(limit),
  })
  if (filters.staff.trim()) params.set('staff', filters.staff.trim())
  if (filters.player.trim()) params.set('player', filters.player.trim())
  if (filters.action.length) params.set('action', filters.action.join(','))
  if (filters.from)
    params.set('from', new Date(`${filters.from}T00:00:00Z`).toISOString())
  if (filters.to) {
    const end = new Date(`${filters.to}T00:00:00Z`)
    end.setUTCDate(end.getUTCDate() + 1)
    params.set('to', end.toISOString())
  }
  return params.toString()
}

// --- Quick chips ---

export type ChipKey = 'today' | 'week' | 'bans' | 'voids' | 'lobby' | 'mine'

export const CHIP_LABELS: Record<ChipKey, string> = {
  today: 'Today',
  week: 'Last 7 days',
  bans: 'Bans',
  voids: 'Voids',
  lobby: 'Lobby actions',
  mine: 'Only mine',
}

export const CHIP_ORDER: ChipKey[] = [
  'today',
  'week',
  'bans',
  'voids',
  'lobby',
  'mine',
]

const CHIP_ACTIONS: Partial<Record<ChipKey, string[]>> = {
  bans: ['chat_ban', 'queue_ban', 'account_ban'],
  voids: ['void', 'match_void'],
  lobby: ['lobby_kick', 'lobby_close'],
}

// A day as YYYY-MM-DD in local time.
export function dayKey(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`
}

function daysAgo(now: Date, days: number): string {
  return dayKey(
    new Date(now.getFullYear(), now.getMonth(), now.getDate() - days)
  )
}

const sameActions = (a: string[], b: string[]) =>
  a.length === b.length && b.every((x) => a.includes(x))

export function chipActive(
  chip: ChipKey,
  filters: Filters,
  now: Date,
  myId: string | null
): boolean {
  const today = daysAgo(now, 0)
  if (chip === 'today') return filters.from === today && filters.to === today
  if (chip === 'week')
    return filters.from === daysAgo(now, 6) && filters.to === today
  if (chip === 'mine') return myId !== null && filters.staff === myId
  return sameActions(filters.action, CHIP_ACTIONS[chip] ?? [])
}

// A chip on sets its part of the filters; a chip already on clears it.
export function toggleChip(
  chip: ChipKey,
  filters: Filters,
  now: Date,
  myId: string | null
): Filters {
  const on = chipActive(chip, filters, now, myId)
  if (chip === 'today')
    return {
      ...filters,
      from: on ? '' : daysAgo(now, 0),
      to: on ? '' : daysAgo(now, 0),
    }
  if (chip === 'week')
    return {
      ...filters,
      from: on ? '' : daysAgo(now, 6),
      to: on ? '' : daysAgo(now, 0),
    }
  if (chip === 'mine') return { ...filters, staff: on || !myId ? '' : myId }
  return { ...filters, action: on ? [] : [...(CHIP_ACTIONS[chip] ?? [])] }
}

// --- Rows ---

export interface DayGroup {
  key: string
  label: string
  entries: StaffLogEntry[]
}

const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function dayLabel(date: Date, now: Date): string {
  const key = dayKey(date)
  const short = `${date.getDate()} ${MONTHS[date.getMonth()]}`
  if (key === daysAgo(now, 0)) return `Today, ${short}`
  if (key === daysAgo(now, 1)) return `Yesterday, ${short}`
  return `${WEEKDAYS[date.getDay()]}, ${short}`
}

// Entries (newest first) in runs of one local day, each run with its heading.
export function groupByDay(entries: StaffLogEntry[], now: Date): DayGroup[] {
  const groups: DayGroup[] = []
  for (const entry of entries) {
    const date = new Date(entry.at)
    const key = dayKey(date)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.entries.push(entry)
    else groups.push({ key, label: dayLabel(date, now), entries: [entry] })
  }
  return groups
}

export function clockOf(at: string): string {
  const date = new Date(at)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(date.getHours())}:${p(date.getMinutes())}`
}

// "2 h ago" for the last day, "" after that.
export function agoOf(at: string, now: Date): string {
  const minutes = Math.floor((now.getTime() - new Date(at).getTime()) / 60_000)
  if (minutes < 0) return ''
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.floor(minutes / 60)
  return hours < 24 ? `${hours} h ago` : ''
}

// The match an entry is about: a match edit keeps `matchId`, a queue action
// keeps `runId`.
export function matchIdOf(entry: StaffLogEntry): string | null {
  const detail = entry.detail
  if (!detail || typeof detail !== 'object') return null
  const { matchId, runId } = detail as Record<string, unknown>
  for (const id of [matchId, runId]) if (typeof id === 'string' && id) return id
  return null
}

export function lobbyCodeOf(entry: StaffLogEntry): string | null {
  const detail = entry.detail
  if (!detail || typeof detail !== 'object') return null
  const { code } = detail as Record<string, unknown>
  return typeof code === 'string' && code ? code : null
}

export interface RowLink {
  label: string
  href: string
}

// Where an entry came from: its queue item and its match. Links stay in the
// same tab; the item is not carried, since the log is not a queue item view.
export function sourceLinks(entry: StaffLogEntry): RowLink[] {
  const links: RowLink[] = []
  const matchId = matchIdOf(entry)
  if (matchId) links.push({ label: 'Match', href: matchHref(matchId) })
  if (entry.itemId !== null) {
    const type =
      entry.itemType && isItemType(entry.itemType)
        ? TYPE_LABELS[entry.itemType]
        : null
    links.push({
      label: type ? `Queue item: ${type}` : `Queue item #${entry.itemId}`,
      href: queueItemHref(entry.itemId),
    })
  }
  return links
}

export function targetHref(entry: StaffLogEntry): string | null {
  return entry.targetPlayerId ? playerHref(entry.targetPlayerId) : null
}

export function staffHref(entry: StaffLogEntry): string {
  return playerHref(entry.staffPlayerId)
}

export function shortId(id: string): string {
  return `${id.slice(0, 8)}…`
}

// An entry with no reason is one from before the staff log.
export const NO_REASON_TEXT = 'No note, from before the staff log'
