import { describe, expect, test } from 'bun:test'
import { parseLovelyIdolRolls } from './parse-lovely-idol'

const payload = Buffer.from(
  JSON.stringify({ roll: 0.62, winner: 'QH', cards: ['KS4', 'QH3', 'AS1'] })
).toString('base64')

describe('parseLovelyIdolRolls', () => {
  test('extracts rolls in file order and skips noise', () => {
    const text = [
      'INFO - [G] unrelated line',
      `INFO - [G] IdolAlgo | IDOL_ROLL::${payload}`,
      'INFO - [G] IDOL_ROLL::!!!not-base64',
      `INFO - [G] IDOL_ROLL::${payload}`,
    ].join('\n')
    const rolls = parseLovelyIdolRolls(text)
    expect(rolls).toHaveLength(2)
    expect(rolls[0]?.winner).toBe('QH')
    expect(rolls[1]?.t).toBe(1)
  })
})
