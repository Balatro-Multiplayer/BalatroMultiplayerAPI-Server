'use client'

import { useMemo, useState } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getSeasonDisplayName, type Season } from '@/shared/seasons'
import { api, type RouterOutputs } from '@/trpc/react'
import { resolveStatsSeason } from '../search-params.constants'
import { ChartCard, ChartCardContent, ChartCardHeader } from './chart-card'

const chartConfig = {
  count: {
    label: 'Players',
    color: 'var(--color-violet-500)',
  },
} satisfies ChartConfig

type SnapshotRow = RouterOutputs['seasons']['list_snapshots'][number]
type RatingDistributionChartProps = {
  defaultSeason: Season
  statsSeasons: Season[]
}

function getSeasonId(season: Season): number {
  const match = /^season(\d+)$/.exec(season)
  return Number(match?.[1] ?? 0)
}

function getDefaultQueueType(snapshots: SnapshotRow[]) {
  return snapshots[0]?.queueType ?? 'ranked'
}

function getQueueLabel(queueType: string) {
  if (queueType === 'ranked') return 'Ranked'
  if (queueType === 'vanilla') return 'Vanilla'
  if (queueType === 'smallworld') return 'Small World'

  return queueType
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function computeBellCurve(mmrValues: number[], binSize = 50) {
  if (mmrValues.length === 0) return []

  const min = Math.floor(Math.min(...mmrValues) / binSize) * binSize
  const max = Math.ceil(Math.max(...mmrValues) / binSize) * binSize

  const bins: Record<number, number> = {}
  for (let b = min; b <= max; b += binSize) {
    bins[b] = 0
  }

  for (const mmr of mmrValues) {
    const bin = Math.floor(mmr / binSize) * binSize
    bins[bin] = (bins[bin] ?? 0) + 1
  }

  return Object.entries(bins)
    .map(([rating, count]) => ({
      rating: Number(rating),
      count,
    }))
    .sort((a, b) => a.rating - b.rating)
}

export function RatingDistributionChart({
  defaultSeason,
  statsSeasons,
}: RatingDistributionChartProps) {
  const [season, setSeason] = useState<Season>(defaultSeason)
  const [queueType, setQueueType] = useState('ranked')

  const resolvedSeason = resolveStatsSeason(season, statsSeasons, defaultSeason)
  const seasonId = getSeasonId(resolvedSeason)
  const [snapshots] = api.seasons.list_snapshots.useSuspenseQuery({ seasonId })
  const resolvedQueueType = useMemo(() => {
    if (snapshots.some((snapshot) => snapshot.queueType === queueType)) {
      return queueType
    }

    return getDefaultQueueType(snapshots)
  }, [queueType, snapshots])
  const selectedSnapshot =
    snapshots.find((snapshot) => snapshot.queueType === resolvedQueueType) ??
    snapshots[0]
  const mmrQuery = api.leaderboard.rating_distribution.useQuery(
    {
      channel_id: selectedSnapshot?.queueId ?? '',
      season: resolvedSeason,
    },
    {
      enabled: Boolean(selectedSnapshot?.queueId),
    }
  )
  const mmrValues = mmrQuery.data ?? []

  const chartData = computeBellCurve(mmrValues)
  const totalPlayers = mmrValues.length
  const avgMmr =
    totalPlayers > 0
      ? Math.round(mmrValues.reduce((a, b) => a + b, 0) / totalPlayers)
      : 0
  const sortedMmrValues = [...mmrValues].sort((a, b) => a - b)
  const medianMmr =
    totalPlayers > 0
      ? Math.round(sortedMmrValues[Math.floor(totalPlayers / 2)] ?? 0)
      : 0

  return (
    <ChartCard>
      <ChartCardHeader className='sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <h3 className='font-semibold leading-none'>Rating Distribution</h3>
          <p className='text-muted-foreground text-sm'>
            {totalPlayers.toLocaleString()} players &middot; Avg: {avgMmr}{' '}
            &middot; Median: {medianMmr}
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Select
            value={resolvedSeason}
            onValueChange={(v) => setSeason(v as Season)}
          >
            <SelectTrigger className='w-full sm:w-[180px]'>
              <SelectValue placeholder='Select season' />
            </SelectTrigger>
            <SelectContent>
              {statsSeasons.map((s) => (
                <SelectItem key={s} value={s}>
                  {getSeasonDisplayName(s)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={resolvedQueueType} onValueChange={setQueueType}>
            <SelectTrigger className='w-full sm:w-[160px]'>
              <SelectValue placeholder='Select queue' />
            </SelectTrigger>
            <SelectContent>
              {snapshots.map((snapshot) => (
                <SelectItem key={snapshot.queueType} value={snapshot.queueType}>
                  {getQueueLabel(snapshot.queueType)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </ChartCardHeader>
      <ChartCardContent>
        {chartData.length === 0 ? (
          <div className='flex h-[350px] items-center justify-center text-fd-muted-foreground sm:h-[500px]'>
            No data available for this season and queue type.
          </div>
        ) : (
          <>
            {/* Mobile */}
            <div className='h-[300px] w-full sm:hidden'>
              <ChartContainer config={chartConfig} className='h-full w-full'>
                <AreaChart
                  data={chartData}
                  margin={{ top: 10, right: 5, left: 0, bottom: 40 }}
                >
                  <defs>
                    <linearGradient
                      id='fillCountMobile'
                      x1='0'
                      y1='0'
                      x2='0'
                      y2='1'
                    >
                      <stop
                        offset='5%'
                        stopColor='var(--color-count)'
                        stopOpacity={0.8}
                      />
                      <stop
                        offset='95%'
                        stopColor='var(--color-count)'
                        stopOpacity={0.1}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray='3 3' />
                  <XAxis
                    dataKey='rating'
                    angle={-45}
                    textAnchor='end'
                    height={40}
                    tick={{ fontSize: 10 }}
                    tickFormatter={(value) => `${value}`}
                  />
                  <YAxis tick={{ fontSize: 10 }} width={30} />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) => `${value} players`}
                        labelFormatter={(_label, payload) => {
                          const rating = payload?.[0]?.payload?.rating
                          return `Rating: ${rating} - ${Number(rating) + 50}`
                        }}
                      />
                    }
                  />
                  <Area
                    type='monotone'
                    dataKey='count'
                    stroke='var(--color-count)'
                    fill='url(#fillCountMobile)'
                    strokeWidth={2}
                  />
                </AreaChart>
              </ChartContainer>
            </div>
            {/* Desktop */}
            <div className='hidden h-[500px] w-full sm:block'>
              <ChartContainer config={chartConfig} className='h-full w-full'>
                <AreaChart
                  data={chartData}
                  margin={{ top: 20, right: 10, left: 0, bottom: 60 }}
                >
                  <defs>
                    <linearGradient id='fillCount' x1='0' y1='0' x2='0' y2='1'>
                      <stop
                        offset='5%'
                        stopColor='var(--color-count)'
                        stopOpacity={0.8}
                      />
                      <stop
                        offset='95%'
                        stopColor='var(--color-count)'
                        stopOpacity={0.1}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray='3 3' />
                  <XAxis
                    dataKey='rating'
                    angle={-45}
                    textAnchor='end'
                    height={60}
                    tickFormatter={(value) => `${value}`}
                  />
                  <YAxis />
                  <ChartTooltip
                    content={
                      <ChartTooltipContent
                        formatter={(value) => `${value} players`}
                        labelFormatter={(_label, payload) => {
                          const rating = payload?.[0]?.payload?.rating
                          return `Rating: ${rating} - ${Number(rating) + 50}`
                        }}
                      />
                    }
                  />
                  <Area
                    type='monotone'
                    dataKey='count'
                    stroke='var(--color-count)'
                    fill='url(#fillCount)'
                    strokeWidth={2}
                  />
                </AreaChart>
              </ChartContainer>
            </div>
          </>
        )}
      </ChartCardContent>
    </ChartCard>
  )
}
