'use client'

import { useQueries, useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { useState } from 'react'
import {
  EmptyLine,
  KeyValues,
  MainAndSide,
  PageHeader,
  PageShell,
  SideCard,
  TabCard,
} from '@/components/page-kit'
import { Badge } from '@/components/ui/badge'
import { apiFetch } from '@/lib/api'
import {
  formatMetric,
  gameModeKey,
  LEADERBOARD_CATEGORIES,
} from '@/lib/leaderboards'

interface PlayerProfile {
  playerId: string
  displayName: string
  steamName: string
  preferredJoker: string | null
  createdAt: string
  season: number
  rank: number | null
  rating: number | null
  wins: number | null
  losses: number | null
  gamesPlayed: number | null
  seasonBest: number | string | null
}

interface SeasonsResponse {
  seasons: { id: number; name: string }[]
  current: number | null
}

// Flatten the taxonomy into one board per (category, mode) — stable order, so
// the per-board useQuery calls below satisfy the rules of hooks.
const BOARDS = LEADERBOARD_CATEGORIES.flatMap((c) =>
  c.modes.map((m) => ({
    categoryId: c.id,
    categoryLabel: c.label,
    modId: c.modId,
    metric: c.metric,
    modeId: m.id,
    modeLabel: m.label,
    gameMode: gameModeKey(m.id),
  }))
)

export default function PlayerPage() {
  const params = useParams()
  const id = typeof params.id === 'string' ? params.id : (params.id?.[0] ?? '')

  const { data: seasonsData } = useQuery<SeasonsResponse>({
    queryKey: ['seasons'],
    queryFn: () => apiFetch('/stats/seasons'),
  })

  const currentSeason = seasonsData?.current ?? null

  const queries = useQueries({
    queries: BOARDS.map((b) => ({
      queryKey: ['player', id, b.modId, b.modeId, currentSeason],
      queryFn: () =>
        apiFetch<PlayerProfile>(
          `/stats/players/${id}?modId=${encodeURIComponent(b.modId)}&gameMode=${encodeURIComponent(b.gameMode)}${currentSeason != null ? `&season=${currentSeason}` : ''}`
        ),
      enabled: !!id,
    })),
  })

  const results = BOARDS.map((b, i) => ({ board: b, data: queries[i]?.data }))
  const player = results.find((r) => r.data)?.data
  const isPending = queries.every((q) => q.isPending)

  const displayName = player?.displayName ?? player?.steamName ?? '...'
  const [tab, setTab] = useState<string | null>(null)

  const ranked = results.filter((r) => r.data?.rank)
  const winTotal = ranked.reduce((sum, r) => sum + (r.data?.wins ?? 0), 0)
  const lossTotal = ranked.reduce((sum, r) => sum + (r.data?.losses ?? 0), 0)
  const gameTotal = ranked.reduce(
    (sum, r) => sum + (r.data?.gamesPlayed ?? 0),
    0
  )
  const total = winTotal + lossTotal
  const winPct = total > 0 ? Math.round((winTotal / total) * 100) : null
  const best = ranked.reduce<(typeof ranked)[number] | null>(
    (b, r) => (!b || (r.data?.rank ?? 1e9) < (b.data?.rank ?? 1e9) ? r : b),
    null
  )

  if (isPending) {
    return (
      <PageShell>
        <EmptyLine>Loading player...</EmptyLine>
      </PageShell>
    )
  }

  if (!player) {
    return (
      <PageShell>
        <PageHeader title='Player not found' />
      </PageShell>
    )
  }

  const tabs = LEADERBOARD_CATEGORIES.map((c) => ({
    key: c.id,
    label: c.label,
    count: ranked.filter((r) => r.board.categoryId === c.id).length,
  }))
  const firstWithData = tabs.find((t) => t.count > 0)?.key ?? tabs[0]?.key ?? ''
  const current = tab ?? firstWithData
  const category = LEADERBOARD_CATEGORIES.find((c) => c.id === current)
  const rows = ranked.filter((r) => r.board.categoryId === current)

  return (
    <PageShell>
      <PageHeader
        title={displayName}
        badges={
          best?.data?.rank ? (
            <Badge variant='secondary'>
              Best rank #{best.data.rank} in {best.board.modeLabel}
            </Badge>
          ) : (
            <Badge variant='outline'>Unranked</Badge>
          )
        }
        meta={
          player.steamName !== displayName
            ? `Steam name: ${player.steamName}`
            : undefined
        }
      />
      <MainAndSide
        main={
          <TabCard tabs={tabs} current={current} onChange={setTab}>
            {rows.length === 0 ? (
              <EmptyLine>
                {displayName} has no ranked games in {category?.label} this
                season.
              </EmptyLine>
            ) : (
              <ul className='divide-y divide-border'>
                {rows.map(({ board, data }) => (
                  <li
                    key={board.modeId}
                    className='flex flex-wrap items-center gap-x-6 gap-y-1 py-3'
                  >
                    <div className='min-w-32 flex-1'>
                      <div className='font-medium'>{board.modeLabel}</div>
                      <div className='text-muted-foreground text-xs'>
                        {data?.wins ?? 0} wins, {data?.losses ?? 0} losses,{' '}
                        {data?.gamesPlayed ?? 0} games
                      </div>
                    </div>
                    {data?.seasonBest != null && (
                      <div className='text-right text-sm'>
                        <div className='text-muted-foreground text-xs'>
                          {category?.metricLabel}
                        </div>
                        {formatMetric(board.metric, data.seasonBest)}
                      </div>
                    )}
                    <div className='text-right'>
                      <div className='font-pixel text-2xl text-bal-gold'>
                        {Math.round(data?.rating ?? 0)}
                      </div>
                      <div className='text-muted-foreground text-xs'>
                        Rank #{data?.rank}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </TabCard>
        }
        side={
          <>
            <SideCard title='Overview'>
              <KeyValues
                rows={[
                  ['Joined', new Date(player.createdAt).toLocaleDateString()],
                  ['Season', String(player.season)],
                  ['Ranked boards', String(ranked.length)],
                  ['Ranked games', String(gameTotal)],
                ]}
              />
            </SideCard>
            {total > 0 && (
              <SideCard title='Record'>
                <div className='flex justify-between text-sm'>
                  <span className='text-bal-green'>{winTotal} wins</span>
                  <span className='font-semibold'>{winPct}%</span>
                  <span className='text-bal-red'>{lossTotal} losses</span>
                </div>
                <div className='h-2 overflow-hidden rounded-full bg-bal-red/30'>
                  <div
                    className='h-full rounded-full bg-bal-green'
                    style={{ width: `${winPct}%` }}
                  />
                </div>
              </SideCard>
            )}
          </>
        }
      />
    </PageShell>
  )
}
