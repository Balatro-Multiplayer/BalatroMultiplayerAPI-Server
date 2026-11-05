import { describe, expect, test } from 'bun:test'
import { nextItemId } from './focus'

const open = (id: number) => ({ id, status: 'open' })

describe('nextItemId', () => {
  test('takes the first item of the rail when nothing is open', () => {
    expect(nextItemId([open(4), open(2)], null)).toBe(4)
  })

  test('skips the current item and keeps the rail order', () => {
    expect(nextItemId([open(4), open(2), open(9)], 4)).toBe(2)
    expect(nextItemId([open(4), open(2), open(9)], 2)).toBe(4)
  })

  test('ignores items that are not open', () => {
    expect(nextItemId([{ id: 4, status: 'resolved' }, open(2)], null)).toBe(2)
  })

  test('skips items whose action waits to be sent', () => {
    expect(nextItemId([open(4), open(2), open(9)], 2, [4])).toBe(9)
    expect(nextItemId([open(4)], null, [4])).toBeNull()
  })

  test('is null when nothing else is left', () => {
    expect(nextItemId([open(4)], 4)).toBeNull()
    expect(nextItemId([], null)).toBeNull()
  })
})
