// Single source of truth for the leaderboard taxonomy: which mods (categories)
// and game modes have ranked boards, plus how each board's secondary metric is
// displayed. Mirrors the server's metrics.config.ts (keyed by mod id) and the
// ranked queue keys each mod's Find Game pillars use (PvP:
// ui/main_menu/find_game.lua `count_key`), in the mod's pillar order.

import { BOARD_NAMES, displayScore, fromNumber } from '@bmp/types'

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
  /** Column header for the secondary metric; null when the board shows none. */
  metricLabel: string | null
  modes: LeaderboardMode[]
}

export const LEADERBOARD_CATEGORIES: LeaderboardCategory[] = [
  {
    id: 'speedrun',
    label: BOARD_NAMES.MultiplayerSPDRN.label,
    modId: 'MultiplayerSPDRN',
    metric: 'time',
    metricLabel: 'Best Time',
    modes: Object.entries(BOARD_NAMES.MultiplayerSPDRN.modes).map(([id, label]) => ({ id, label })),
  },
  {
    id: 'pvp',
    label: BOARD_NAMES.MultiplayerPvP.label,
    modId: 'MultiplayerPvP',
    metric: 'score',
    // PvP is won by beating the opponent's score, so a best score ranks nothing.
    metricLabel: null,
    modes: Object.entries(BOARD_NAMES.MultiplayerPvP.modes).map(([id, label]) => ({ id, label })),
  },
]

/**
 * Ranked boards are stored under the matchmaking gameMode string, which carries
 * the `ranked:` prefix. The API matches on this exact value.
 */
export function gameModeKey(modeId: string): string {
  return `ranked:${modeId}`
}

/**
 * The name shown for a season: its own name, the same one its pill shows.
 * Falls back to "Season N" for a season with no name or one not loaded yet.
 */
export function seasonLabel(
  seasons: readonly { id: number; name: string | null }[],
  seasonId: number | null
): string {
  if (seasonId === null) return 'Season …'
  return seasons.find((s) => s.id === seasonId)?.name ?? `Season ${seasonId}`
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
  value: number | string | null | undefined,
): string {
  if (value === null || value === undefined) return '-'
  if (kind === 'time') return formatDuration(Number(value))
  // A score is score text; a plain number shows as the same score.
  return displayScore(typeof value === 'string' ? value : fromNumber(value)) ?? '-'
}
