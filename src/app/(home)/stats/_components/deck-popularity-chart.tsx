'use client'

import { format } from 'date-fns'
import { BarChart3, CalendarIcon, PieChartIcon } from 'lucide-react'
import { parseAsString, useQueryStates } from 'nuqs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Pie,
  PieChart,
  Sector,
  XAxis,
  YAxis,
} from 'recharts'
import {
  DECK_IMAGES,
  getDeckDescription,
  getDeckDisplayName,
  getDeckImage,
} from '@/shared/decks'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
import { Label } from '@/components/ui/label'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { cn } from '@/lib/utils'
import {
  CASUAL_QUEUE_ID,
  RANKED_QUEUE_ID,
  SMALLWORLD_QUEUE_ID,
  VANILLA_QUEUE_ID,
} from '@/shared/constants'
import { getSeasonDisplayName, type Season } from '@/shared/seasons'
import { api } from '@/trpc/react'
import {
  createStatsSearchParamsParsers,
  type STATS_FILTER_MODES,
  type STATS_QUEUES,
} from '../search-params'
import { resolveStatsSeason } from '../search-params.constants'
import { ChartCard, ChartCardContent, ChartCardHeader } from './chart-card'

const PIE_COLORS = [
  'var(--color-violet-500)',
  'var(--color-blue-500)',
  'var(--color-emerald-500)',
  'var(--color-amber-500)',
  'var(--color-rose-500)',
  'var(--color-cyan-500)',
  'var(--color-pink-500)',
  'var(--color-teal-500)',
  'var(--color-orange-500)',
  'var(--color-indigo-500)',
  'var(--color-lime-500)',
  'var(--color-fuchsia-500)',
  'var(--color-sky-500)',
  'var(--color-red-500)',
  'var(--color-green-500)',
  'var(--color-yellow-500)',
]

const chartConfig = {
  games: {
    label: 'Games',
    color: 'var(--color-violet-500)',
  },
} satisfies ChartConfig

const QUEUE_TYPES = [
  { value: 'all', label: 'All Queues' },
  { value: RANKED_QUEUE_ID, label: 'Standard Ranked' },
  { value: VANILLA_QUEUE_ID, label: 'Vanilla' },
  { value: SMALLWORLD_QUEUE_ID, label: 'Smallworld' },
  { value: CASUAL_QUEUE_ID, label: 'Casual' },
] as const
type FilterMode = (typeof STATS_FILTER_MODES)[number]
type DeckPopularityChartProps = {
  defaultSeason: Season
  statsSeasons: Season[]
}
type PieActiveShapeProps = {
  cx: number
  cy: number
  innerRadius: number
  outerRadius: number
  startAngle: number
  endAngle: number
  fill: string
}

function isPieActiveShapeProps(value: unknown): value is PieActiveShapeProps {
  if (!value || typeof value !== 'object') return false
  const shape = value as Record<string, unknown>
  return (
    typeof shape.cx === 'number' &&
    typeof shape.cy === 'number' &&
    typeof shape.innerRadius === 'number' &&
    typeof shape.outerRadius === 'number' &&
    typeof shape.startAngle === 'number' &&
    typeof shape.endAngle === 'number' &&
    typeof shape.fill === 'string'
  )
}

function renderActiveShape(props: unknown) {
  if (!isPieActiveShapeProps(props)) return null
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props
  return (
    <Sector
      cx={cx}
      cy={cy}
      innerRadius={innerRadius}
      outerRadius={outerRadius + 8}
      startAngle={startAngle}
      endAngle={endAngle}
      fill={fill}
    />
  )
}

export function DeckPopularityChart({
  defaultSeason,
  statsSeasons,
}: DeckPopularityChartProps) {
  const [chartType, setChartType] = useState<'bar' | 'pie'>('bar')
  const chartTypeInitialized = useRef(false)
  useEffect(() => {
    if (chartTypeInitialized.current) return
    chartTypeInitialized.current = true
    if (window.innerWidth < 640) setChartType('pie')
  }, [])
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined)
  const statsSearchParamsParsers = useMemo(
    () => createStatsSearchParamsParsers(defaultSeason),
    [defaultSeason]
  )
  const [queryParams, setQueryParams] = useQueryStates({
    deckMode: statsSearchParamsParsers.deckMode,
    deckSeason: statsSearchParamsParsers.deckSeason,
    deckStartDate: parseAsString,
    deckEndDate: parseAsString,
    deckQueueId: statsSearchParamsParsers.deckQueueId,
  })

  const filterMode = queryParams.deckMode as FilterMode
  const season = resolveStatsSeason(
    queryParams.deckSeason,
    statsSeasons,
    defaultSeason
  )
  const queueId = queryParams.deckQueueId

  useEffect(() => {
    if (queryParams.deckSeason === season) return

    setQueryParams({ deckSeason: season })
  }, [queryParams.deckSeason, season, setQueryParams])

  const dateRange = useMemo(() => {
    const from = queryParams.deckStartDate
      ? new Date(queryParams.deckStartDate)
      : undefined
    const to = queryParams.deckEndDate
      ? new Date(queryParams.deckEndDate)
      : undefined
    return {
      from: from && !Number.isNaN(from.getTime()) ? from : undefined,
      to: to && !Number.isNaN(to.getTime()) ? to : undefined,
    }
  }, [queryParams.deckEndDate, queryParams.deckStartDate])

  const [combineSpecialtyCocktails, setCombineSpecialtyCocktails] =
    useState(false)

  const [rawData] = api.stats.deck_popularity.useSuspenseQuery({
    mode: filterMode,
    season: filterMode === 'season' ? season : undefined,
    startDate:
      filterMode === 'dateRange' ? dateRange?.from?.toISOString() : undefined,
    endDate:
      filterMode === 'dateRange' ? dateRange?.to?.toISOString() : undefined,
    queueId: queueId === 'all' ? undefined : queueId,
  })

  // Normalize verbose cocktail variants (e.g. "virtualized cocktail ~ magic zodiac heidelberg" → "virtualized cocktail")
  const normalizedData = useMemo(() => {
    const merged: Record<string, { games: number }> = {}
    for (const entry of rawData) {
      const key = entry.deck.replace(/\s*~.*$/, '')
      merged[key] = { games: (merged[key]?.games ?? 0) + entry.games }
    }
    const totalGames = Object.values(merged).reduce(
      (sum, d) => sum + d.games,
      0
    )
    return Object.entries(merged)
      .map(([deck, { games }]) => ({
        deck,
        games,
        pickRate:
          totalGames > 0 ? Math.round((games / totalGames) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.games - a.games)
  }, [rawData])

  const data = useMemo(() => {
    if (!combineSpecialtyCocktails) return normalizedData

    let specialtyGames = 0
    const filtered: typeof normalizedData = []

    for (const entry of normalizedData) {
      const isSpecialty =
        entry.deck.includes('cocktail') && entry.deck !== 'cocktail'
      if (isSpecialty) {
        specialtyGames += entry.games
      } else {
        filtered.push(entry)
      }
    }

    if (specialtyGames > 0) {
      const totalGames = normalizedData.reduce((sum, d) => sum + d.games, 0)
      filtered.push({
        deck: 'specialty cocktails',
        games: specialtyGames,
        pickRate:
          totalGames > 0
            ? Math.round((specialtyGames / totalGames) * 1000) / 10
            : 0,
      })
      filtered.sort((a, b) => b.games - a.games)
    }

    return filtered
  }, [rawData, combineSpecialtyCocktails])

  const totalGames = data.reduce((sum, d) => sum + d.games, 0)
  const onPieEnter = useCallback(
    (_: unknown, index: number) => setActiveIndex(index),
    []
  )
  const onPieLeave = useCallback(() => setActiveIndex(undefined), [])

  return (
    <ChartCard>
      <ChartCardHeader className='sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <h3 className='font-semibold leading-none'>Deck Popularity</h3>
          <p className='text-muted-foreground text-sm'>
            {totalGames.toLocaleString()} total games across {data.length} decks
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          <ToggleGroup
            type='single'
            value={chartType}
            onValueChange={(v) => v && setChartType(v as 'bar' | 'pie')}
            variant='outline'
            size='sm'
          >
            <ToggleGroupItem value='bar' aria-label='Bar chart'>
              <BarChart3 className='h-4 w-4' />
            </ToggleGroupItem>
            <ToggleGroupItem value='pie' aria-label='Pie chart'>
              <PieChartIcon className='h-4 w-4' />
            </ToggleGroupItem>
          </ToggleGroup>
          <div className='flex items-center gap-2'>
            <Switch
              id='combine-specialty-cocktails'
              checked={combineSpecialtyCocktails}
              onCheckedChange={setCombineSpecialtyCocktails}
            />
            <Label
              htmlFor='combine-specialty-cocktails'
              className='cursor-pointer whitespace-nowrap text-sm'
            >
              Combine specialty cocktails
            </Label>
          </div>
          <Select
            value={filterMode}
            onValueChange={(v) => {
              setQueryParams({ deckMode: v as FilterMode })
            }}
          >
            <SelectTrigger className='w-full sm:w-[180px]'>
              <SelectValue placeholder='Filter mode' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='season'>Filter by season</SelectItem>
              <SelectItem value='dateRange'>Filter by date range</SelectItem>
            </SelectContent>
          </Select>
          {filterMode === 'season' ? (
            <Select
              value={season}
              onValueChange={(v) => {
                setQueryParams({
                  deckSeason: v as Season,
                })
              }}
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
          ) : (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  id='deck-date'
                  variant='outline'
                  className={cn(
                    'w-full justify-start text-left font-normal sm:w-[280px]',
                    !dateRange?.from && 'text-muted-foreground'
                  )}
                >
                  <CalendarIcon className='mr-2 h-4 w-4' />
                  {dateRange?.from ? (
                    dateRange.to ? (
                      <>
                        {format(dateRange.from, 'LLL dd, y')} -{' '}
                        {format(dateRange.to, 'LLL dd, y')}
                      </>
                    ) : (
                      format(dateRange.from, 'LLL dd, y')
                    )
                  ) : (
                    <span>Pick a date range</span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent className='w-auto p-0' align='end'>
                <Calendar
                  initialFocus
                  mode='range'
                  defaultMonth={dateRange?.from}
                  selected={{
                    from: dateRange?.from,
                    to: dateRange?.to,
                  }}
                  onSelect={(value) => {
                    setQueryParams({
                      deckStartDate: value?.from
                        ? value.from.toISOString()
                        : null,
                      deckEndDate: value?.to ? value.to.toISOString() : null,
                    })
                  }}
                  numberOfMonths={1}
                />
              </PopoverContent>
            </Popover>
          )}
          <Select
            value={queueId}
            onValueChange={(v) => {
              setQueryParams({
                deckQueueId: v as (typeof STATS_QUEUES)[number],
              })
            }}
          >
            <SelectTrigger className='w-full sm:w-[160px]'>
              <SelectValue placeholder='Select queue' />
            </SelectTrigger>
            <SelectContent>
              {QUEUE_TYPES.map((q) => (
                <SelectItem key={q.value} value={q.value}>
                  {q.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </ChartCardHeader>
      <ChartCardContent>
        {data.length === 0 ? (
          <div className='flex h-[350px] items-center justify-center text-fd-muted-foreground sm:h-[500px]'>
            No data available for selected filters.
          </div>
        ) : chartType === 'bar' ? (
          <>
            {/* Desktop: vertical bars */}
            <div className='hidden h-[500px] w-full sm:block'>
              <ChartContainer config={chartConfig} className='h-full w-full'>
                <BarChart
                  data={data}
                  margin={{ top: 30, right: 20, left: 20, bottom: 60 }}
                >
                  <CartesianGrid vertical={false} />
                  <XAxis
                    dataKey='deck'
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                    tick={(props) => {
                      const { x, y, payload } = props
                      const imagePath = getDeckImage(payload.value)
                      const itemCount = data.length
                      const imgSize = Math.max(
                        20,
                        Math.min(40, 600 / itemCount)
                      )
                      return (
                        <g
                          transform={`translate(${Number(x) - imgSize / 2},${Number(y) + 10})`}
                        >
                          <title>
                            {getDeckDisplayName(payload.value)}
                            {getDeckDescription(payload.value)
                              ? `: ${getDeckDescription(payload.value)}`
                              : ''}
                          </title>
                          {imagePath && (
                            <image
                              href={imagePath}
                              width={imgSize}
                              height={imgSize}
                            />
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
                              {getDeckDisplayName(payload.value)}
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
                      <ChartTooltipContent
                        formatter={(_value, _name, item) => {
                          const entry = item.payload
                          const desc = getDeckDescription(entry.deck)
                          return (
                            <span>
                              {entry.games.toLocaleString()} games ·{' '}
                              {entry.pickRate}% pick rate
                              {desc && (
                                <span className='mt-1 block text-muted-foreground'>
                                  {desc.split('\n').map((line, i) => (
                                    <span key={i}>
                                      {i > 0 && <br />}
                                      {line}
                                    </span>
                                  ))}
                                </span>
                              )}
                            </span>
                          )
                        }}
                        labelFormatter={(label) =>
                          getDeckDisplayName(String(label ?? ''))
                        }
                      />
                    }
                  />
                  <Bar
                    dataKey='games'
                    fill='var(--color-violet-500)'
                    radius={4}
                  >
                    <LabelList
                      dataKey='pickRate'
                      position='top'
                      offset={8}
                      className='fill-foreground'
                      fontSize={10}
                      formatter={(v) => `${v}%`}
                    />
                  </Bar>
                </BarChart>
              </ChartContainer>
            </div>
            {/* Mobile: horizontal bars, height scales with item count */}
            <div
              className='w-full sm:hidden'
              style={{ height: Math.max(350, data.length * 32) }}
            >
              <ChartContainer config={chartConfig} className='h-full w-full'>
                <BarChart
                  data={data}
                  layout='vertical'
                  margin={{ top: 5, right: 35, left: 0, bottom: 5 }}
                >
                  <CartesianGrid horizontal={false} />
                  <XAxis type='number' hide />
                  <YAxis
                    type='category'
                    dataKey='deck'
                    tickLine={false}
                    axisLine={false}
                    width={100}
                    tick={{ fontSize: 12 }}
                    tickFormatter={(value) => getDeckDisplayName(value)}
                  />
                  <ChartTooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        formatter={(_value, _name, item) => {
                          const entry = item.payload
                          const desc = getDeckDescription(entry.deck)
                          return (
                            <span>
                              {entry.games.toLocaleString()} games ·{' '}
                              {entry.pickRate}% pick rate
                              {desc && (
                                <span className='mt-1 block text-muted-foreground'>
                                  {desc.split('\n').map((line, i) => (
                                    <span key={i}>
                                      {i > 0 && <br />}
                                      {line}
                                    </span>
                                  ))}
                                </span>
                              )}
                            </span>
                          )
                        }}
                        labelFormatter={(label) =>
                          getDeckDisplayName(String(label ?? ''))
                        }
                      />
                    }
                  />
                  <Bar
                    dataKey='games'
                    fill='var(--color-violet-500)'
                    radius={4}
                  >
                    <LabelList
                      dataKey='pickRate'
                      position='right'
                      offset={8}
                      className='fill-foreground'
                      fontSize={10}
                      formatter={(v) => `${v}%`}
                    />
                  </Bar>
                </BarChart>
              </ChartContainer>
            </div>
          </>
        ) : (
          <div className='flex h-[350px] flex-col gap-4 sm:h-[500px] sm:flex-row'>
            <ChartContainer
              config={chartConfig}
              className='min-h-[200px] flex-1 sm:h-full'
            >
              <PieChart>
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      formatter={(_value, _name, item) => {
                        const entry = item.payload
                        const desc = getDeckDescription(entry.deck)
                        return (
                          <span>
                            {entry.games.toLocaleString()} games ·{' '}
                            {entry.pickRate}% pick rate
                            {desc && (
                              <>
                                <br />
                                <span className='text-muted-foreground'>
                                  {desc}
                                </span>
                              </>
                            )}
                          </span>
                        )
                      }}
                      labelFormatter={(label) =>
                        getDeckDisplayName(String(label ?? ''))
                      }
                    />
                  }
                />
                <Pie
                  data={data}
                  dataKey='games'
                  nameKey='deck'
                  cx='50%'
                  cy='50%'
                  outerRadius='80%'
                  activeShape={renderActiveShape}
                  onMouseEnter={onPieEnter}
                  onMouseLeave={onPieLeave}
                >
                  {data.map((entry, i) => (
                    <Cell
                      key={entry.deck}
                      fill={PIE_COLORS[i % PIE_COLORS.length]}
                      opacity={
                        activeIndex !== undefined && activeIndex !== i ? 0.4 : 1
                      }
                    />
                  ))}
                </Pie>
              </PieChart>
            </ChartContainer>
            <div className='grid grid-cols-2 gap-1 overflow-y-auto py-2 pr-2 sm:flex sm:w-40 sm:flex-col'>
              {data.map((entry, i) => (
                <button
                  key={entry.deck}
                  type='button'
                  className='flex items-center gap-2 rounded px-2 py-1 text-left text-xs capitalize transition-colors hover:bg-fd-muted'
                  onMouseEnter={() => setActiveIndex(i)}
                  onMouseLeave={() => setActiveIndex(undefined)}
                  onFocus={() => setActiveIndex(i)}
                  onBlur={() => setActiveIndex(undefined)}
                  aria-pressed={activeIndex === i}
                  style={{
                    opacity:
                      activeIndex !== undefined && activeIndex !== i ? 0.4 : 1,
                  }}
                >
                  <span
                    className='inline-block h-3 w-3 shrink-0 rounded-sm'
                    style={{
                      backgroundColor: PIE_COLORS[i % PIE_COLORS.length],
                    }}
                  />
                  <span className='truncate'>
                    {getDeckDisplayName(entry.deck)}
                  </span>
                  <span className='ml-auto text-fd-muted-foreground'>
                    {entry.pickRate}%
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </ChartCardContent>
    </ChartCard>
  )
}
