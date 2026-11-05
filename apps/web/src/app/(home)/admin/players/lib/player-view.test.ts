import { describe, expect, test } from 'bun:test'
import { accountAge, historyOf, lastActionsOf, standingOf } from './player-view'
import type { PlayerPage } from './types'

const DAY = 86_400_000
const NOW = Date.UTC(2026, 10, 4)
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString()

const page = {
  punishments: {
    bans: [
      {
        id: 'b1',
        banType: 'chat',
        issuedAt: iso(5),
        expiresAt: iso(-2),
        liftedAt: null,
      },
      {
        id: 'b2',
        banType: 'queue',
        issuedAt: iso(30),
        expiresAt: iso(20),
        liftedAt: null,
      },
    ],
    warnings: [{ id: 'w1', issuedAt: iso(10) }],
  },
  appeals: [{ id: 'a1', createdAt: iso(1) }],
  notes: [{ id: 'n1', createdAt: iso(3) }],
  integrityEvents: [{ id: 9, occurredAt: iso(40) }],
  matchTotal: 12,
  player: { createdAt: iso(9), chatEnabled: true, chatBlocked: false },
} as unknown as PlayerPage

describe('historyOf', () => {
  test('lists every kind, newest first', () => {
    expect(historyOf(page).map((e) => e.key)).toEqual([
      'appeal:a1',
      'note:n1',
      'ban:b1',
      'warning:w1',
      'ban:b2',
      'integrity:9',
    ])
  })
})

describe('accountAge', () => {
  test('says days, then months, then years', () => {
    expect(accountAge(iso(0), NOW)).toBe('today')
    expect(accountAge(iso(1), NOW)).toBe('1 day')
    expect(accountAge(iso(9), NOW)).toBe('9 days')
    expect(accountAge(iso(90), NOW)).toBe('3 months')
    expect(accountAge(iso(800), NOW)).toBe('2 years')
  })
})

describe('standingOf', () => {
  test('counts only bans in force', () => {
    const rows = Object.fromEntries(standingOf(page, NOW))
    expect(rows.Bans).toBe('chat')
    expect(rows.Matches).toBe('12')
    expect(rows['Account age']).toBe('9 days')
    expect(rows.Chat).toBe('on')
  })

  test('says none active without bans', () => {
    const rows = Object.fromEntries(
      standingOf(
        { ...page, punishments: { bans: [], warnings: [] } } as PlayerPage,
        NOW
      )
    )
    expect(rows.Bans).toBe('none active')
  })
})

describe('lastActionsOf', () => {
  test('keeps the newest and words the action', () => {
    const out = lastActionsOf(
      [
        {
          id: 1,
          staffName: 'Kyro',
          action: 'warn',
          itemId: null,
          reason: 'a',
          at: iso(5),
        },
        {
          id: 2,
          staffName: null,
          action: 'dismiss',
          itemId: 3,
          reason: 'b',
          at: iso(2),
        },
        {
          id: 3,
          staffName: 'Kyro',
          action: 'mod_pin',
          itemId: null,
          reason: 'c',
          at: iso(9),
        },
      ],
      2
    )
    expect(out.map((a) => [a.text, a.by])).toEqual([
      ['Item dismissed', 'unknown'],
      ['Warned', 'Kyro'],
    ])
  })

  test('an unknown action reads as plain words', () => {
    expect(
      lastActionsOf([
        {
          id: 1,
          staffName: 'K',
          action: 'mod_pin',
          itemId: null,
          reason: '',
          at: iso(1),
        },
      ])[0]?.text
    ).toBe('mod pin')
  })
})
