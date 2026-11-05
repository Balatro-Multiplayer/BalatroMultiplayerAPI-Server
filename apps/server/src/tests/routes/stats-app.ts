import express from 'express'
import { vi } from 'vitest'
import {
	type StatsRouterDeps,
	createStatsRouter,
} from '../../features/stats/stats.route.js'
import { errorHandler } from '../../middleware/errorHandler.js'
import { err } from '../../shared/utils/result.js'

// The Stats router on its own, with fake Nakama and database sources. Each
// app has its own caches.
export function createStatsTestApp(deps: Partial<StatsRouterDeps> = {}) {
	const sources: StatsRouterDeps = {
		fetchMetrics: vi.fn(async () => err('disabled' as const)),
		fetchQueueCounts: vi.fn(async () => err('disabled' as const)),
		statsRepository: {
			countTotals: vi.fn(async () => ({ matches: 0, players: 0 })),
			countBoardEntries: vi.fn(async () => ({ season: null, boards: [] })),
		},
		...deps,
	}
	const app = express()
	app.use('/api/stats', createStatsRouter(sources))
	app.use(errorHandler)
	return { app, sources }
}
