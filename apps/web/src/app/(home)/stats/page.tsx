'use client'

import type { QueueStatsResponse } from '@bmp/types'
import { useQuery } from '@tanstack/react-query'
import {
  ContentCard,
  EmptyLine,
  PageHeader,
  PageShell,
} from '@/components/page-kit'
import { apiFetch } from '@/lib/api'
import { pillarCounts, QUEUE_MODS, type QueueMod } from '@/lib/queue-pillars'

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
    <PageShell>
      <PageHeader
        title='Statistics'
        meta='Global statistics for Balatro Multiplayer.'
      />

      <div className='grid grid-cols-1 gap-4 sm:grid-cols-3'>
        <StatCard
          label='Total Matches'
          value={stats?.totalMatches}
          color='text-bal-blue'
        />
        <StatCard
          label='Unique Players'
          value={stats?.uniquePlayers}
          color='text-bal-green'
        />
        <StatCard
          label='Online Players'
          value={onlinePlayers}
          color='text-primary'
        />
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
    </PageShell>
  )
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string
  value: number | null | undefined
  color: string
}) {
  return (
    <section className='rounded-lg border border-border bg-card/80 p-4 text-center'>
      <div className={`font-pixel text-4xl ${color}`}>
        {value != null ? value.toLocaleString() : '-'}
      </div>
      <h2 className='mt-1.5 font-pixel text-lg text-muted-foreground uppercase tracking-wide'>
        {label}
      </h2>
    </section>
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
    <ContentCard title={`${mod.label} Queues`}>
      <p className='text-muted-foreground text-sm'>
        Players in each Find Game queue and in its games now.
      </p>
      {unavailable ? (
        <EmptyLine>Queue stats are unavailable right now.</EmptyLine>
      ) : (
        <div className='grid grid-cols-1 gap-6 md:grid-cols-2'>
          {mod.groups.map((group) => (
            <div key={group.label} className='min-w-0 space-y-1'>
              <h3 className='font-pixel text-base text-muted-foreground uppercase tracking-wide'>
                {group.label}
              </h3>
              <ul className='text-sm'>
                <li className='grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] gap-2 py-1 text-muted-foreground text-xs'>
                  <span>Mode</span>
                  <span className='text-right'>In Queue</span>
                  <span className='text-right'>In Game</span>
                </li>
                {group.pillars.map((pillar) => {
                  const pillarStats = counts
                    ? pillarCounts(counts, pillar)
                    : undefined
                  return (
                    <li
                      key={pillar.label}
                      className='grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] gap-2 border-border/50 border-t py-1.5'
                    >
                      <span className='min-w-0 break-words'>
                        {pillar.label}
                      </span>
                      <span className='text-right tabular-nums'>
                        {pillarStats?.queued ?? '-'}
                      </span>
                      <span className='text-right tabular-nums'>
                        {pillarStats?.inMatch ?? '-'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </ContentCard>
  )
}

function ActivityChartCard({ data }: { data: ActivityResponse | undefined }) {
  const buckets = data?.buckets ?? []
  const max = Math.max(1, ...buckets.map((b) => b.count))

  return (
    <ContentCard title='Activity'>
      <p className='text-muted-foreground text-sm'>
        Matches formed per hour, last 7 days.
      </p>
      {buckets.length === 0 ? (
        <EmptyLine>No recent activity.</EmptyLine>
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
    </ContentCard>
  )
}
