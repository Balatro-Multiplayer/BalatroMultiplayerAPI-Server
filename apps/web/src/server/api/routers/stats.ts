import { and, gte, lt, sql } from 'drizzle-orm'
import { z } from 'zod'
import { createTRPCRouter, publicProcedure } from '@/server/api/trpc'
import { player_games } from '@/server/db/schema'
import {
  getActiveSeasonNumber,
  getSeasonDateRange as getConfiguredSeasonDateRange,
  getSeasonConfig,
  getSeasonKey,
  getSeasons,
} from '@/server/seasons'
import {
  fetchMatches,
  type OverallMatch,
  QUEUE_IDS,
} from '@/server/services/match-fetcher'
import {
  SEASON_5_START_DATE,
  SEASON_6_START_DATE,
  type Season,
  SeasonSchema,
} from '@/shared/seasons'

function aggregateDeckStats(matches: { deck: string | null }[]) {
  const counts: Record<string, number> = {}
  let total = 0
  for (const m of matches) {
    if (!m.deck) continue
    let deck = m.deck.replace('Deck', '').trim().toLowerCase()
    if (!deck || deck === 'unknown') continue
    // Normalize verbose cocktail variants to their short name
    deck = deck.replace(/\s*~.*$/, '')
    counts[deck] = (counts[deck] ?? 0) + 1
    total++
  }
  return Object.entries(counts)
    .map(([deck, games]) => ({
      deck,
      games,
      pickRate: total > 0 ? Math.round((games / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.games - a.games)
}

function aggregateStakeStats(matches: { stake: string | null }[]) {
  const counts: Record<string, number> = {}
  let total = 0
  for (const m of matches) {
    if (!m.stake) continue
    const stake = m.stake.replace('Stake', '').trim().toLowerCase()
    if (!stake || stake === 'unknown') continue
    counts[stake] = (counts[stake] ?? 0) + 1
    total++
  }
  return Object.entries(counts)
    .map(([stake, games]) => ({
      stake,
      games,
      pickRate: total > 0 ? Math.round((games / total) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.games - a.games)
}

function aggregateSeasonOverview(matches: OverallMatch[]) {
  const uniquePlayers = new Set<string>()
  let totalEloChanges = 0
  let eloCount = 0
  for (const m of matches) {
    for (const p of m.players) {
      uniquePlayers.add(p.user_id)
      if (p.elo_change != null) {
        totalEloChanges += Math.abs(p.elo_change)
        eloCount++
      }
    }
  }
  return {
    totalGames: matches.length,
    uniquePlayers: uniquePlayers.size,
    avgMmrChange:
      eloCount > 0 ? Math.round((totalEloChanges / eloCount) * 10) / 10 : 0,
  }
}

function parseInputDate(value?: string): Date | undefined {
  if (!value) return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date
}

async function resolveSeason(season?: Season): Promise<Season> {
  if (season) return season

  const activeSeasonNumber = await getActiveSeasonNumber()
  return getSeasonKey(activeSeasonNumber)
}

async function shouldUseDbSeason(season: Season): Promise<boolean> {
  const config = await getSeasonConfig(season)
  return Boolean(config?.endDate && config.endDate <= SEASON_5_START_DATE)
}

function getApiSeasonsForDateRange(
  startDate?: Date,
  endExclusive?: Date
): Season[] {
  const seasons: Season[] = []

  if (
    (!endExclusive || endExclusive > SEASON_5_START_DATE) &&
    (!startDate || startDate < SEASON_6_START_DATE)
  ) {
    seasons.push('season5')
  }

  if (!endExclusive || endExclusive > SEASON_6_START_DATE) {
    seasons.push('season6')
  }

  return seasons
}

async function fetchApiMatchesForDateRange(
  queueIds: string[],
  startDate?: Date,
  endExclusive?: Date
) {
  const seasons = getApiSeasonsForDateRange(startDate, endExclusive)
  if (seasons.length === 0) return []

  const matches = (
    await Promise.all(
      queueIds.flatMap((queueId) =>
        seasons.map((season) => fetchMatches(queueId, season))
      )
    )
  ).flat()

  return matches.filter((match) => {
    const createdAt = new Date(match.created_at)
    if (startDate && createdAt < startDate) return false
    if (endExclusive && createdAt >= endExclusive) return false
    return true
  })
}

export const stats_router = createTRPCRouter({
  deck_popularity: publicProcedure
    .input(
      z
        .object({
          mode: z.enum(['season', 'dateRange']).optional(),
          season: SeasonSchema.optional(),
          startDate: z.string().optional(),
          endDate: z.string().optional(),
          queueId: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const mode = input?.mode ?? 'season'

      if (mode === 'season') {
        const season = await resolveSeason(input?.season)

        if (await shouldUseDbSeason(season)) {
          const { start, end } = await getConfiguredSeasonDateRange(season)
          const conditions = [
            gte(player_games.gameTime, start),
            lt(player_games.gameTime, end),
          ]
          if (input?.queueId)
            conditions.push(sql`${player_games.queueId} = ${input.queueId}`)
          const rows = await ctx.db
            .select({ deck: player_games.deck })
            .from(player_games)
            .where(and(...conditions))
          return aggregateDeckStats(rows)
        }

        const queueIds = input?.queueId ? [input.queueId] : QUEUE_IDS
        const allMatches = (
          await Promise.all(queueIds.map((q) => fetchMatches(q, season)))
        ).flat()
        return aggregateDeckStats(allMatches)
      }

      const startDate = parseInputDate(input?.startDate)
      const endDate = parseInputDate(input?.endDate)
      const endExclusive = endDate ? new Date(endDate) : undefined
      if (endExclusive) endExclusive.setDate(endExclusive.getDate() + 1)

      const effectiveEnd = endExclusive ?? new Date()
      const needsDb = !startDate || startDate < SEASON_5_START_DATE
      const needsApi = !endExclusive || effectiveEnd > SEASON_5_START_DATE
      const rows: Array<{ deck: string | null }> = []

      if (needsDb) {
        const dbEnd =
          endExclusive && endExclusive < SEASON_5_START_DATE
            ? endExclusive
            : SEASON_5_START_DATE
        const conditions = [lt(player_games.gameTime, dbEnd)]
        if (startDate) conditions.push(gte(player_games.gameTime, startDate))
        if (input?.queueId)
          conditions.push(sql`${player_games.queueId} = ${input.queueId}`)
        const dbRows = await ctx.db
          .select({ deck: player_games.deck })
          .from(player_games)
          .where(and(...conditions))
        for (const row of dbRows) rows.push(row)
      }

      if (needsApi) {
        const queueIds = input?.queueId ? [input.queueId] : QUEUE_IDS
        const allMatches = await fetchApiMatchesForDateRange(
          queueIds,
          startDate && startDate > SEASON_5_START_DATE
            ? startDate
            : SEASON_5_START_DATE,
          endExclusive
        )

        for (const match of allMatches) {
          rows.push({ deck: match.deck })
        }
      }

      return aggregateDeckStats(rows)
    }),

  stake_popularity: publicProcedure
    .input(
      z
        .object({
          mode: z.enum(['season', 'dateRange']).optional(),
          season: SeasonSchema.optional(),
          startDate: z.string().optional(),
          endDate: z.string().optional(),
          queueId: z.string().optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const mode = input?.mode ?? 'season'

      if (mode === 'season') {
        const season = await resolveSeason(input?.season)

        if (await shouldUseDbSeason(season)) {
          const { start, end } = await getConfiguredSeasonDateRange(season)
          const conditions = [
            gte(player_games.gameTime, start),
            lt(player_games.gameTime, end),
          ]
          if (input?.queueId)
            conditions.push(sql`${player_games.queueId} = ${input.queueId}`)
          const rows = await ctx.db
            .select({ stake: player_games.stake })
            .from(player_games)
            .where(and(...conditions))
          return aggregateStakeStats(rows)
        }

        const queueIds = input?.queueId ? [input.queueId] : QUEUE_IDS
        const allMatches = (
          await Promise.all(queueIds.map((q) => fetchMatches(q, season)))
        ).flat()
        return aggregateStakeStats(allMatches)
      }

      const startDate = parseInputDate(input?.startDate)
      const endDate = parseInputDate(input?.endDate)
      const endExclusive = endDate ? new Date(endDate) : undefined
      if (endExclusive) endExclusive.setDate(endExclusive.getDate() + 1)

      const effectiveEnd = endExclusive ?? new Date()
      const needsDb = !startDate || startDate < SEASON_5_START_DATE
      const needsApi = !endExclusive || effectiveEnd > SEASON_5_START_DATE
      const rows: Array<{ stake: string | null }> = []

      if (needsDb) {
        const dbEnd =
          endExclusive && endExclusive < SEASON_5_START_DATE
            ? endExclusive
            : SEASON_5_START_DATE
        const conditions = [lt(player_games.gameTime, dbEnd)]
        if (startDate) conditions.push(gte(player_games.gameTime, startDate))
        if (input?.queueId)
          conditions.push(sql`${player_games.queueId} = ${input.queueId}`)
        const dbRows = await ctx.db
          .select({ stake: player_games.stake })
          .from(player_games)
          .where(and(...conditions))
        for (const row of dbRows) rows.push(row)
      }

      if (needsApi) {
        const queueIds = input?.queueId ? [input.queueId] : QUEUE_IDS
        const allMatches = await fetchApiMatchesForDateRange(
          queueIds,
          startDate && startDate > SEASON_5_START_DATE
            ? startDate
            : SEASON_5_START_DATE,
          endExclusive
        )

        for (const match of allMatches) {
          rows.push({ stake: match.stake })
        }
      }

      return aggregateStakeStats(rows)
    }),

  season_overview: publicProcedure.query(async ({ ctx }) => {
    const allSeasons = await getSeasons()
    const dbSeasons = allSeasons.filter(
      (season) => season.endDate && season.endDate <= SEASON_5_START_DATE
    )
    const apiSeasons = allSeasons.filter(
      (season) => !season.endDate || season.endDate > SEASON_5_START_DATE
    )

    const dbResults = await Promise.all(
      dbSeasons.map(async (season) => {
        const rows = await ctx.db
          .select({
            totalGames: sql<string>`count(distinct ${player_games.gameNum})::int`,
            uniquePlayers: sql<string>`count(distinct ${player_games.playerId})::int`,
            avgMmrChange: sql<string>`coalesce(avg(abs(${player_games.mmrChange})), 0)`,
          })
          .from(player_games)
          .where(
            and(
              gte(player_games.gameTime, season.startDate),
              lt(player_games.gameTime, season.endDate as Date)
            )
          )

        const row = rows[0] ?? {
          totalGames: '0',
          uniquePlayers: '0',
          avgMmrChange: '0',
        }
        return {
          season: getSeasonKey(season.id),
          totalGames: Number(row.totalGames),
          uniquePlayers: Number(row.uniquePlayers),
          avgMmrChange: Math.round(Number(row.avgMmrChange) * 10) / 10,
        }
      })
    )

    const apiResults = await Promise.all(
      apiSeasons.map(async (season) => {
        const matches = (
          await Promise.all(
            QUEUE_IDS.map((queueId) =>
              fetchMatches(queueId, getSeasonKey(season.id))
            )
          )
        ).flat()

        return {
          season: getSeasonKey(season.id),
          ...aggregateSeasonOverview(matches),
        }
      })
    )

    return [...dbResults, ...apiResults]
  }),
})
