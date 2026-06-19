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
import { STAKE_IMAGES } from '@/app/(home)/players/[id]/_components/deck-stake-stats-chart'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
  type ChartConfig,
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from '@/components/ui/chart'
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
  'var(--color-emerald-500)',
  'var(--color-blue-500)',
  'var(--color-violet-500)',
  'var(--color-amber-500)',
  'var(--color-rose-500)',
  'var(--color-cyan-500)',
  'var(--color-pink-500)',
  'var(--color-teal-500)',
  'var(--color-orange-500)',
  'var(--color-indigo-500)',
]

const chartConfig = {
  games: {
    label: 'Games',
    color: 'var(--color-emerald-500)',
  },
} satisfies ChartConfig

const QUEUE_TYPES = [
  { value: 'all', label: 'All Queues' },
  { value: RANKED_QUEUE_ID, label: 'Ranked' },
  { value: VANILLA_QUEUE_ID, label: 'Vanilla' },
  { value: SMALLWORLD_QUEUE_ID, label: 'Small World' },
  { value: CASUAL_QUEUE_ID, label: 'Casual' },
] as const
type FilterMode = (typeof STATS_FILTER_MODES)[number]
type StakePopularityChartProps = {
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

export function StakePopularityChart({
  defaultSeason,
  statsSeasons,
}: StakePopularityChartProps) {
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
    stakeMode: statsSearchParamsParsers.stakeMode,
    stakeSeason: statsSearchParamsParsers.stakeSeason,
    stakeStartDate: parseAsString,
    stakeEndDate: parseAsString,
    stakeQueueId: statsSearchParamsParsers.stakeQueueId,
  })

  const filterMode = queryParams.stakeMode as FilterMode
  const season = resolveStatsSeason(
    queryParams.stakeSeason,
    statsSeasons,
    defaultSeason
  )
  const queueId = queryParams.stakeQueueId

  useEffect(() => {
    if (queryParams.stakeSeason === season) return

    setQueryParams({ stakeSeason: season })
  }, [queryParams.stakeSeason, season, setQueryParams])

  const dateRange = useMemo(() => {
    const from = queryParams.stakeStartDate
      ? new Date(queryParams.stakeStartDate)
      : undefined
    const to = queryParams.stakeEndDate
      ? new Date(queryParams.stakeEndDate)
      : undefined
    return {
      from: from && !Number.isNaN(from.getTime()) ? from : undefined,
      to: to && !Number.isNaN(to.getTime()) ? to : undefined,
    }
  }, [queryParams.stakeEndDate, queryParams.stakeStartDate])

  const [data] = api.stats.stake_popularity.useSuspenseQuery({
    mode: filterMode,
    season: filterMode === 'season' ? season : undefined,
    startDate:
      filterMode === 'dateRange' ? dateRange?.from?.toISOString() : undefined,
    endDate:
      filterMode === 'dateRange' ? dateRange?.to?.toISOString() : undefined,
    queueId: queueId === 'all' ? undefined : queueId,
  })

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
          <h3 className='font-semibold leading-none'>Stake Popularity</h3>
          <p className='text-muted-foreground text-sm'>
            {totalGames.toLocaleString()} total games across {data.length}{' '}
            stakes
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
          <Select
            value={filterMode}
            onValueChange={(v) => {
              setQueryParams({ stakeMode: v as FilterMode })
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
                  stakeSeason: v as Season,
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
                  id='stake-date'
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
                      stakeStartDate: value?.from
                        ? value.from.toISOString()
                        : null,
                      stakeEndDate: value?.to ? value.to.toISOString() : null,
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
                stakeQueueId: v as (typeof STATS_QUEUES)[number],
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
                    dataKey='stake'
                    tickLine={false}
                    axisLine={false}
                    interval={0}
                    tick={(props) => {
                      const { x, y, payload } = props
                      const imagePath = STAKE_IMAGES[payload.value]
                      const itemCount = data.length
                      const imgSize = Math.max(
                        20,
                        Math.min(40, 600 / itemCount)
                      )
                      return (
                        <g
                          transform={`translate(${Number(x) - imgSize / 2},${Number(y) + 10})`}
                        >
                          <title className='capitalize'>{payload.value}</title>
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
                              className='font-medium capitalize'
                            >
                              {payload.value}
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
                          return `${entry.games.toLocaleString()} games · ${entry.pickRate}% pick rate`
                        }}
                        labelFormatter={(label) => String(label ?? '')}
                      />
                    }
                  />
                  <Bar
                    dataKey='games'
                    fill='var(--color-emerald-500)'
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
            {/* Mobile: horizontal bars */}
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
                    dataKey='stake'
                    tickLine={false}
                    axisLine={false}
                    width={70}
                    tick={{ fontSize: 12 }}
                    className='capitalize'
                  />
                  <ChartTooltip
                    cursor={false}
                    content={
                      <ChartTooltipContent
                        formatter={(_value, _name, item) => {
                          const entry = item.payload
                          return `${entry.games.toLocaleString()} games · ${entry.pickRate}% pick rate`
                        }}
                        labelFormatter={(label) => String(label ?? '')}
                      />
                    }
                  />
                  <Bar
                    dataKey='games'
                    fill='var(--color-emerald-500)'
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
                        return `${entry.games.toLocaleString()} games · ${entry.pickRate}% pick rate`
                      }}
                      labelFormatter={(label) => String(label ?? '')}
                    />
                  }
                />
                <Pie
                  data={data}
                  dataKey='games'
                  nameKey='stake'
                  cx='50%'
                  cy='50%'
                  outerRadius='80%'
                  activeShape={renderActiveShape}
                  onMouseEnter={onPieEnter}
                  onMouseLeave={onPieLeave}
                >
                  {data.map((entry, i) => (
                    <Cell
                      key={entry.stake}
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
                  key={entry.stake}
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
                  <span className='truncate'>{entry.stake}</span>
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
