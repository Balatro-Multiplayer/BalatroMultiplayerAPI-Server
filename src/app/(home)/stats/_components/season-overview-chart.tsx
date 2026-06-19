'use client'

import { Bar, BarChart, CartesianGrid, Legend, XAxis, YAxis } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import {
  getSeasonDisplayName,
  SEASON_2_START_DATE,
  SEASON_3_START_DATE,
  SEASON_4_START_DATE,
  SEASON_5_START_DATE,
  SEASON_6_START_DATE,
  type Season,
} from '@/shared/seasons'
import { api } from '@/trpc/react'
import { ChartCard, ChartCardContent, ChartCardHeader } from './chart-card'

const fmt = (d: Date) =>
  d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

function getSeasonDates(season: Season): string {
  switch (season) {
    case 'season1':
      return `Before ${fmt(SEASON_2_START_DATE)}`
    case 'season2':
      return `${fmt(SEASON_2_START_DATE)} – ${fmt(SEASON_3_START_DATE)}`
    case 'season3':
      return `${fmt(SEASON_3_START_DATE)} – ${fmt(SEASON_4_START_DATE)}`
    case 'season4':
      return `${fmt(SEASON_4_START_DATE)} – ${fmt(SEASON_5_START_DATE)}`
    case 'season5':
      return `${fmt(SEASON_5_START_DATE)} – ${fmt(SEASON_6_START_DATE)}`
    case 'season6':
      return `${fmt(SEASON_6_START_DATE)} – Present`
  }

  return getSeasonDisplayName(season)
}

const chartConfig = {
  totalGames: {
    label: 'Total Games',
    color: 'var(--color-violet-500)',
  },
  uniquePlayers: {
    label: 'Unique Players',
    color: 'var(--color-emerald-500)',
  },
} satisfies ChartConfig

export function SeasonOverviewChart() {
  const [data] = api.stats.season_overview.useSuspenseQuery()

  const chartData = data.map((d) => ({
    ...d,
    name: getSeasonDisplayName(d.season),
  }))

  return (
    <div className='space-y-6'>
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5'>
        {data.map((d) => (
          <Card key={d.season}>
            <CardHeader className='pb-2'>
              <CardTitle className='font-medium text-sm'>
                {getSeasonDisplayName(d.season)}
              </CardTitle>
              <p className='text-muted-foreground text-xs'>
                {getSeasonDates(d.season as Season)}
              </p>
            </CardHeader>
            <CardContent className='space-y-1'>
              <p className='font-bold text-2xl'>
                {d.totalGames.toLocaleString()} matches
              </p>
              <p className='text-muted-foreground text-xs'>
                {d.uniquePlayers.toLocaleString()} players · {d.avgMmrChange}{' '}
                avg MMR Δ
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <ChartCard>
        <ChartCardHeader>
          <h3 className='font-semibold leading-none'>Season Comparison</h3>
        </ChartCardHeader>
        <ChartCardContent className='h-[300px] sm:h-[400px]'>
          <ChartContainer config={chartConfig} className='h-full w-full'>
            <BarChart
              data={chartData}
              margin={{ top: 20, right: 10, left: 0, bottom: 20 }}
            >
              <CartesianGrid vertical={false} />
              <XAxis dataKey='name' tickLine={false} axisLine={false} />
              <YAxis />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    formatter={(value, name) => {
                      const label =
                        name === 'Total Games' ? 'matches' : 'players'
                      return `${Number(value).toLocaleString()} ${label}`
                    }}
                  />
                }
              />
              <Legend />
              <Bar
                dataKey='totalGames'
                name='Total Games'
                fill='var(--color-violet-500)'
                radius={4}
              />
              <Bar
                dataKey='uniquePlayers'
                name='Unique Players'
                fill='var(--color-emerald-500)'
                radius={4}
              />
            </BarChart>
          </ChartContainer>
        </ChartCardContent>
      </ChartCard>
    </div>
  )
}
