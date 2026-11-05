import {
  type LeaderboardCategory,
  type LeaderboardMode,
  gameModeKey,
} from './leaderboards'

/** Entries per mod id and ranked game mode key, from /stats/leaderboard-counts. */
export type BoardCounts = Record<string, Record<string, number>>

function modeEntries(
  category: LeaderboardCategory,
  mode: LeaderboardMode,
  counts: BoardCounts
): number {
  return counts[category.modId]?.[gameModeKey(mode.id)] ?? 0
}

function categoryEntries(
  category: LeaderboardCategory,
  counts: BoardCounts
): number {
  return category.modes.reduce(
    (sum, mode) => sum + modeEntries(category, mode, counts),
    0
  )
}

/** Biggest mod first. Ties keep the given order, so a 0-entry mod goes last. */
export function sortCategoriesByEntries(
  categories: LeaderboardCategory[],
  counts: BoardCounts
): LeaderboardCategory[] {
  return [...categories].sort(
    (a, b) => categoryEntries(b, counts) - categoryEntries(a, counts)
  )
}

/** Biggest game mode first. Ties keep the given order. */
export function sortModesByEntries(
  category: LeaderboardCategory,
  counts: BoardCounts
): LeaderboardMode[] {
  return [...category.modes].sort(
    (a, b) =>
      modeEntries(category, b, counts) - modeEntries(category, a, counts)
  )
}

/** The category with this id, else the first (the biggest, when sorted). */
export function pickCategory(
  sorted: LeaderboardCategory[],
  id: string | null | undefined
): LeaderboardCategory {
  // biome-ignore lint/style/noNonNullAssertion: the category list is non-empty
  return sorted.find((c) => c.id === id) ?? sorted[0]!
}

/** The mode with this id, else the first (the biggest, when sorted). */
export function pickMode(
  sorted: LeaderboardMode[],
  id: string | null | undefined
): LeaderboardMode {
  // biome-ignore lint/style/noNonNullAssertion: every category has at least one mode
  return sorted.find((m) => m.id === id) ?? sorted[0]!
}
