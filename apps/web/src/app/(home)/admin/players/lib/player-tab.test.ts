import { describe, expect, test } from 'bun:test'
import {
  backToQueueItem,
  openingTab,
  sourceTypeOf,
  tabsFor,
} from './player-tab'

describe('openingTab', () => {
  test('opens Chat from a chat item', () => {
    expect(openingTab('flagged_chat')).toBe('chat')
  })

  test('opens Matches from a report or a forfeit', () => {
    expect(openingTab('report')).toBe('matches')
    expect(openingTab('forfeit_reconciliation')).toBe('matches')
  })

  test('opens History otherwise', () => {
    expect(openingTab(null)).toBe('history')
    expect(openingTab('appeal')).toBe('history')
    expect(openingTab('anti_cheat')).toBe('history')
  })
})

describe('tabsFor', () => {
  test('a moderator has no Linked accounts tab', () => {
    expect(tabsFor(false)).toEqual(['history', 'chat', 'matches', 'reports'])
  })

  test('an admin has all 5 tabs', () => {
    expect(tabsFor(true)).toHaveLength(5)
  })
})

describe('backToQueueItem', () => {
  const items = [{ id: 4, itemType: 'flagged_chat' }]

  test('no link without an item', () => {
    expect(backToQueueItem(null, items)).toBeNull()
  })

  test('names the item type and returns to the same item', () => {
    expect(backToQueueItem(4, items)).toEqual({
      href: '/admin/service-queue?item=4',
      text: 'Back to queue item: Flagged chat',
    })
  })

  test('an item of another player still gets a link', () => {
    expect(backToQueueItem(9, items)).toEqual({
      href: '/admin/service-queue?item=9',
      text: 'Back to queue item',
    })
  })
})

test('sourceTypeOf finds the type or null', () => {
  expect(sourceTypeOf(4, [{ id: 4, itemType: 'report' }])).toBe('report')
  expect(sourceTypeOf(5, [{ id: 4, itemType: 'report' }])).toBeNull()
  expect(sourceTypeOf(null, [])).toBeNull()
})
