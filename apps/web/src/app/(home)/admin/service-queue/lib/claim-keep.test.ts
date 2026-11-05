import { describe, expect, test } from 'bun:test'
import { keepClaim, KEEP_WINDOW_MS, takeKeepClaim } from './claim-keep'

describe('claim keep', () => {
  test('a link click keeps the claim of that item once', () => {
    keepClaim(5, 1000)
    expect(takeKeepClaim(5, 1100)).toBe(true)
    expect(takeKeepClaim(5, 1100)).toBe(false)
  })

  test('another item or no click releases', () => {
    expect(takeKeepClaim(5, 1000)).toBe(false)
    keepClaim(5, 1000)
    expect(takeKeepClaim(6, 1100)).toBe(false)
  })

  test('an old click does not keep a later release', () => {
    keepClaim(5, 1000)
    expect(takeKeepClaim(5, 1000 + KEEP_WINDOW_MS + 1)).toBe(false)
  })
})
