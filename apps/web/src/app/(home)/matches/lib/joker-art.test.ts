import { describe, expect, test } from 'bun:test'
import { jokerArt } from './joker-art'

describe('jokerArt', () => {
  test('finds a multiplayer joker and a vanilla joker', () => {
    expect(jokerArt('j_mp_pizza')?.file).toBe('j_mp_pizza.png')
    expect(jokerArt('j_joker') !== null).toBe(true)
  })

  test('gives no image for names that only exist on Object', () => {
    expect(jokerArt('constructor')).toBe(null)
    expect(jokerArt('__proto__')).toBe(null)
    expect(jokerArt('toString')).toBe(null)
  })
})
