'use client'
import Image from 'next/image'
import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from 'recharts'
import {
  Card,
  CardContent,
  CardDescription,
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
  DECK_IMAGES,
  getDeckDescription,
  getDeckDisplayName,
  getDeckImage,
} from '@/shared/decks'
import { getSeasonDisplayName, type Season } from '@/shared/seasons'

export { DECK_IMAGES } from '@/shared/decks'

export const STAKE_IMAGES: Record<string, string> = {
  white: '/stakes/white_stake.png',
  red: '/stakes/red_stake.png',
  green: '/stakes/green_stake.png',
  blue: '/stakes/blue_stake.png',
  purple: '/stakes/purple_stake.png',
  orange: '/stakes/orange_stake.png',
  black: '/stakes/black_stake.png',
  gold: '/stakes/gold_stake.png',
  unknown: '/stakes/unknown.png',
}

type StatDatum = {
  name: string
  wins: number
  losses: number
  total: number
}

export function DeckImage({
  deck,
  width = 24,
  height = 32,
  className = 'h-8 w-auto',
}: {
  deck: string | null | undefined
  width?: number
  height?: number
  className?: string
}) {
  const src =
    (deck ? getDeckImage(deck) : null) ?? DECK_IMAGES.unknown ?? ''
  return (
    <Image
      src={src}
      alt={deck ? getDeckDisplayName(deck) : 'unknown'}
      width={width}
      height={height}
      className={className}
    />
  )
}

export function StakeImage({
  stake,
  width = 32,
  height = 32,
  className = 'h-8 w-auto',
}: {
  stake: string | null | undefined
  width?: number
  height?: number
  className?: string
}) {
  const src = (stake ? STAKE_IMAGES[stake] : null) ?? STAKE_IMAGES.unknown ?? ''
  return (
    <Image
      src={src}
      alt={stake ?? 'unknown'}
      width={width}
      height={height}
      className={className}
    />
  )
}

const deckChartConfig = {
  wins: {
    label: 'Wins',
    color: 'var(--color-emerald-500)',
  },
  losses: {
    label: 'Losses',
    color: 'var(--color-rose-500)',
  },
  total: {
    label: 'Total',
  },
} satisfies ChartConfig

const stakeChartConfig = {
  wins: {
    label: 'Wins',
    color: 'var(--color-emerald-500)',
  },
  losses: {
    label: 'Losses',
    color: 'var(--color-rose-500)',
  },
  total: {
    label: 'Total',
  },
} satisfies ChartConfig

function normalizeStatKey(value: string | null | undefined, suffix: string) {
  return value ? value.replace(suffix, '').trim().toLowerCase() : 'unknown'
}

function buildStatsData(
  games: SelectGames[],
  getName: (game: SelectGames) => string
) {
  const stats: Record<string, { wins: number; losses: number }> = {}

  for (const game of games) {
    const name = getName(game)
    if (name === 'unknown') continue
    if (game.result !== 'win' && game.result !== 'loss') continue

    if (!stats[name]) {
      stats[name] = { wins: 0, losses: 0 }
    }

    const entry = stats[name]
    if (game.result === 'win') entry.wins += 1
    else entry.losses += 1
  }

  return Object.entries(stats)
    .map(([name, entry]) => ({
      name,
      wins: entry.wins,
      losses: entry.losses,
      total: entry.wins + entry.losses,
    }))
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.total - a.total || b.wins - a.wins)
}

function formatStatName(value: string) {
  return value
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

type TotalLabelProps = {
  payload?: StatDatum
  width?: number | string
  x?: number | string
  y?: number | string
}

function TotalLabel({ payload, width, x, y }: TotalLabelProps) {
  if (!payload || width == null || x == null || y == null) return null

  return (
    <text
      x={Number(x) + Number(width) / 2}
      y={Number(y) - 8}
      textAnchor='middle'
      className='fill-foreground'
      fontSize={10}
    >
      {payload.total}
    </text>
  )
}

function StatsLegend() {
  return (
    <div className='flex items-center gap-4 px-3 text-muted-foreground text-xs'>
      <div className='flex items-center gap-1.5'>
        <span className='size-2 rounded-full bg-emerald-500' />
        Wins
      </div>
      <div className='flex items-center gap-1.5'>
        <span className='size-2 rounded-full bg-rose-500' />
        Losses
      </div>
    </div>
  )
}

function StackedStatsTooltipContent(
  props: React.ComponentProps<typeof ChartTooltipContent>
) {
  const sortedPayload = props.payload
    ? [...props.payload].sort((a, b) => {
        if (a.dataKey === b.dataKey) return 0
        if (a.dataKey === 'wins') return -1
        if (b.dataKey === 'wins') return 1
        return 0
      })
    : props.payload

  return <ChartTooltipContent {...props} payload={sortedPayload} />
}

function StackedStatsChart({
  config,
  data,
  images,
  formatName,
  getImage,
  getTooltipDesc,
}: {
  config: ChartConfig
  data: StatDatum[]
  images: Record<string, string>
  formatName?: (key: string) => string
  getImage?: (key: string) => string | undefined
  getTooltipDesc?: (key: string) => string
}) {
  const resolveName = formatName ?? formatStatName
  const resolveImage = getImage ?? ((key: string) => images[key])

  return (
    <ChartContainer config={config} className='h-[350px] w-full'>
      <BarChart
        data={data}
        margin={{ top: 20, right: 20, left: 20, bottom: 60 }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey='name'
          tickLine={false}
          axisLine={false}
          interval={0}
          tick={(props) => {
            const { x, y, payload } = props
            const imagePath = resolveImage(payload.value)
            const itemCount = data.length
            const imgSize = Math.max(20, Math.min(40, 600 / itemCount))
            const desc = getTooltipDesc?.(payload.value)

            return (
              <g
                transform={`translate(${Number(x) - imgSize / 2},${Number(y) + 10})`}
              >
                <title>
                  {resolveName(payload.value)}
                  {desc ? `: ${desc}` : ''}
                </title>
                {imagePath && (
                  <image href={imagePath} width={imgSize} height={imgSize} />
                )}
                {itemCount <= 12 && (
                  <text
                    x={imgSize / 2}
                    y={imgSize + 20}
                    textAnchor='middle'
                    fill='currentColor'
                    fontSize='10'
                    className='font-medium'
                  >
                    {resolveName(payload.value)}
                  </text>
                )}
              </g>
            )
          }}
        />
        <YAxis hide />
        <ChartTooltip
          cursor={false}
          content={
            <StackedStatsTooltipContent
              labelFormatter={(label, payload) => {
                const total = payload?.[0]?.payload?.total ?? 0
                const name = resolveName(String(label ?? ''))
                const desc = getTooltipDesc?.(String(label ?? ''))
                return (
                  <span className='inline-block max-w-48'>
                    {name} · {total} total
                    {desc && (
                      <span className='block text-muted-foreground font-normal text-xs'>
                        {desc}
                      </span>
                    )}
                  </span>
                )
              }}
            />
          }
        />
        <Bar
          dataKey='losses'
          stackId='results'
          fill='var(--color-losses)'
          radius={[0, 0, 4, 4]}
        >
          <LabelList
            dataKey='total'
            content={(props: TotalLabelProps) =>
              props.payload?.wins ? null : <TotalLabel {...props} />
            }
          />
        </Bar>
        <Bar
          dataKey='wins'
          stackId='results'
          fill='var(--color-wins)'
          radius={[4, 4, 0, 0]}
        >
          <LabelList
            dataKey='total'
            content={(props: TotalLabelProps) =>
              props.payload?.wins ? <TotalLabel {...props} /> : null
            }
          />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

export function DeckStakeStatsChart({
  games,
  season = 'season6',
}: {
  games: SelectGames[]
  season?: Season
}) {
  const deckData = useMemo(() => {
    return buildStatsData(games, (game) => normalizeStatKey(game.deck, 'Deck'))
  }, [games])

  const stakeData = useMemo(() => {
    return buildStatsData(games, (game) =>
      normalizeStatKey(game.stake, 'Stake')
    )
  }, [games])

  return (
    <div className='grid grid-cols-1 gap-4 md:grid-cols-2'>
      <Card>
        <CardHeader>
          <CardTitle>Decks Played</CardTitle>
          <CardDescription>{getSeasonDisplayName(season)}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-3 p-2'>
          {deckData.length > 0 ? (
            <>
              <StatsLegend />
              <StackedStatsChart
                config={deckChartConfig}
                data={deckData}
                images={DECK_IMAGES}
                formatName={getDeckDisplayName}
                getImage={getDeckImage}
                getTooltipDesc={getDeckDescription}
              />
            </>
          ) : (
            <div className='flex h-[350px] w-full items-center justify-center text-muted-foreground'>
              No deck data available
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Stakes Played</CardTitle>
          <CardDescription>{getSeasonDisplayName(season)}</CardDescription>
        </CardHeader>
        <CardContent className='space-y-3 p-2'>
          {stakeData.length > 0 ? (
            <>
              <StatsLegend />
              <StackedStatsChart
                config={stakeChartConfig}
                data={stakeData}
                images={STAKE_IMAGES}
              />
            </>
          ) : (
            <div className='flex h-[350px] w-full items-center justify-center text-muted-foreground'>
              No stake data available
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
