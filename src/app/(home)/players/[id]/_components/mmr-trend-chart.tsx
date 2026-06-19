'use client'
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from 'recharts'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import type { SelectGames } from '@/server/db/types'
import {
  filterGamesBySeason,
  getSeasonDisplayName,
  type Season,
} from '@/shared/seasons'

const chartConfig = {
  mmr: {
    label: 'MMR',
    color: 'var(--color-violet-500)',
  },
} satisfies ChartConfig

export function MmrTrendChart({
  games,
  season = 'season6',
  queueType = 'ranked',
}: {
  games: SelectGames[]
  season?: Season
  queueType?: string
}) {
  // Filter games by season if a specific season is selected
  const seasonFilteredGames = filterGamesBySeason(games, season)

  const chartData = seasonFilteredGames
    .filter((game) => {
      const targetQueue = queueType === 'all' ? 'ranked' : queueType
      return game.gameType === targetQueue
    })
    .map((game) => ({
      date: game.gameTime,
      mmr: game.playerMmr + game.mmrChange,
      mmrBefore: game.playerMmr,
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
  const firstGame = chartData[0]
  if (firstGame) {
    chartData.unshift({
      date: firstGame.date,
      mmr: firstGame.mmrBefore,
      mmrBefore: firstGame.mmrBefore,
    })
  }

  const queueLabel =
    queueType === 'all'
      ? 'Ranked'
      : queueType.charAt(0).toUpperCase() + queueType.slice(1)

  return (
    <Card>
      <CardHeader>
        <CardTitle>{queueLabel} MMR Trends</CardTitle>
        <CardDescription>{getSeasonDisplayName(season)}</CardDescription>
      </CardHeader>
      <CardContent className={'p-2'}>
        <ChartContainer config={chartConfig}>
          <LineChart
            accessibilityLayer
            data={chartData}
            margin={{
              left: 12,
              right: 12,
            }}
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey='date'
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value) =>
                new Date(value).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                })
              }
            />
            <YAxis
              dataKey={'mmr'}
              width={40}
              tickLine={false}
              axisLine={false}
            />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent hideLabel />}
            />
            <Line
              dataKey='mmr'
              type='natural'
              stroke='var(--color-mmr)'
              strokeWidth={2}
              dot={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
      <CardFooter className='flex-col items-start gap-2 text-sm'>
        <div className='text-muted-foreground leading-none'>
          Showing only {queueLabel.toLowerCase()} MMR
        </div>
      </CardFooter>
    </Card>
  )
}
