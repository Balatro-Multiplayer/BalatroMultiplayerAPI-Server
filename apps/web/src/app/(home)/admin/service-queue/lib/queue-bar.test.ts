import { describe, expect, test } from 'bun:test'
import type { StrikeSummary } from '../../players/lib/strikes'
import { barActionsOf, deviatesFrom, recommendedPick } from './queue-bar'
import type { ItemDetail } from './types'

const strikes = (chat: string, play: string) =>
  ({
    chat: { steps: [], recommended: chat, counting: [] },
    play: { steps: [], recommended: play, counting: [] },
  }) as unknown as StrikeSummary

const allowed = (action: string, presets?: string[]) => ({
  action,
  presets,
  targeted: false,
  destructive: false,
})

const detail = (
  itemType: string,
  allowedActions: ReturnType<typeof allowed>[],
  extra: Record<string, unknown> = {},
) =>
  ({
    item: { itemType, status: 'open' },
    allowedActions,
    subject: { bans: { active: [] } },
    ...extra,
  }) as unknown as ItemDetail

describe('barActionsOf', () => {
  test('shows only the actions the server allows', () => {
    const bar = barActionsOf(
      detail('report', [allowed('dismiss'), allowed('warn')]),
    )
    expect(bar.map((a) => a.key)).toEqual(['dismiss', 'warn'])
  })

  test('gives a ban its allowed lengths', () => {
    const [ban] = barActionsOf(
      detail('report', [allowed('chat_mute', ['24h', '7d'])]),
    )
    expect(ban?.lengths?.map((l) => l.key)).toEqual(['24h', '7d'])
  })

  test('hides lift ban when the player has no ban', () => {
    expect(barActionsOf(detail('report', [allowed('unban')]))).toEqual([])
  })

  test('a flagged chat item has 2 dismiss buttons', () => {
    const bar = barActionsOf(detail('flagged_chat', [allowed('dismiss')]))
    expect(bar.map((a) => a.key)).toEqual([
      'dismiss:not_harmful',
      'dismiss:harmful_no_action',
    ])
  })

  test('an open appeal shows the decisions the role has', () => {
    const bar = barActionsOf(
      detail('appeal', [], {
        appealDecisions: { deny: true, grant: false },
      }),
    )
    expect(bar.map((a) => a.key)).toEqual(['appeal:deny'])
  })
})

describe('recommendedPick', () => {
  const actions = barActionsOf(
    detail('flagged_chat', [
      allowed('warn'),
      allowed('chat_mute', ['24h', '7d']),
      allowed('queue_ban', ['24h', '7d']),
    ]),
  )
  test('a chat item selects the chat ban at the chat ladder step', () => {
    expect(
      recommendedPick('flagged_chat', actions, strikes('24h', '7d')),
    ).toEqual({
      action: 'chat_mute',
      length: '24h',
    })
  })
  test('a play item selects the queue ban at the play ladder step', () => {
    expect(recommendedPick('report', actions, strikes('24h', '7d'))).toEqual({
      action: 'queue_ban',
      length: '7d',
    })
  })
  test('the first step is the warning', () => {
    expect(
      recommendedPick('flagged_chat', actions, strikes('warning', 'warning')),
    ).toEqual({ action: 'warn', length: null })
  })
  test('is null before the ladder loads or when the bar has no such button', () => {
    expect(recommendedPick('report', actions, undefined)).toBeNull()
    expect(recommendedPick('report', actions, strikes('24h', '30d'))).toBeNull()
  })
})

describe('deviatesFrom', () => {
  test('is null for the recommended step', () => {
    expect(
      deviatesFrom(
        { action: 'chat_mute', length: '24h' },
        'flagged_chat',
        strikes('24h', '24h'),
      ),
    ).toBeNull()
  })
  test('names the recommended step for another step', () => {
    expect(
      deviatesFrom(
        { action: 'chat_mute', length: '7d' },
        'flagged_chat',
        strikes('24h', '24h'),
      ),
    ).toBe('24h')
  })
  test('is null for an action that is no strike', () => {
    expect(
      deviatesFrom(
        { action: 'dismiss', length: null },
        'report',
        strikes('24h', '24h'),
      ),
    ).toBeNull()
  })
})
