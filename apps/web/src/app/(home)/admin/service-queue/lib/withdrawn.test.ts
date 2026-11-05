import { describe, expect, test } from 'bun:test'
import { isWithdrawn } from './withdrawn'

describe('isWithdrawn', () => {
  test('is true only for an item the player withdrew', () => {
    expect(isWithdrawn({ resolutionAction: 'withdrawn' })).toBe(true)
    expect(isWithdrawn({ resolutionAction: 'dismiss' })).toBe(false)
    expect(isWithdrawn({ resolutionAction: null })).toBe(false)
  })
})
