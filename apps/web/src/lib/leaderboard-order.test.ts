import { describe, expect, test } from 'bun:test'
import {
  pickCategory,
  pickMode,
  sortCategoriesByEntries,
  sortModesByEntries,
} from './leaderboard-order'
import { LEADERBOARD_CATEGORIES } from './leaderboards'

const [speedrun, pvp] = LEADERBOARD_CATEGORIES as [
  (typeof LEADERBOARD_CATEGORIES)[number],
  (typeof LEADERBOARD_CATEGORIES)[number],
]

describe('sortCategoriesByEntries', () => {
  test('puts the mod with the most entries first', () => {
    const counts = {
      MultiplayerSPDRN: { 'ranked:spdrn_gold_stake_single': 5 },
      MultiplayerPvP: {
        'ranked:pvp_ranked_vanilla': 30,
        'ranked:pvp_ranked_balanced': 20,
      },
    }
    expect(
      sortCategoriesByEntries(LEADERBOARD_CATEGORIES, counts).map((c) => c.id)
    ).toEqual(['pvp', 'speedrun'])
  })

  test('keeps today order on a tie and with no counts', () => {
    expect(
      sortCategoriesByEntries(LEADERBOARD_CATEGORIES, {}).map((c) => c.id)
    ).toEqual(['speedrun', 'pvp'])
  })

  test('puts a mod with 0 entries last but keeps it', () => {
    const counts = { MultiplayerPvP: { 'ranked:pvp_ranked_vanilla': 1 } }
    const sorted = sortCategoriesByEntries(LEADERBOARD_CATEGORIES, counts)
    expect(sorted.map((c) => c.id)).toEqual(['pvp', 'speedrun'])
  })
})

describe('sortModesByEntries', () => {
  test('puts the game mode with the most entries first, 0-entry modes last in today order', () => {
    const counts = {
      MultiplayerPvP: {
        'ranked:pvp_ranked_expanded': 9,
        'ranked:pvp_ranked_smallworld': 2,
      },
    }
    expect(sortModesByEntries(pvp, counts).map((m) => m.id)).toEqual([
      'pvp_ranked_expanded',
      'pvp_ranked_smallworld',
      'pvp_ranked_vanilla',
      'pvp_ranked_balanced',
      'pvp_ranked_majorleague',
    ])
  })
})

describe('pickCategory and pickMode', () => {
  test('an explicit id wins over the order', () => {
    expect(pickCategory([pvp, speedrun], 'speedrun').id).toBe('speedrun')
    expect(
      pickMode(sortModesByEntries(pvp, {}), 'pvp_ranked_balanced').id
    ).toBe('pvp_ranked_balanced')
  })

  test('no id or an unknown id opens the first, the biggest when sorted', () => {
    expect(pickCategory([pvp, speedrun], null).id).toBe('pvp')
    expect(pickCategory([pvp, speedrun], 'nope').id).toBe('pvp')
    expect(pickMode(speedrun.modes, 'nope').id).toBe('spdrn_white_stake_triple')
  })
})
