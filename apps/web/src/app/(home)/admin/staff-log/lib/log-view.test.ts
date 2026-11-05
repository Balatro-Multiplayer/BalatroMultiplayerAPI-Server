import { describe, expect, test } from 'bun:test'
import {
  type StaffLogEntry,
  NO_FILTERS,
  agoOf,
  apiQuery,
  chipActive,
  filtersOf,
  groupByDay,
  pageOf,
  paramsOfFilters,
  sourceLinks,
  toggleChip,
} from './log-view'

const now = new Date(2026, 10, 4, 15, 0)

const entry = (over: Partial<StaffLogEntry> = {}): StaffLogEntry => ({
  id: 1,
  staffPlayerId: 's1',
  staffName: 'Kyro',
  staffRole: 'moderator',
  action: 'chat_ban',
  targetPlayerId: 'p1',
  targetName: 'Bravo',
  itemId: null,
  itemType: null,
  reason: 'spam',
  detail: null,
  at: new Date(2026, 10, 4, 14, 32).toISOString(),
  ...over,
})

describe('filters in the URL', () => {
  test('round trip, with the empty ones left out', () => {
    const filters = {
      staff: 'Ann',
      player: '',
      action: ['void', 'match_void'],
      from: '2026-10-28',
      to: '2026-11-04',
    }
    const params = paramsOfFilters(filters, 3)
    expect(params.toString()).toBe(
      'staff=Ann&action=void%2Cmatch_void&from=2026-10-28&to=2026-11-04&page=3'
    )
    expect(filtersOf(params)).toEqual(filters)
    expect(pageOf(params)).toBe(3)
    expect(paramsOfFilters(NO_FILTERS, 1).toString()).toBe('')
  })

  test('a wrong day or page reads as unset', () => {
    const params = new URLSearchParams('from=soon&to=2026-13-40&page=-2')
    expect(filtersOf(params)).toEqual(NO_FILTERS)
    expect(pageOf(params)).toBe(1)
  })

  test('the API query makes the "to" day inclusive', () => {
    const query = new URLSearchParams(
      apiQuery({ ...NO_FILTERS, from: '2026-10-28', to: '2026-11-04' }, 2, 50)
    )
    expect(query.get('from')).toBe('2026-10-28T00:00:00.000Z')
    expect(query.get('to')).toBe('2026-11-05T00:00:00.000Z')
    expect(query.get('page')).toBe('2')
  })
})

describe('quick chips', () => {
  test('Last 7 days sets six days back to today, and a second press clears it', () => {
    const on = toggleChip('week', NO_FILTERS, now, 'me')
    expect(on.from).toBe('2026-10-29')
    expect(on.to).toBe('2026-11-04')
    expect(chipActive('week', on, now, 'me')).toBe(true)
    expect(toggleChip('week', on, now, 'me')).toEqual(NO_FILTERS)
  })

  test('Bans sets the three ban actions and keeps other filters', () => {
    const on = toggleChip('bans', { ...NO_FILTERS, player: 'Bob' }, now, 'me')
    expect(on.action).toEqual(['chat_ban', 'queue_ban', 'account_ban', 'username_ban'])
    expect(on.player).toBe('Bob')
  })

  test('Only mine sets the staff filter to the viewer', () => {
    const on = toggleChip('mine', NO_FILTERS, now, 'me')
    expect(on.staff).toBe('me')
    expect(chipActive('mine', on, now, null)).toBe(false)
  })
})

describe('rows', () => {
  test('groups by day with Today and Yesterday headings', () => {
    const groups = groupByDay(
      [
        entry({ id: 3 }),
        entry({ id: 2, at: new Date(2026, 10, 4, 9, 0).toISOString() }),
        entry({ id: 1, at: new Date(2026, 10, 3, 22, 10).toISOString() }),
        entry({ id: 0, at: new Date(2026, 10, 1, 8, 0).toISOString() }),
      ],
      now
    )
    expect(groups.map((g) => g.label)).toEqual([
      'Today, 4 Nov',
      'Yesterday, 3 Nov',
      'Sun, 1 Nov',
    ])
    expect(groups[0]?.entries.map((e) => e.id)).toEqual([3, 2])
  })

  test('shows the time since only inside the last day', () => {
    expect(agoOf(entry().at, now)).toBe('28 min ago')
    expect(agoOf(new Date(2026, 10, 4, 12, 0).toISOString(), now)).toBe(
      '3 h ago'
    )
    expect(agoOf(new Date(2026, 10, 3, 12, 0).toISOString(), now)).toBe('')
  })

  test('links the match and the queue item an entry came from', () => {
    expect(sourceLinks(entry())).toEqual([])
    expect(
      sourceLinks(
        entry({ itemId: 7, itemType: 'flagged_chat', detail: { runId: 'r1' } })
      )
    ).toEqual([
      { label: 'Match', href: '/matches/r1' },
      {
        label: 'Queue item: Flagged chat',
        href: '/admin/service-queue?item=7',
      },
    ])
    expect(sourceLinks(entry({ itemId: 9 }))[0]?.label).toBe('Queue item #9')
    expect(sourceLinks(entry({ detail: { matchId: 'm2' } }))[0]?.href).toBe(
      '/matches/m2'
    )
  })
})
