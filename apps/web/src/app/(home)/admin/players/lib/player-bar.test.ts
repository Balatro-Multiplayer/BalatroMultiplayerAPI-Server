import { describe, expect, test } from 'bun:test'
import {
  deviatesFrom,
  expiryOf,
  playerBarActions,
  requestFor,
  wantedPick,
} from './player-bar'
import type { StrikeSummary } from './strikes'

const strikes = (chat: string, play: string) =>
  ({
    chat: { steps: [], recommended: chat, counting: [] },
    play: { steps: [], recommended: play, counting: [] },
  }) as unknown as StrikeSummary

const NOW = Date.UTC(2026, 10, 4)
const base = {
  playerId: 'p1',
  note: 'Told others to quit.',
  warning: { message: 'Be kind.', ladder: 'chat' as const },
  endsOn: '',
  isAdmin: false,
  lift: null,
  strikes: strikes('24h', 'warning'),
  now: NOW,
}

describe('playerBarActions', () => {
  test('a moderator has note, warn, chat ban and queue ban', () => {
    expect(playerBarActions(false, true).map((a) => a.key)).toEqual([
      'note',
      'warn',
      'chat_ban',
      'queue_ban',
    ])
  })

  test('an admin also bans accounts and lifts when something can be lifted', () => {
    expect(playerBarActions(true, true).map((a) => a.key)).toContain(
      'account_ban',
    )
    expect(playerBarActions(true, true).map((a) => a.key)).toContain('lift')
    expect(playerBarActions(true, false).map((a) => a.key)).toEqual([
      'note',
      'warn',
      'chat_ban',
      'queue_ban',
      'account_ban',
    ])
  })
})

describe('wantedPick', () => {
  test('a ban opens on the ladder length', () => {
    expect(wantedPick('chat_ban', strikes('7d', 'warning'))).toEqual({
      action: 'chat_ban',
      length: '7d',
    })
  })

  test('a ban opens on 24h when the next step is a warning or unknown', () => {
    expect(wantedPick('queue_ban', strikes('7d', 'warning')).length).toBe('24h')
    expect(wantedPick('queue_ban', undefined).length).toBe('24h')
  })

  test('other buttons have no length', () => {
    expect(wantedPick('note', undefined)).toEqual({
      action: 'note',
      length: null,
    })
  })
})

describe('deviatesFrom', () => {
  test('a ban at the ladder step does not deviate', () => {
    expect(
      deviatesFrom({ action: 'chat_ban', length: '24h' }, 'play', strikes('24h', 'warning')),
    ).toBeNull()
  })

  test('another length returns the step the ladder wants', () => {
    expect(
      deviatesFrom({ action: 'chat_ban', length: '30d' }, 'play', strikes('24h', 'warning')),
    ).toBe('24h')
  })

  test('a warning is judged on the chosen ladder', () => {
    expect(
      deviatesFrom({ action: 'warn', length: null }, 'chat', strikes('24h', 'warning')),
    ).toBe('24h')
    expect(
      deviatesFrom({ action: 'warn', length: null }, 'play', strikes('24h', 'warning')),
    ).toBeNull()
  })

  test('a note and an account ban are on no ladder', () => {
    expect(
      deviatesFrom({ action: 'account_ban', length: 'permanent' }, 'play', strikes('24h', 'warning')),
    ).toBeNull()
  })
})

const sent = (input: Parameters<typeof requestFor>[0]) => {
  const r = requestFor(input)
  if (!r.ok) throw new Error(r.missing)
  return r.request
}

describe('requestFor', () => {
  test('a note posts the note', () => {
    expect(sent({ ...base, pick: { action: 'note', length: null } })).toEqual({
      method: 'POST',
      path: '/webadmin/players/p1/notes',
      body: { note: base.note },
    })
  })

  test('a warning needs its text', () => {
    const r = requestFor({
      ...base,
      warning: { message: '  ', ladder: 'chat' },
      pick: { action: 'warn', length: null },
    })
    expect(r.ok).toBe(false)
  })

  test('a warning off the ladder step sends the note as the deviation reason', () => {
    const r = sent({ ...base, pick: { action: 'warn', length: null } })
    expect(r.path).toBe('/webadmin/players/p1/warnings')
    expect(r.body).toEqual({
      message: 'Be kind.',
      reason: base.note,
      ladder: 'chat',
      deviationReason: base.note,
    })
  })

  test('a ban at the ladder step sends no deviation reason and an end date', () => {
    const r = sent({ ...base, pick: { action: 'chat_ban', length: '24h' } })
    expect(r.path).toBe('/webadmin/players/p1/bans')
    expect(r.body).toEqual({
      type: 'chat',
      reason: base.note,
      expiresAt: new Date(NOW + 24 * 3_600_000).toISOString(),
      ladder: 'chat',
      deviationReason: undefined,
    })
  })

  test('a queue ban counts on the play ladder', () => {
    const r = sent({ ...base, pick: { action: 'queue_ban', length: '7d' } })
    expect(r.body.type).toBe('queue')
    expect(r.body.ladder).toBe('play')
    expect(r.body.deviationReason).toBe(base.note)
  })

  test('an account ban is on no ladder and can be permanent', () => {
    const r = sent({
      ...base,
      isAdmin: true,
      pick: { action: 'account_ban', length: 'permanent' },
    })
    expect(r.body.type).toBe('account')
    expect(r.body.expiresAt).toBeNull()
    expect('ladder' in r.body).toBe(false)
  })

  test("an admin's own end date wins over the length", () => {
    const r = sent({
      ...base,
      isAdmin: true,
      endsOn: '2026-12-01',
      pick: { action: 'chat_ban', length: '24h' },
    })
    expect(r.body.expiresAt).toBe(new Date('2026-12-01').toISOString())
  })

  test('a moderator cannot set an end date', () => {
    const r = sent({
      ...base,
      endsOn: '2026-12-01',
      pick: { action: 'chat_ban', length: '24h' },
    })
    expect(r.body.expiresAt).toBe(expiryOf('24h', NOW))
  })

  test('lifting needs a target and deletes it with the note', () => {
    expect(
      requestFor({ ...base, isAdmin: true, pick: { action: 'lift', length: null } }).ok,
    ).toBe(false)
    expect(
      sent({
        ...base,
        isAdmin: true,
        lift: { kind: 'warning', id: 'w1' },
        pick: { action: 'lift', length: null },
      }),
    ).toEqual({
      method: 'DELETE',
      path: '/webadmin/players/p1/warnings/w1',
      body: { reason: base.note },
    })
  })
})
