import type { GameModeCounts, QueueStatsMod } from '@bmp/types'
import type { NakamaRpcError } from '../infrastructure/nakama/admin-client.js'
import type { Result } from '../shared/utils/result.js'

// What the Stats page reads (features/stats/stats.route.ts).

// disabled: NAKAMA_METRICS_URL is not set.
export type NakamaMetricsError = 'disabled' | 'unreachable' | 'rejected'

// The text body of Nakama's Prometheus endpoint.
export type FetchMetrics = () => Promise<Result<string, NakamaMetricsError>>

// The answer of Nakama's queue_counts RPC for one mod.
export interface QueueCountsAnswer {
	modId: string
	gameModes: Record<string, GameModeCounts>
}

export type FetchQueueCounts = (
	modId: QueueStatsMod,
) => Promise<Result<QueueCountsAnswer, NakamaRpcError>>

export interface StatsTotals {
	matches: number
	players: number
}

export interface BoardEntryCount {
	modId: string
	// Stored under the matchmaking key, with the `ranked:` prefix.
	gameMode: string
	entries: number
}

export interface BoardEntryCounts {
	// null when no season is active.
	season: number | null
	boards: BoardEntryCount[]
}

export interface IStatsRepository {
	// Rows in matchmaking_matches and players.
	countTotals(): Promise<StatsTotals>
	// Entries per board in the current season: the rows the leaderboard lists.
	countBoardEntries(): Promise<BoardEntryCounts>
}
