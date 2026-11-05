import { describe, expect, test } from 'bun:test'
import { itemIdOf, matchHref, playerHref, queueItemHref } from './links'

describe('links', () => {
  test('a player and a match link carry the item', () => {
    expect(playerHref('p1', 7)).toBe('/admin/players/p1?item=7')
    expect(matchHref('r1', 7)).toBe('/matches/r1?item=7')
  })

  test('without an item the link is plain', () => {
    expect(playerHref('p1')).toBe('/admin/players/p1')
    expect(matchHref('r1', null)).toBe('/matches/r1')
  })

  test('the queue opens the same item', () => {
    expect(queueItemHref(7)).toBe('/admin/service-queue?item=7')
  })

  test('reads the item id only from a whole positive number', () => {
    expect(itemIdOf('12')).toBe(12)
    expect(itemIdOf('0')).toBeNull()
    expect(itemIdOf('12abc')).toBeNull()
    expect(itemIdOf('-3')).toBeNull()
    expect(itemIdOf(null)).toBeNull()
  })
})
