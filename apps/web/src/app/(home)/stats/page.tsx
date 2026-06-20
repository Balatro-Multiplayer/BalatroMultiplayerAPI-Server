'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { gameModeKey } from '@/lib/leaderboards'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// Homepage spotlight board: Speedrun — Gold Stake Single.
const SPOTLIGHT = {
  modId: 'MultiplayerSpeedrunning',
  gameMode: gameModeKey('spdrn_gold_stake_single'),
  label: 'Speedrun · Gold Stake Single',
}

interface GlobalStats {
  activePlayers: number
  totalMatches: number
  uniquePlayers: number
}

interface LeaderboardEntry {
  rank: number
  playerId: string
  displayName: string
  rating: number
  wins: number
  losses: number
  gamesPlayed: number
}

interface LeaderboardResponse {
  entries: LeaderboardEntry[]
  season: number
}

interface SeasonsResponse {
  seasons: { id: number; name: string }[]
  current: number | null
}

export default function StatsPage() {
  const { data: stats } = useQuery<GlobalStats>({
    queryKey: ['global-stats'],
    queryFn: () => apiFetch('/stats'),
    refetchInterval: 30_000,
  })

  const { data: seasonsData } = useQuery<SeasonsResponse>({
    queryKey: ['seasons'],
    queryFn: () => apiFetch('/stats/seasons'),
  })

  const currentSeason = seasonsData?.current

  const { data: leaderboardData } = useQuery<LeaderboardResponse>({
    queryKey: ['stats-leaderboard', currentSeason],
    queryFn: () =>
      apiFetch(
        `/stats/leaderboard?modId=${encodeURIComponent(SPOTLIGHT.modId)}&gameMode=${encodeURIComponent(SPOTLIGHT.gameMode)}${currentSeason != null ? `&season=${currentSeason}` : ''}`,
      ),
    enabled: currentSeason != null,
  })

  const top10 = leaderboardData?.entries.slice(0, 10) ?? []

  return (
    <div className='container py-8 space-y-8'>
      <div className='space-y-1'>
        <h1 className='text-3xl font-bold tracking-tight'>Statistics</h1>
        <p className='text-muted-foreground'>Global statistics for Balatro Multiplayer.</p>
      </div>

      {/* Global counters */}
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
        <StatCard label='Total Matches' value={stats?.totalMatches} color='text-blue-400' />
        <StatCard label='Unique Players' value={stats?.uniquePlayers} color='text-green-400' />
        <StatCard label='Active Players' value={stats?.activePlayers} color='text-primary' />
      </div>

      {/* Top 10 */}
      <Card>
        <CardHeader>
          <CardTitle>Top 10 — {SPOTLIGHT.label} · Season {currentSeason ?? '…'}</CardTitle>
        </CardHeader>
        <CardContent className='p-0'>
          {top10.length === 0 ? (
            <p className='p-6 text-sm text-muted-foreground'>Loading…</p>
          ) : (
            <div className='overflow-x-auto'>
              <table className='w-full text-sm'>
                <thead>
                  <tr className='border-b border-border bg-muted/40'>
                    {['Rank', 'Player', 'Rating', 'W', 'L'].map((h) => (
                      <th key={h} className='px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className='divide-y divide-border'>
                  {top10.map((e) => (
                    <tr key={e.playerId} className='hover:bg-muted/30 transition-colors'>
                      <td className={`px-4 py-3 font-bold ${rankClass(e.rank)}`}>#{e.rank}</td>
                      <td className='px-4 py-3 font-semibold'>
                        <a href={`/players/${e.playerId}`} className='hover:text-primary transition-colors'>{e.displayName}</a>
                      </td>
                      <td className='px-4 py-3 font-bold text-yellow-400'>{Math.round(e.rating)}</td>
                      <td className='px-4 py-3 text-green-400'>{e.wins}</td>
                      <td className='px-4 py-3 text-red-400'>{e.losses}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* TODO(API): needs endpoint — GET /api/stats/deck-popularity */}
      <ComingSoon title='Deck Popularity' desc='Shows which decks are most commonly used in ranked matches.' />

      {/* TODO(API): needs endpoint — GET /api/stats/stake-popularity */}
      <ComingSoon title='Stake Popularity' desc='Breakdown of stake levels chosen in ranked matches.' />

      {/* TODO(API): needs endpoint — GET /api/stats/activity (games-per-hour) */}
      <ComingSoon title='Activity Chart' desc='Games played per hour over the last 7 days.' />

      {/* TODO(API): needs endpoint — GET /api/stats/season-overview */}
      <ComingSoon title='Season Overview' desc='Summary statistics for each completed season.' />

      {/* TODO(API): needs endpoint — GET /api/stats/history */}
      <ComingSoon title='Match History' desc='Browseable log of recent ranked matches.' />
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number | undefined; color: string }) {
  return (
    <Card>
      <CardContent className='pt-6 text-center'>
        <div className={`text-4xl font-black ${color}`}>
          {value !== undefined ? value.toLocaleString() : '—'}
        </div>
        <div className='mt-1.5 text-xs uppercase tracking-wider text-muted-foreground'>{label}</div>
      </CardContent>
    </Card>
  )
}

function ComingSoon({ title, desc }: { title: string; desc: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className='text-muted-foreground'>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className='flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/20 py-8 px-6 text-center'>
          <span className='text-sm font-semibold text-yellow-400'>Coming Soon</span>
          <span className='text-xs text-muted-foreground'>{desc}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function rankClass(rank: number) {
  if (rank === 1) return 'text-yellow-400'
  if (rank === 2) return 'text-slate-300'
  if (rank === 3) return 'text-amber-500'
  return 'text-muted-foreground'
}
