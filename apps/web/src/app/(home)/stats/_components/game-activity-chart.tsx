'use client'

import { format } from 'date-fns'
import { CalendarIcon } from 'lucide-react'
import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
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
import { useIsMobile } from '@/hooks/use-mobile'
import { cn } from '@/lib/utils'
import { api } from '@/trpc/react'
import { ChartCard, ChartCardContent, ChartCardHeader } from './chart-card'

const chartConfig = {
  count: {
    label: 'Games',
    color: 'var(--color-violet-500)',
  },
} satisfies ChartConfig

type GroupByOption = 'hour' | 'day' | 'week' | 'month'

function parseTimeUnit(value: string, groupBy: GroupByOption) {
  switch (groupBy) {
    case 'hour':
      return new Date(value.replace(' ', 'T'))
    case 'day':
      return new Date(`${value}T00:00:00`)
    case 'week':
      return new Date(`${value.replace('Week of ', '')}T00:00:00`)
    case 'month':
      return new Date(`${value}-01T00:00:00`)
  }
}

export function GameActivityChart() {
  const [groupBy, setGroupBy] = useState<GroupByOption>('week')
  const isMobile = useIsMobile()
  const [dateRange, setDateRange] = useState<
    | {
        from?: Date | undefined
        to?: Date | undefined
      }
    | undefined
  >({
    from: undefined,
    to: undefined,
  })

  // Fetch games data with the selected grouping and date range
  const [gamesData] = api.history.games_per_hour.useSuspenseQuery({
    groupBy,
    startDate: dateRange?.from?.toISOString(),
    endDate: dateRange?.to?.toISOString(),
  })

  // Format the title and description based on the grouping
  const getTitleText = () => {
    switch (groupBy) {
      case 'hour':
        return 'Game Activity (Hourly)'
      case 'day':
        return 'Game Activity (Daily)'
      case 'week':
        return 'Game Activity (Weekly)'
      case 'month':
        return 'Game Activity (Monthly)'
      default:
        return 'Game Activity'
    }
  }

  // Format the X-axis labels based on the grouping
  const formatXAxisTick = (value: string) => {
    const date = parseTimeUnit(value, groupBy)

    if (Number.isNaN(date.getTime())) {
      return value
    }

    switch (groupBy) {
      case 'hour':
        return format(date, isMobile ? 'MMM d HH:mm' : 'MMM d, HH:mm')
      case 'day':
        return format(date, 'MMM d')
      case 'week':
        return isMobile
          ? format(date, 'MMM d')
          : `Week of ${format(date, 'MMM d')}`
      case 'month':
        return format(date, 'MMM yyyy')
      default:
        return value
    }
  }

  const xAxisHeight = isMobile
    ? groupBy === 'hour'
      ? 108
      : 96
    : groupBy === 'hour'
      ? 112
      : 96
  const xAxisAngle = isMobile ? -90 : -45
  const xAxisTextAnchor = isMobile ? 'start' : 'end'
  const xAxisTickDy = isMobile ? 10 : groupBy === 'hour' ? 18 : 14
  const xAxisTickMargin = isMobile ? 14 : 16
  const chartRightMargin = isMobile ? 12 : 48
  const xAxisRightPadding = isMobile ? 8 : 32

  return (
    <ChartCard>
      <ChartCardHeader className='sm:flex-row sm:items-center sm:justify-between'>
        <div>
          <h3 className='font-semibold leading-none'>{getTitleText()}</h3>
          <p className='text-muted-foreground text-sm'>
            Number of games played over time
          </p>
        </div>
        <div className='flex flex-wrap gap-2'>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                id='date'
                variant={'outline'}
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
                onSelect={setDateRange}
                numberOfMonths={1}
              />
            </PopoverContent>
          </Popover>

          <Select
            value={groupBy}
            onValueChange={(value) => setGroupBy(value as GroupByOption)}
          >
            <SelectTrigger className='w-full sm:w-[180px]'>
              <SelectValue placeholder='Select grouping' />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value='hour'>Group by Hour</SelectItem>
              <SelectItem value='day'>Group by Day</SelectItem>
              <SelectItem value='week'>Group by Week</SelectItem>
              <SelectItem value='month'>Group by Month</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </ChartCardHeader>
      <ChartCardContent className='h-[350px] sm:h-[500px]'>
        <ChartContainer config={chartConfig} className='h-full w-full'>
          <BarChart
            data={gamesData}
            margin={{
              top: 20,
              right: chartRightMargin,
              left: 8,
              bottom: xAxisHeight,
            }}
          >
            <CartesianGrid strokeDasharray='3 3' />
            <XAxis
              dataKey='timeUnit'
              angle={xAxisAngle}
              textAnchor={xAxisTextAnchor}
              height={xAxisHeight}
              tick={{ fontSize: 12 }}
              tickMargin={xAxisTickMargin}
              dy={xAxisTickDy}
              minTickGap={16}
              interval='preserveStartEnd'
              padding={{ left: 8, right: xAxisRightPadding }}
              tickFormatter={formatXAxisTick}
            />
            <YAxis />
            <ChartTooltip
              content={
                <ChartTooltipContent formatter={(value) => `${value} games`} />
              }
            />
            <Bar dataKey='count' fill='var(--color-count)' />
          </BarChart>
        </ChartContainer>
      </ChartCardContent>
    </ChartCard>
  )
}
