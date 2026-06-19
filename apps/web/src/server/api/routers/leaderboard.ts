import { z } from 'zod'
import {
  createTRPCRouter,
  permissionProcedure,
  publicProcedure,
} from '@/server/api/trpc'
import { getActiveSeasonNumber, getSeasonNumber } from '@/server/seasons'
import type { LeaderboardEntry } from '@/server/services/botlatro.service'
import type { PaginationOptions } from '@/server/services/leaderboard'
import { LeaderboardService } from '@/server/services/leaderboard'
import { SeasonSchema } from '@/shared/seasons'

const service = new LeaderboardService()

type StaticLeaderboardInput = {
  page: number
  pageSize: number
  search?: string
  minGames?: number
  maxGames?: number
  sortBy?: PaginationOptions['sortBy']
  sortOrder?: PaginationOptions['sortOrder']
}

function getStaticLeaderboardResponse(
  seasonData: LeaderboardEntry[],
  input: StaticLeaderboardInput
) {
  let filtered = seasonData

  if (input.search) {
    const searchLower = input.search.toLowerCase()
    filtered = filtered.filter((entry) =>
      entry.name.toLowerCase().includes(searchLower)
    )
  }

  const gamesRange = filtered.reduce(
    (range, entry) => ({
      min: Math.min(range.min, entry.totalgames),
      max: Math.max(range.max, entry.totalgames),
    }),
    { min: Number.POSITIVE_INFINITY, max: 0 }
  )
  const resolvedGamesRange = {
    min: Number.isFinite(gamesRange.min) ? gamesRange.min : 0,
    max: gamesRange.max,
  }

  if (input.minGames !== undefined) {
    const minGames = input.minGames
    filtered = filtered.filter((entry) => entry.totalgames >= minGames)
  }

  if (input.maxGames !== undefined) {
    const maxGames = input.maxGames
    filtered = filtered.filter((entry) => entry.totalgames <= maxGames)
  }

  if (input.sortBy) {
    const sortBy = input.sortBy
    const order = input.sortOrder === 'asc' ? 1 : -1
    filtered = [...filtered].sort((a, b) => {
      const aVal = a[sortBy]
      const bVal = b[sortBy]
      return aVal < bVal ? -order : aVal > bVal ? order : 0
    })
  }

  const total = filtered.length
  const offset = (input.page - 1) * input.pageSize
  const paginated = filtered.slice(offset, offset + input.pageSize)

  return {
    data: paginated,
    total,
    page: input.page,
    pageSize: input.pageSize,
    totalPages: Math.ceil(total / input.pageSize),
    gamesRange: resolvedGamesRange,
    isStale: false,
  }
}

async function resolveSeasonId(season?: string) {
  if (!season) {
    return getActiveSeasonNumber()
  }

  return getSeasonNumber(season) ?? getActiveSeasonNumber()
}

export const leaderboard_router = createTRPCRouter({
  get_leaderboard: publicProcedure
    .input(
      z.object({
        channel_id: z.string(),
        season: SeasonSchema.optional(),
        page: z.number().min(1).optional().default(1),
        pageSize: z.number().min(1).max(100).optional().default(50),
        search: z.string().optional(),
        minGames: z.number().optional(),
        maxGames: z.number().optional(),
        sortBy: z
          .enum([
            'rank',
            'mmr',
            'wins',
            'losses',
            'winrate',
            'totalgames',
            'streak',
            'peak_mmr',
            'peak_streak',
          ])
          .optional(),
        sortOrder: z.enum(['asc', 'desc']).optional(),
      })
    )
    .query(async ({ input }) => {
      const seasonId = await resolveSeasonId(input.season)
      const seasonData = await service.getSeasonLeaderboard(
        seasonId,
        input.channel_id
      )
      return getStaticLeaderboardResponse(seasonData, input)
    }),
  get_leaderboard_snapshots: permissionProcedure('leaderboard.snapshots.view')
    .input(
      z.object({
        channel_id: z.string(),
        limit: z.number().optional(),
      })
    )
    .query(async ({ input }) => {
      return await service.getLeaderboardSnapshots(
        input.channel_id,
        input.limit
      )
    }),
  rating_distribution: publicProcedure
    .input(
      z.object({
        channel_id: z.string(),
        season: SeasonSchema.optional(),
      })
    )
    .query(async ({ input }) => {
      const seasonId = await resolveSeasonId(input.season)
      const entries = await service.getSeasonLeaderboard(
        seasonId,
        input.channel_id
      )

      return entries.map((entry) => entry.mmr)
    }),
  get_user_rank: publicProcedure
    .input(
      z.object({
        channel_id: z.string(),
        user_id: z.string(),
        season: SeasonSchema.optional(),
      })
    )
    .query(async ({ input }) => {
      const seasonId = await resolveSeasonId(input.season)
      const userData = await service.getSeasonUserRank(
        seasonId,
        input.channel_id,
        input.user_id
      )
      if (!userData) return null

      return {
        data: userData,
        isStale: false,
      }
    }),
})
