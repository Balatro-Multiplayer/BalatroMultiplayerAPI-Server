// Single source of truth for the leaderboard taxonomy: which mods (categories)
// and game modes have ranked boards, plus how each board's secondary metric is
// displayed. Mirrors the server's metrics.config.ts and the matchmaking gameMode
// keys. Keep this in sync with the seed (seed-leaderboard.ts).

export type MetricKind = 'time' | 'score'

export interface LeaderboardMode {
  /** Gamemode key WITHOUT the ranked: prefix, e.g. 'spdrn_gold_stake_single'. */
  id: string
  label: string
}

export interface LeaderboardCategory {
  /** URL slug, e.g. 'speedrun' | 'pvp'. */
  id: string
  label: string
  modId: string
  metric: MetricKind
  /** Column header for the secondary metric. */
  metricLabel: string
  modes: LeaderboardMode[]
}

export const LEADERBOARD_CATEGORIES: LeaderboardCategory[] = [
  {
    id: 'speedrun',
    label: 'Speedrun',
    modId: 'MultiplayerSpeedrunning',
    metric: 'time',
    metricLabel: 'Best Time',
    modes: [
      { id: 'spdrn_white_stake_triple', label: 'White Stake Triple' },
      { id: 'spdrn_gold_stake_single', label: 'Gold Stake Single' },
    ],
  },
  {
    id: 'pvp',
    label: 'PvP',
    modId: 'MultiplayerPvP',
    metric: 'score',
    metricLabel: 'Best Score',
    modes: [
      { id: 'pvp_standard', label: 'Standard' },
      { id: 'pvp_vanilla', label: 'Vanilla' },
      { id: 'pvp_expanded', label: 'Expanded' },
      { id: 'pvp_smallworld', label: 'Smallworld' },
    ],
  },
]

/**
 * Ranked boards are stored under the matchmaking gameMode string, which carries
 * the `ranked:` prefix. The API matches on this exact value.
 */
export function gameModeKey(modeId: string): string {
  return `ranked:${modeId}`
}

export function getCategory(id: string | null | undefined): LeaderboardCategory {
  // biome-ignore lint/style/noNonNullAssertion: LEADERBOARD_CATEGORIES is non-empty
  return LEADERBOARD_CATEGORIES.find((c) => c.id === id) ?? LEADERBOARD_CATEGORIES[0]!
}

/** Returns the mode if it belongs to the category, otherwise the first mode. */
export function getMode(
  category: LeaderboardCategory,
  modeId: string | null | undefined,
): LeaderboardMode {
  // biome-ignore lint/style/noNonNullAssertion: every category has at least one mode
  return category.modes.find((m) => m.id === modeId) ?? category.modes[0]!
}

/** First mode of a category (every category has at least one). */
export function firstMode(category: LeaderboardCategory): LeaderboardMode {
  // biome-ignore lint/style/noNonNullAssertion: every category has at least one mode
  return category.modes[0]!
}

/** Format ms as m:ss.mmm (speedrun completion time). */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  const millis = Math.floor(ms % 1000)
  return `${minutes}:${seconds.toString().padStart(2, '0')}.${millis
    .toString()
    .padStart(3, '0')}`
}

/** Format a board's secondary metric value for display. */
export function formatMetric(
  kind: MetricKind,
  value: number | null | undefined,
): string {
  if (value === null || value === undefined) return '-'
  return kind === 'time' ? formatDuration(value) : Math.round(value).toLocaleString()
}
