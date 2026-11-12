import { describe, expect, test } from 'bun:test'
import { LEADERBOARD_CATEGORIES, seasonLabel } from './leaderboards'

const seasons = [
  { id: 1, name: 'Season 1' },
  { id: 2, name: 'Closed Beta' },
  { id: 3, name: null },
]

describe('seasonLabel', () => {
  const cases: [name: string, seasonId: number | null, expected: string][] = [
    ['a season named after its number', 1, 'Season 1'],
    ['a season with its own name', 2, 'Closed Beta'],
    ['a season with no name', 3, 'Season 3'],
    ['a season that is not in the list', 9, 'Season 9'],
    ['no season picked yet', null, 'Season …'],
  ]
  for (const [name, seasonId, expected] of cases) {
    test(name, () => {
      expect(seasonLabel(seasons, seasonId)).toBe(expected)
    })
  }

  test('falls back to the number while the seasons are still loading', () => {
    expect(seasonLabel([], 2)).toBe('Season 2')
  })
})

describe('LEADERBOARD_CATEGORIES secondary metric', () => {
  const byId = Object.fromEntries(LEADERBOARD_CATEGORIES.map((c) => [c.id, c]))

  test('PvP boards show no Best Score column', () => {
    expect(byId.pvp?.metricLabel).toBeNull()
  })

  test('Speedrun boards keep Best Time', () => {
    expect(byId.speedrun?.metricLabel).toBe('Best Time')
  })
})
