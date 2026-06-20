'use client'

import { useQuery } from '@tanstack/react-query'
import { useParams } from 'next/navigation'
import { apiFetch } from '@/lib/api'
import {
  LEADERBOARD_CATEGORIES,
  formatMetric,
  gameModeKey,
} from '@/lib/leaderboards'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

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
  seasonBest: number | null
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
  })),
)

export default function PlayerPage() {
  const params = useParams()
  const id = typeof params.id === 'string' ? params.id : (params.id?.[0] ?? '')

  const { data: seasonsData } = useQuery<SeasonsResponse>({
    queryKey: ['seasons'],
    queryFn: () => apiFetch('/stats/seasons'),
  })

  const currentSeason = seasonsData?.current ?? null

  const queries = BOARDS.map((b) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks -- BOARDS is a stable, constant-length list
    useQuery<PlayerProfile>({
      queryKey: ['player', id, b.modId, b.modeId, currentSeason],
      queryFn: () =>
        apiFetch(
          `/stats/players/${id}?modId=${encodeURIComponent(b.modId)}&gameMode=${encodeURIComponent(b.gameMode)}${currentSeason != null ? `&season=${currentSeason}` : ''}`,
        ),
      enabled: !!id,
    }),
  )

  const results = BOARDS.map((b, i) => ({ board: b, data: queries[i]!.data }))
  const player = results.find((r) => r.data)?.data
  const isPending = queries.every((q) => q.isPending)

  const displayName = player?.displayName ?? player?.steamName ?? '…'
  const initials = displayName.slice(0, 2).toUpperCase()

  const winTotal = results.reduce((sum, r) => sum + (r.data?.wins ?? 0), 0)
  const lossTotal = results.reduce((sum, r) => sum + (r.data?.losses ?? 0), 0)
  const total = winTotal + lossTotal
  const winPct = total > 0 ? Math.round((winTotal / total) * 100) : null

  if (isPending) {
    return (
      <div className='container py-8'>
        <p className='text-muted-foreground'>Loading player…</p>
      </div>
    )
  }

  if (!player) {
    return (
      <div className='container py-8'>
        <h1 className='text-2xl font-bold'>Player not found</h1>
      </div>
    )
  }

  return (
    <div className='container py-8 space-y-6'>
      {/* Header */}
      <div className='flex items-center gap-4'>
        <div className='flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-card border border-border text-xl font-black'>
          {initials}
        </div>
        <div>
          <h1 className='text-2xl font-black tracking-tight'>{displayName}</h1>
          {player.steamName !== displayName && (
            <p className='text-sm text-muted-foreground'>Steam: {player.steamName}</p>
          )}
          <p className='text-xs text-muted-foreground'>
            Joined {new Date(player.createdAt).toLocaleDateString()}
          </p>
        </div>
      </div>

      {/* W/L bar */}
      {total > 0 && (
        <div className='space-y-1'>
          <div className='flex justify-between text-xs text-muted-foreground'>
            <span className='text-green-400'>{winTotal}W</span>
            <span className='font-semibold'>{winPct}% win rate</span>
            <span className='text-red-400'>{lossTotal}L</span>
          </div>
          <div className='h-2 overflow-hidden rounded-full bg-red-500/30'>
            <div
              className='h-full rounded-full bg-green-500 transition-all'
              style={{ width: `${winPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Per-category, per-mode stats */}
      {LEADERBOARD_CATEGORIES.map((category) => (
        <div key={category.id} className='space-y-3'>
          <h2 className='text-lg font-bold tracking-tight'>{category.label}</h2>
          <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4'>
            {category.modes.map((m) => {
              const data = results.find(
                (r) => r.board.modId === category.modId && r.board.modeId === m.id,
              )?.data
              return (
                <Card key={m.id}>
                  <CardHeader className='pb-2'>
                    <CardTitle className='text-sm'>{m.label}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    {data?.rank ? (
                      <dl className='space-y-2 text-sm'>
                        <StatRow label='Rank' value={`#${data.rank}`} />
                        <StatRow label='Rating' value={Math.round(data.rating ?? 0).toString()} />
                        <StatRow label='W / L' value={`${data.wins ?? 0} / ${data.losses ?? 0}`} />
                        <StatRow label='Games' value={String(data.gamesPlayed ?? 0)} />
                        {data.seasonBest != null && (
                          <StatRow
                            label={category.metricLabel}
                            value={formatMetric(category.metric, data.seasonBest)}
                          />
                        )}
                      </dl>
                    ) : (
                      <p className='text-xs text-muted-foreground'>No ranked data this season.</p>
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      ))}

      {/* TODO(API): needs endpoint — GET /api/stats/players/:id/mmr-history */}
      <ComingSoon title='MMR Trend' desc='Rating history chart over the season.' />

      {/* TODO(API): needs endpoint — GET /api/stats/players/:id/matches */}
      <ComingSoon title='Match History' desc='Recent match results and details.' />
    </div>
  )
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className='flex justify-between'>
      <dt className='text-muted-foreground'>{label}</dt>
      <dd className='font-semibold'>{value}</dd>
    </div>
  )
}

function ComingSoon({ title, desc }: { title: string; desc: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-muted-foreground'>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className='flex flex-col items-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 py-8 px-6 text-center'>
          <span className='text-sm font-semibold text-yellow-400'>Coming Soon</span>
          <span className='text-xs text-muted-foreground'>{desc}</span>
        </div>
      </CardContent>
    </Card>
  )
}
