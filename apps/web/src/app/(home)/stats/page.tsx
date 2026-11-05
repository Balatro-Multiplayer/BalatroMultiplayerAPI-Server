'use client'

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { QueueStatsResponse } from '@bmp/types'
import { QUEUE_MODS, pillarCounts, type QueueMod } from '@/lib/queue-pillars'

interface GlobalStats {
  // null: the server could not read Nakama's open-socket count.
  onlinePlayers: number | null
  totalMatches: number
  uniquePlayers: number
}

interface ActivityResponse {
  buckets: { hour: string; count: number }[]
}

export default function StatsPage() {
  // Every 15 seconds, like the queue stats: the online count is live.
  const globalStats = useQuery<GlobalStats>({
    queryKey: ['global-stats'],
    queryFn: () => apiFetch('/stats'),
    refetchInterval: 15_000,
  })
  const stats = globalStats.data
  // After a failed fetch the old online count is stale, so show "-".
  const onlinePlayers = globalStats.isError ? null : stats?.onlinePlayers

  const { data: activityData } = useQuery<ActivityResponse>({
    queryKey: ['stats-activity'],
    queryFn: () => apiFetch('/stats/activity'),
    refetchInterval: 5 * 60_000,
  })

  const queueStats = useQuery<QueueStatsResponse>({
    queryKey: ['stats-queues'],
    queryFn: () => apiFetch('/stats/queues'),
    refetchInterval: 15_000,
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
        <StatCard label='Online Players' value={onlinePlayers} color='text-primary' />
      </div>

      {QUEUE_MODS.map((mod) => (
        <QueueStatsCard
          key={mod.modId}
          mod={mod}
          counts={queueStats.data?.[mod.modId]}
          failed={queueStats.isError}
        />
      ))}

      <ActivityChartCard data={activityData} />
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number | null | undefined; color: string }) {
  return (
    <Card>
      <CardContent className='pt-6 text-center'>
        <div className={`font-pixel text-4xl font-black ${color}`}>
          {value != null ? value.toLocaleString() : '-'}
        </div>
        <div className='mt-1.5 text-xs uppercase tracking-wider text-muted-foreground'>{label}</div>
      </CardContent>
    </Card>
  )
}

function QueueStatsCard({
  mod,
  counts,
  failed,
}: {
  mod: QueueMod
  // undefined: still loading; null: Nakama did not answer for this mod.
  counts: QueueStatsResponse[QueueMod['modId']] | undefined
  failed: boolean
}) {
  // failed: the last fetch failed; old counts would be stale, so hide them.
  const unavailable = counts === null || failed

  return (
    <Card>
      <CardHeader>
        <CardTitle>{mod.label} Queues</CardTitle>
        <CardDescription>Players in each Find Game queue and in its games now.</CardDescription>
      </CardHeader>
      <CardContent>
        {unavailable ? (
          <p className='text-sm text-muted-foreground'>Queue stats are unavailable right now.</p>
        ) : (
          <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
            {mod.groups.map((group) => (
              <div key={group.label} className='space-y-2'>
                <h3 className='text-xs uppercase tracking-wider text-muted-foreground'>{group.label}</h3>
                <table className='w-full text-sm'>
                  <thead>
                    <tr className='text-left text-xs text-muted-foreground'>
                      <th className='py-1 font-medium'>Mode</th>
                      <th className='py-1 text-right font-medium'>In Queue</th>
                      <th className='py-1 text-right font-medium'>In Game</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.pillars.map((pillar) => {
                      const pillarStats = counts ? pillarCounts(counts, pillar) : undefined
                      return (
                        <tr key={pillar.label} className='border-t border-border/50'>
                          <td className='py-1.5'>{pillar.label}</td>
                          <td className='py-1.5 text-right tabular-nums'>{pillarStats?.queued ?? '-'}</td>
                          <td className='py-1.5 text-right tabular-nums'>{pillarStats?.inMatch ?? '-'}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
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
