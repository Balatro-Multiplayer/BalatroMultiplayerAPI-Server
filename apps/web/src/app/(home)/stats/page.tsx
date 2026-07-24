'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { gameModeKey } from '@/lib/leaderboards'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

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

interface ActivityResponse {
  buckets: { hour: string; count: number }[]
}

interface SeasonOverviewResponse {
  seasons: {
    id: number
    name: string
    startedAt: string
    endsAt: string
    endedAt: string | null
    totalMatches: number
    rankedPlayers: number
  }[]
}

interface MatchHistoryResponse {
  matches: {
    matchId: string
    modId: string
    gameMode: string
    status: string
    createdAt: string
    gameStartedAt: string | null
  }[]
}

interface StakePopularityResponse {
  buckets: Record<string, number>
  coarse: boolean
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

  const { data: activityData } = useQuery<ActivityResponse>({
    queryKey: ['stats-activity'],
    queryFn: () => apiFetch('/stats/activity'),
    refetchInterval: 5 * 60_000,
  })

  const { data: seasonOverviewData } = useQuery<SeasonOverviewResponse>({
    queryKey: ['stats-season-overview'],
    queryFn: () => apiFetch('/stats/season-overview'),
  })

  const { data: historyData } = useQuery<MatchHistoryResponse>({
    queryKey: ['stats-history'],
    queryFn: () => apiFetch('/stats/history?limit=20'),
    refetchInterval: 60_000,
  })

  const { data: stakeData } = useQuery<StakePopularityResponse>({
    queryKey: ['stats-stake-popularity'],
    queryFn: () => apiFetch('/stats/stake-popularity'),
  })

  return (
    <div className='container py-8 space-y-8'>
      <div className='space-y-1'>
        <h1 className='text-3xl font-bold tracking-tight'>Statistics</h1>
        <p className='text-muted-foreground'>Global statistics for Balatro Multiplayer.</p>
      </div>

      {/* Global counters */}
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
        <StatCard label='Total Matches' value={stats?.totalMatches} color='text-bal-blue' />
        <StatCard label='Unique Players' value={stats?.uniquePlayers} color='text-bal-green' />
        <StatCard label='Active Players' value={stats?.activePlayers} color='text-primary' />
      </div>

      {/* Top 10 */}
      <Card>
        <CardHeader>
          <CardTitle>Top 10 · {SPOTLIGHT.label} · Season {currentSeason ?? '…'}</CardTitle>
        </CardHeader>
        <CardContent className='p-0'>
          {top10.length === 0 ? (
            <p className='p-6 text-sm text-muted-foreground'>Loading…</p>
          ) : (
            <div className='overflow-x-auto'>
              <table className='w-full text-sm font-readable'>
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
                      <td className='px-4 py-3 font-bold text-bal-gold'>{Math.round(e.rating)}</td>
                      <td className='px-4 py-3 text-bal-green'>{e.wins}</td>
                      <td className='px-4 py-3 text-bal-red'>{e.losses}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Deck Popularity: genuinely blocked, not a placeholder oversight -- no schema
          anywhere records which deck an individual match was played on (deck/stake
          drafting is client-side Lua only, §16.4). Needs a match-creation-time schema
          addition, out of scope for this pass -- see AUTONOMOUS_DECISIONS.md. */}
      <ComingSoon title='Deck Popularity' desc='Shows which decks are most commonly used in ranked matches.' />

      <StakePopularityCard data={stakeData} />
      <ActivityChartCard data={activityData} />
      <SeasonOverviewCard data={seasonOverviewData} />
      <MatchHistoryCard data={historyData} />
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number | undefined; color: string }) {
  return (
    <Card>
      <CardContent className='pt-6 text-center'>
        <div className={`text-4xl font-black ${color}`}>
          {value !== undefined ? value.toLocaleString() : '-'}
        </div>
        <div className='mt-1.5 text-xs uppercase tracking-wider text-muted-foreground'>{label}</div>
      </CardContent>
    </Card>
  )
}

function StakePopularityCard({ data }: { data: StakePopularityResponse | undefined }) {
  const entries = data ? Object.entries(data.buckets) : []
  const total = entries.reduce((sum, [, count]) => sum + count, 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stake Popularity</CardTitle>
      </CardHeader>
      <CardContent className='space-y-3'>
        {total === 0 ? (
          <p className='text-sm text-muted-foreground'>No matches yet.</p>
        ) : (
          <div className='space-y-2'>
            {entries.map(([label, count]) => (
              <div key={label} className='space-y-1'>
                <div className='flex justify-between text-sm'>
                  <span>{label}</span>
                  <span className='text-muted-foreground'>{count.toLocaleString()}</span>
                </div>
                <div className='h-2 w-full overflow-hidden rounded-full bg-muted'>
                  <div
                    className='h-full rounded-full bg-primary'
                    style={{ width: `${total > 0 ? (count / total) * 100 : 0}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
        <p className='text-xs text-muted-foreground'>
          Only Speedrunning's two fixed-stake formats (White Stake Triple, Gold Stake Single) are
          currently tracked by format — everything else (variable-stake formats, PvP) falls under
          "Other" since individual match stake choices aren't recorded server-side yet.
        </p>
      </CardContent>
    </Card>
  )
}

function ActivityChartCard({ data }: { data: ActivityResponse | undefined }) {
  const buckets = data?.buckets ?? []
  const max = Math.max(1, ...buckets.map((b) => b.count))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>Matches formed per hour, last 7 days.</CardDescription>
      </CardHeader>
      <CardContent>
        {buckets.length === 0 ? (
          <p className='text-sm text-muted-foreground'>No recent activity.</p>
        ) : (
          <div className='flex h-32 items-end gap-px'>
            {buckets.map((b) => (
              <div
                key={b.hour}
                title={`${new Date(b.hour).toLocaleString()}: ${b.count}`}
                className='flex-1 rounded-t bg-primary/70 transition-colors hover:bg-primary'
                style={{ height: `${Math.max(2, (b.count / max) * 100)}%` }}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SeasonOverviewCard({ data }: { data: SeasonOverviewResponse | undefined }) {
  const seasons = data?.seasons ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Season Overview</CardTitle>
      </CardHeader>
      <CardContent className='p-0'>
        {seasons.length === 0 ? (
          <p className='p-6 text-sm text-muted-foreground'>No seasons yet.</p>
        ) : (
          <div className='overflow-x-auto'>
            <table className='w-full text-sm font-readable'>
              <thead>
                <tr className='border-b border-border bg-muted/40'>
                  {['Season', 'Started', 'Ends', 'Matches', 'Ranked Players'].map((h) => (
                    <th key={h} className='px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className='divide-y divide-border'>
                {seasons.map((s) => (
                  <tr key={s.id} className='hover:bg-muted/30 transition-colors'>
                    <td className='px-4 py-3 font-semibold'>{s.name}</td>
                    <td className='px-4 py-3 text-muted-foreground'>{new Date(s.startedAt).toLocaleDateString()}</td>
                    <td className='px-4 py-3 text-muted-foreground'>
                      {s.endedAt ? new Date(s.endedAt).toLocaleDateString() : new Date(s.endsAt).toLocaleDateString()}
                    </td>
                    <td className='px-4 py-3'>{s.totalMatches.toLocaleString()}</td>
                    <td className='px-4 py-3'>{s.rankedPlayers.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function MatchHistoryCard({ data }: { data: MatchHistoryResponse | undefined }) {
  const matches = data?.matches ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Match History</CardTitle>
        <CardDescription>Most recent matches across every mod.</CardDescription>
      </CardHeader>
      <CardContent className='p-0'>
        {matches.length === 0 ? (
          <p className='p-6 text-sm text-muted-foreground'>No matches yet.</p>
        ) : (
          <div className='overflow-x-auto'>
            <table className='w-full text-sm font-readable'>
              <thead>
                <tr className='border-b border-border bg-muted/40'>
                  {['Mod', 'Mode', 'Status', 'Started'].map((h) => (
                    <th key={h} className='px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground'>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className='divide-y divide-border'>
                {matches.map((m) => (
                  <tr key={m.matchId} className='hover:bg-muted/30 transition-colors'>
                    <td className='px-4 py-3'>{m.modId}</td>
                    <td className='px-4 py-3 font-mono text-xs'>{m.gameMode}</td>
                    <td className='px-4 py-3 text-muted-foreground'>{m.status}</td>
                    <td className='px-4 py-3 text-muted-foreground'>{new Date(m.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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
          <span className='text-sm font-semibold text-bal-gold'>Coming Soon</span>
          <span className='text-xs text-muted-foreground'>{desc}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function rankClass(rank: number) {
  if (rank === 1) return 'text-bal-gold'
  if (rank === 2) return 'text-slate-300'
  if (rank === 3) return 'text-bal-orange'
  return 'text-muted-foreground'
}
