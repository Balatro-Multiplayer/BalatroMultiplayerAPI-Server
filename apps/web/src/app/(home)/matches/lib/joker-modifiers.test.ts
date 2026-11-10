import { describe, expect, test } from 'bun:test'
import { jokerModifiers } from './joker-modifiers'

describe('jokerModifiers', () => {
  test('lists the edition first, then stickers', () => {
    expect(
      jokerModifiers(['st:eternal', 'ed:holo', 'perishable']).map(
        (m) => m.label
      )
    ).toEqual(['Holographic', 'Eternal', 'Perishable'])
  })

  test('ignores tags that are not modifiers', () => {
    expect(jokerModifiers(['e:m_glass', 's:Gold'])).toEqual([])
  })
})
