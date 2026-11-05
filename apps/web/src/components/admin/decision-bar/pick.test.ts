import { describe, expect, test } from 'bun:test'
import {
  type BarAction,
  actionTitle,
  canSend,
  openingPick,
  pickAction,
} from './pick'

const lengths = [
  { key: '24h', label: '24h' },
  { key: '7d', label: '7d' },
]
const actions: BarAction[] = [
  { key: 'dismiss', label: 'Dismiss' },
  { key: 'warn', label: 'Warn' },
  { key: 'chat_mute', label: 'Chat ban', lengths },
  { key: 'queue_ban', label: 'Queue ban', lengths },
]

describe('openingPick', () => {
  test('selects the wanted action and length', () => {
    expect(openingPick(actions, { action: 'chat_mute', length: '7d' })).toEqual(
      {
        action: 'chat_mute',
        length: '7d',
      }
    )
  })
  test('a wanted action the bar does not offer falls back to the first', () => {
    expect(openingPick(actions, { action: 'void', length: null })).toEqual({
      action: 'dismiss',
      length: null,
    })
  })
  test('a wanted length the action does not offer falls back to its first', () => {
    expect(
      openingPick(actions, { action: 'chat_mute', length: '30d' })
    ).toEqual({
      action: 'chat_mute',
      length: '24h',
    })
  })
  test('no wish picks the first action', () => {
    expect(openingPick(actions)).toEqual({ action: 'dismiss', length: null })
  })
  test('no actions pick nothing', () => {
    expect(openingPick([])).toBeNull()
  })
})

describe('pickAction', () => {
  test('keeps the length when the new action offers it', () => {
    expect(
      pickAction(actions, { action: 'chat_mute', length: '7d' }, 'queue_ban')
    ).toEqual({ action: 'queue_ban', length: '7d' })
  })
  test('drops the length for an action without lengths', () => {
    expect(
      pickAction(actions, { action: 'chat_mute', length: '7d' }, 'warn')
    ).toEqual({ action: 'warn', length: null })
  })
})

describe('actionTitle', () => {
  test('names the action and its length', () => {
    expect(actionTitle(actions, { action: 'chat_mute', length: '24h' })).toBe(
      'Chat ban 24h'
    )
  })
  test('names an action without a length', () => {
    expect(actionTitle(actions, { action: 'warn', length: null })).toBe('Warn')
  })
})

describe('canSend', () => {
  const pick = { action: 'warn', length: null }
  test('is off until a note is written', () => {
    expect(canSend(actions, pick, '')).toBe(false)
    expect(canSend(actions, pick, '  \n')).toBe(false)
  })
  test('is on with a note', () => {
    expect(canSend(actions, pick, 'Slurs')).toBe(true)
  })
  test('is off with no pick, an unknown pick or a disabled bar', () => {
    expect(canSend(actions, null, 'Slurs')).toBe(false)
    expect(canSend(actions, { action: 'void', length: null }, 'Slurs')).toBe(
      false
    )
    expect(canSend(actions, pick, 'Slurs', true)).toBe(false)
  })
})
