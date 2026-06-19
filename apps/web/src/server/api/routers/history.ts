import { and, asc, desc, eq, gt, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import {
  createTRPCRouter,
  permissionProcedure,
  publicProcedure,
} from '@/server/api/trpc'
import { player_games } from '@/server/db/schema'
import type { SelectGames } from '@/server/db/types'
import { getSeasonForDate } from '@/server/seasons'
import {
  botlatro_service,
  type PlayerMatch,
} from '@/server/services/botlatro.service'
import { fetchMatches, QUEUE_IDS } from '@/server/services/match-fetcher'
import {
  CASUAL_QUEUE_ID,
  LEGACY_QUEUE_ID,
  RANKED_QUEUE_ID,
  SANDBOX_QUEUE_ID,
  SMALLWORLD_QUEUE_ID,
  VANILLA_QUEUE_ID,
} from '@/shared/constants'
import { SEASON_5_START_DATE, SeasonSchema } from '@/shared/seasons'

function formatTimeKey(date: Date, groupBy: string): string {
  switch (groupBy) {
    case 'hour':
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:00`
    case 'day':
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    case 'week': {
      const firstDayOfWeek = new Date(date)
      firstDayOfWeek.setDate(date.getDate() - date.getDay())
      return `Week of ${firstDayOfWeek.getFullYear()}-${String(firstDayOfWeek.getMonth() + 1).padStart(2, '0')}-${String(firstDayOfWeek.getDate()).padStart(2, '0')}`
    }
    case 'month':
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    default:
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:00`
  }
}

export const history_router = createTRPCRouter({
  getTranscript: permissionProcedure('transcripts.view')
    .input(
      z.object({
        gameNumber: z.number(),
      })
    )
    .query(async ({ input }) => {
      return await botlatro_service.get_transcript(input.gameNumber)
    }),
  searchTranscriptLobbyCodes: permissionProcedure('transcripts.search')
    .input(
      z.object({
        query: z.string().trim().min(1),
        limit: z.number().int().min(1).max(100).default(50),
      })
    )
    .query(async ({ input }) => {
      return await botlatro_service.search_transcript_lobby_codes(input)
    }),
  games_per_hour: publicProcedure
    .input(
      z
        .object({
          groupBy: z.enum(['hour', 'day', 'week', 'month']).default('hour'),
          startDate: z.string().optional(),
          endDate: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const groupBy = input?.groupBy || 'hour'
      const startDate = input?.startDate ? new Date(input.startDate) : undefined
      const endDate = input?.endDate ? new Date(input.endDate) : undefined
      const nextDay = endDate ? new Date(endDate) : undefined
      if (nextDay) nextDay.setDate(nextDay.getDate() + 1)

      const effectiveEnd = nextDay ?? new Date()
      const needsDb = !startDate || startDate < SEASON_5_START_DATE
      const needsApi = !nextDay || effectiveEnd > SEASON_5_START_DATE

      const gamesByTimeUnit: Record<string, number> = {}

      // Old data (seasons 1-4) from DB
      if (needsDb) {
        const dbEnd =
          nextDay && nextDay < SEASON_5_START_DATE
            ? nextDay
            : SEASON_5_START_DATE
        const games = await ctx.db
          .select({
            gameTime: player_games.gameTime,
            gameNum: player_games.gameNum,
          })
          .from(player_games)
          .where(
            and(
              startDate ? gt(player_games.gameTime, startDate) : undefined,
              lt(player_games.gameTime, dbEnd)
            )
          )
          .orderBy(player_games.gameTime)

        const seen = new Set<number>()
        for (const game of games) {
          if (!game.gameTime || !game.gameNum || seen.has(game.gameNum))
            continue
          seen.add(game.gameNum)
          const key = formatTimeKey(new Date(game.gameTime), groupBy)
          gamesByTimeUnit[key] = (gamesByTimeUnit[key] || 0) + 1
        }
      }

      // Season 5+ data from Botlatro API
      if (needsApi) {
        const allMatches = (
          await Promise.all([
            ...QUEUE_IDS.map((q) => fetchMatches(q, 'season5')),
            ...QUEUE_IDS.map((q) => fetchMatches(q, 'season6')),
          ])
        ).flat()

        const apiStart =
          startDate && startDate > SEASON_5_START_DATE
            ? startDate
            : SEASON_5_START_DATE

        const seen = new Set<number>()
        for (const m of allMatches) {
          if (seen.has(m.match_id)) continue
          seen.add(m.match_id)
          const date = new Date(m.created_at)
          if (date < apiStart) continue
          if (nextDay && date >= nextDay) continue
          const key = formatTimeKey(date, groupBy)
          gamesByTimeUnit[key] = (gamesByTimeUnit[key] || 0) + 1
        }
      }

      return Object.entries(gamesByTimeUnit)
        .map(([timeUnit, count]) => ({ timeUnit, count, groupBy }))
        .sort((a, b) => a.timeUnit.localeCompare(b.timeUnit))
    }),
  user_games: publicProcedure
    .input(
      z.object({
        user_id: z.string(),
        queue_id: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      // Seasons 1-4: read from DB
      const dbGames = await ctx.db
        .select()
        .from(player_games)
        .where(
          and(
            eq(player_games.playerId, input.user_id),
            lt(player_games.gameTime, SEASON_5_START_DATE)
          )
        )
        .orderBy(desc(player_games.gameTime))

      // Season 5+: read from Botlatro API
      const matches = await botlatro_service.get_player_matches({
        userId: input.user_id,
      })
      const apiGames = (await normalizeBotlatroMatchHistory(matches)).filter(
        (g) => g.gameTime >= SEASON_5_START_DATE
      )

      return [...dbGames, ...apiGames]
    }),

  user_games_page: publicProcedure
    .input(
      z.object({
        user_id: z.string(),
        season: SeasonSchema,
        gameType: z
          .enum([
            'ranked',
            'smallworld',
            'vanilla',
            'legacy',
            'sandbox',
            'casual',
          ])
          .optional(),
        result: z.enum(['win', 'loss', 'tie']).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(50),
        sortBy: z
          .enum([
            'gameId',
            'gameTime',
            'opponentName',
            'gameType',
            'deck',
            'stake',
            'opponentMmr',
            'playerMmr',
            'mmrChange',
          ])
          .default('gameTime'),
        sortOrder: z.enum(['asc', 'desc']).default('desc'),
      })
    )
    .query(async ({ ctx, input }) => {
      const page = input.page
      const pageSize = input.pageSize
      const offset = (page - 1) * pageSize

      if (input.season !== 'season6' && input.season !== 'season5') {
        const dir = input.sortOrder === 'asc' ? asc : desc
        const sortCol =
          input.sortBy === 'gameId'
            ? player_games.gameId
            : input.sortBy === 'opponentName'
              ? player_games.opponentName
              : input.sortBy === 'gameType'
                ? player_games.gameType
                : input.sortBy === 'deck'
                  ? player_games.deck
                  : input.sortBy === 'stake'
                    ? player_games.stake
                    : input.sortBy === 'opponentMmr'
                      ? player_games.opponentMmr
                      : input.sortBy === 'playerMmr'
                        ? player_games.playerMmr
                        : input.sortBy === 'mmrChange'
                          ? player_games.mmrChange
                          : player_games.gameTime

        const where = and(
          eq(player_games.playerId, input.user_id),
          eq(player_games.season, input.season),
          input.gameType
            ? eq(player_games.gameType, input.gameType)
            : undefined,
          input.result ? eq(player_games.result, input.result) : undefined
        )

        const [{ total } = { total: 0 }] = await ctx.db
          .select({ total: sql<string>`count(*)::int` })
          .from(player_games)
          .where(where)

        const rows = await ctx.db
          .select()
          .from(player_games)
          .where(where)
          .orderBy(
            dir(sortCol),
            desc(player_games.gameTime),
            desc(player_games.gameNum)
          )
          .limit(pageSize)
          .offset(offset)

        const totalNum = Number(total ?? 0)
        const totalPages = Math.max(1, Math.ceil(totalNum / pageSize))

        return { data: rows, page, pageSize, total: totalNum, totalPages }
      }

      const queueId =
        input.gameType === 'ranked'
          ? RANKED_QUEUE_ID
          : input.gameType === 'smallworld'
            ? SMALLWORLD_QUEUE_ID
            : input.gameType === 'vanilla' || input.gameType === 'legacy'
              ? VANILLA_QUEUE_ID
              : input.gameType === 'sandbox'
                ? SANDBOX_QUEUE_ID
                : input.gameType === 'casual'
                  ? CASUAL_QUEUE_ID
                  : undefined

      const matches = await botlatro_service.get_player_matches({
        userId: input.user_id,
        queueId,
        limit: Math.min(5000, page * pageSize * 5),
      })
      let rows = (await normalizeBotlatroMatchHistory(matches)).filter(
        (g) => g.season === input.season
      )

      if (input.result) rows = rows.filter((g) => g.result === input.result)
      if (input.gameType)
        rows = rows.filter((g) => g.gameType === input.gameType)

      const dir = input.sortOrder === 'asc' ? 1 : -1
      rows.sort((a, b) => {
        if (input.sortBy === 'gameId') return dir * (a.gameId - b.gameId)
        if (input.sortBy === 'gameTime') {
          return dir * (a.gameTime.getTime() - b.gameTime.getTime())
        }
        if (input.sortBy === 'mmrChange')
          return dir * (a.mmrChange - b.mmrChange)
        if (input.sortBy === 'opponentMmr')
          return dir * (a.opponentMmr - b.opponentMmr)
        if (input.sortBy === 'playerMmr')
          return dir * (a.playerMmr - b.playerMmr)
        if (input.sortBy === 'opponentName') {
          return dir * a.opponentName.localeCompare(b.opponentName)
        }
        if (input.sortBy === 'gameType') {
          return dir * a.gameType.localeCompare(b.gameType)
        }
        if (input.sortBy === 'deck') {
          return dir * String(a.deck ?? '').localeCompare(String(b.deck ?? ''))
        }
        if (input.sortBy === 'stake') {
          return (
            dir * String(a.stake ?? '').localeCompare(String(b.stake ?? ''))
          )
        }
        return dir * (a.gameTime.getTime() - b.gameTime.getTime())
      })

      const total = rows.length
      const totalPages = Math.max(1, Math.ceil(total / pageSize))
      const pageRows = rows.slice(offset, offset + pageSize)

      return { data: pageRows, page, pageSize, total, totalPages }
    }),

  user_opponents_stats_page: publicProcedure
    .input(
      z.object({
        user_id: z.string(),
        season: SeasonSchema,
        gameType: z
          .enum([
            'ranked',
            'smallworld',
            'vanilla',
            'legacy',
            'sandbox',
            'casual',
          ])
          .optional(),
        result: z.enum(['win', 'loss', 'tie']).optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(50),
        sortBy: z
          .enum([
            'opponentName',
            'totalGames',
            'wins',
            'losses',
            'winRate',
            'totalMMRChange',
          ])
          .default('totalGames'),
        sortOrder: z.enum(['asc', 'desc']).default('desc'),
      })
    )
    .query(async ({ ctx, input }) => {
      const page = input.page
      const pageSize = input.pageSize
      const offset = (page - 1) * pageSize

      if (input.season !== 'season6' && input.season !== 'season5') {
        const where = and(
          eq(player_games.playerId, input.user_id),
          eq(player_games.season, input.season),
          input.gameType
            ? eq(player_games.gameType, input.gameType)
            : undefined,
          input.result ? eq(player_games.result, input.result) : undefined
        )

        const totalGamesExpr = sql<number>`count(*) filter (where ${player_games.result} <> 'tie')::int`
        const winsExpr = sql<number>`sum(case when ${player_games.mmrChange} > 0 then 1 else 0 end)::int`
        const lossesExpr = sql<number>`sum(case when ${player_games.mmrChange} < 0 then 1 else 0 end)::int`
        const totalMMRChangeExpr = sql<number>`coalesce(sum(${player_games.mmrChange}), 0)`
        const winRateExpr = sql<number>`case when ${totalGamesExpr} = 0 then null else (${winsExpr}::float / ${totalGamesExpr}::float) * 100 end`

        const orderDir = input.sortOrder === 'asc' ? asc : desc
        const orderExpr =
          input.sortBy === 'opponentName'
            ? orderDir(player_games.opponentName)
            : input.sortBy === 'wins'
              ? orderDir(winsExpr)
              : input.sortBy === 'losses'
                ? orderDir(lossesExpr)
                : input.sortBy === 'winRate'
                  ? orderDir(winRateExpr)
                  : input.sortBy === 'totalMMRChange'
                    ? orderDir(totalMMRChangeExpr)
                    : orderDir(totalGamesExpr)

        const [{ total } = { total: 0 }] = await ctx.db
          .select({
            total: sql<string>`count(distinct ${player_games.opponentId})::int`,
          })
          .from(player_games)
          .where(where)

        const rows = await ctx.db
          .select({
            opponentId: player_games.opponentId,
            opponentName: sql<string>`max(${player_games.opponentName})`,
            totalGames: totalGamesExpr,
            wins: winsExpr,
            losses: lossesExpr,
            totalMMRChange: totalMMRChangeExpr,
            winRate: winRateExpr,
          })
          .from(player_games)
          .where(where)
          .groupBy(player_games.opponentId)
          .orderBy(orderExpr, desc(totalGamesExpr))
          .limit(pageSize)
          .offset(offset)

        const totalNum = Number(total ?? 0)
        const totalPages = Math.max(1, Math.ceil(totalNum / pageSize))

        return { data: rows, page, pageSize, total: totalNum, totalPages }
      }

      const queueId =
        input.gameType === 'ranked'
          ? RANKED_QUEUE_ID
          : input.gameType === 'smallworld'
            ? SMALLWORLD_QUEUE_ID
            : input.gameType === 'vanilla' || input.gameType === 'legacy'
              ? VANILLA_QUEUE_ID
              : input.gameType === 'sandbox'
                ? SANDBOX_QUEUE_ID
                : input.gameType === 'casual'
                  ? CASUAL_QUEUE_ID
                  : undefined

      const matches = await botlatro_service.get_player_matches({
        userId: input.user_id,
        queueId,
        limit: 5000,
      })
      let games = (await normalizeBotlatroMatchHistory(matches)).filter(
        (g) => g.season === input.season
      )
      if (input.result) games = games.filter((g) => g.result === input.result)
      if (input.gameType)
        games = games.filter((g) => g.gameType === input.gameType)

      const map = new Map<
        string,
        {
          opponentId: string
          opponentName: string
          totalGames: number
          wins: number
          losses: number
          totalMMRChange: number
          winRate: number | null
        }
      >()

      for (const g of games) {
        const key = g.opponentId
        const cur = map.get(key) ?? {
          opponentId: g.opponentId,
          opponentName: g.opponentName,
          totalGames: 0,
          wins: 0,
          losses: 0,
          totalMMRChange: 0,
          winRate: null,
        }
        if (g.result !== 'tie') cur.totalGames += 1
        if (g.mmrChange > 0) cur.wins += 1
        else if (g.mmrChange < 0) cur.losses += 1
        cur.totalMMRChange += g.mmrChange
        map.set(key, cur)
      }

      const rows = Array.from(map.values()).map((r) => ({
        ...r,
        winRate: r.totalGames ? (r.wins / r.totalGames) * 100 : null,
      }))

      const dir = input.sortOrder === 'asc' ? 1 : -1
      rows.sort((a, b) => {
        if (input.sortBy === 'totalGames')
          return dir * (a.totalGames - b.totalGames)
        if (input.sortBy === 'wins') return dir * (a.wins - b.wins)
        if (input.sortBy === 'losses') return dir * (a.losses - b.losses)
        if (input.sortBy === 'totalMMRChange')
          return dir * (a.totalMMRChange - b.totalMMRChange)
        if (input.sortBy === 'winRate')
          return dir * ((a.winRate ?? -1) - (b.winRate ?? -1))
        return dir * a.opponentName.localeCompare(b.opponentName)
      })

      const total = rows.length
      const totalPages = Math.max(1, Math.ceil(total / pageSize))
      const pageRows = rows.slice(offset, offset + pageSize)

      return { data: pageRows, page, pageSize, total, totalPages }
    }),
})

async function normalizeBotlatroMatchHistory(
  matches: PlayerMatch[]
): Promise<SelectGames[]> {
  return (
    await Promise.all(
      matches.map(async (match): Promise<SelectGames | null> => {
        const opp = match.opponents[0]
        if (!opp) return null
        return {
          playerId: match.player_id,
          queueId: match.queue_id.toString(),
          playerName: match.player_name,
          gameId: match.match_id,
          gameTime: new Date(match.created_at),
          gameType: getGameType(match.queue_id.toString()),
          gameNum: match.match_id,
          playerMmr: match.mmr_after,
          mmrChange: match.elo_change,
          opponentId: opp.user_id,
          opponentName: opp.name,
          opponentMmr: opp.mmr_after,
          deck: match.deck,
          stake: match.stake,
          result: match.won ? 'win' : 'loss',
          season: await getSeasonForDate(new Date(match.created_at)),
        }
      })
    )
  ).filter((x): x is SelectGames => x !== null)
}

function getGameType(queue_id: string) {
  switch (queue_id) {
    case RANKED_QUEUE_ID:
      return 'ranked'
    case SMALLWORLD_QUEUE_ID:
      return 'smallworld'
    case VANILLA_QUEUE_ID:
      return 'vanilla'
    case LEGACY_QUEUE_ID:
      return 'legacy'
    case SANDBOX_QUEUE_ID:
      return 'sandbox'
    case CASUAL_QUEUE_ID:
      return 'casual'
    default:
      return 'unknown'
  }
}
