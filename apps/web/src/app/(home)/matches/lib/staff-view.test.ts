import { describe, expect, test } from 'bun:test'
import {
  actionText,
  backToQueueItem,
  claimText,
  matchTitle,
  queueItemStatusText,
  ratingChangeText,
  staffTabs,
} from './staff-view'

describe('staffTabs', () => {
  test('lists Timeline, Chat, Rounds and Logs in that order', () => {
    const tabs = staffTabs({ chat: 14, rounds: 9, logs: 1 })
    expect(tabs.map((t) => t.label)).toEqual([
      'Timeline',
      'Chat',
      'Rounds',
      'Logs',
    ])
    expect(tabs.map((t) => t.count)).toEqual([null, 14, 9, 1])
  })

  test('has no chat count until the chat is loaded', () => {
    expect(staffTabs({ chat: null, rounds: 0, logs: 2 })[1]?.count).toBeNull()
  })
})

describe('matchTitle', () => {
  test('joins the player names', () => {
    expect(matchTitle(['SWIM', 'rdpaul1234'])).toBe('SWIM vs rdpaul1234')
  })
  test('has a plain title with no players', () => {
    expect(matchTitle([])).toBe('Match')
  })
})

describe('backToQueueItem', () => {
  const items = [{ id: 7, itemType: 'forfeit_reconciliation' as const }]
  test('is absent when staff did not come from an item', () => {
    expect(backToQueueItem(null, items)).toBeNull()
    expect(backToQueueItem(0, items)).toBeNull()
  })
  test('names the type of an item the match lists', () => {
    expect(backToQueueItem(7, items)).toEqual({
      href: '/admin/service-queue/7',
      text: 'Back to queue item: Forfeit',
    })
  })
  test('still links to an item the match does not list', () => {
    expect(backToQueueItem(9, items)).toEqual({
      href: '/admin/service-queue/9',
      text: 'Back to queue item',
    })
  })
})

describe('ratingChangeText', () => {
  test('shows a gain and a loss with the new rating', () => {
    expect(
      ratingChangeText({ delta: 23, newRating: 767, isPlacement: false })
    ).toBe('+23 to 767')
    expect(
      ratingChangeText({ delta: -23, newRating: 854, isPlacement: false })
    ).toBe('-23 to 854')
  })
  test('says so for a placement game and an unrated player', () => {
    expect(
      ratingChangeText({ delta: null, newRating: null, isPlacement: true })
    ).toBe('Placement game')
    expect(
      ratingChangeText({ delta: null, newRating: null, isPlacement: false })
    ).toBe('Not rated')
  })
})

describe('claims and actions', () => {
  test('words a claim', () => {
    expect(claimText('you')).toBe('claimed by you')
    expect(claimText('other')).toBe('claimed by another staff member')
    expect(claimText(null)).toBeNull()
  })
  test('shows a claim only on an open item', () => {
    expect(queueItemStatusText({ status: 'open', claim: 'you' })).toBe(
      'open, claimed by you'
    )
    expect(queueItemStatusText({ status: 'resolved', claim: 'you' })).toBe(
      'resolved'
    )
  })
  test('words an action kind', () => {
    expect(actionText('match_result')).toBe('Set result')
    expect(actionText('lift_warning')).toBe('Lift warning')
  })
})
