import { useMemo } from 'react'
import { MatchCard } from '@/app/(home)/major-league-balatro/_components/match-card'
import { TimeZoneProvider } from '@/components/timezone-provider'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import type { BadgeProps, Match, WeekConfig } from '../types'

const WEEK_CONFIG: Record<string | number, WeekConfig> = {
  1: {
    label: 'Week 1: April 6-12, 2025',
    badgeProps: {
      variant: 'outline',
      className: 'border-green-500 bg-green-500/10 text-green-500',
      text: 'Completed',
    },
  },
  2: {
    label: 'Week 2: April 13-19, 2025',
    badgeProps: {
      variant: 'outline',
      className: 'border-blue-500 bg-blue-500/10 text-blue-500',
      text: 'Current Week',
    },
  },
  3: {
    label: 'Week 3: April 20-26, 2025',
  },
  4: {
    label: 'Week 4: April 27-May 3, 2025',
  },
  5: {
    label: 'Week 5: May 4-10, 2025',
  },
  // 'Play-in': {
  //   label: 'Play-in Week: May 11-16, 2025',
  //   status: 'playoff',
  //   badgeProps: {
  //     variant: 'outline',
  //     className: 'border-purple-500 bg-purple-500/10 text-purple-500',
  //     text: 'Playoff',
  //   },
  // },
  // Finals: {
  //   label: 'League Finals: May 17, 2025',
  //   status: 'finals',
  //   badgeProps: {
  //     variant: 'outline',
  //     className: 'border-red-500 bg-red-500/10 text-red-500',
  //     text: 'Championship',
  //   },
  // },
}

const DEFAULT_BADGE_PROPS: BadgeProps = {
  variant: 'outline',
  className: 'bg-muted text-muted-foreground',
  text: 'Upcoming',
}

type StatusBadgeProps = {
  status: 'completed' | 'current' | 'upcoming'
}

const StatusBadge = ({ status }: StatusBadgeProps) => {
  const { variant } = WEEK_CONFIG[status]?.badgeProps || DEFAULT_BADGE_PROPS

  const text =
    status === 'completed'
      ? 'Completed'
      : status === 'current'
        ? 'Current Week'
        : 'Upcoming'
  return (
    <Badge
      variant={variant}
      className={cn(
        status === 'completed'
          ? 'border-green-500 bg-green-500/10 text-green-500'
          : status === 'current'
            ? 'border-blue-500 bg-blue-500/10 text-blue-500'
            : 'bg-muted text-muted-foreground'
      )}
    >
      {text}
    </Badge>
  )
}

type WeekTabProps = {
  week: string | number
  matches: Match[]
  status: 'current' | 'completed' | 'upcoming'
}

const WeekTab = ({ week, matches, status }: WeekTabProps) => {
  const weekConfig = WEEK_CONFIG[week]
  if (!weekConfig) {
    throw new Error(`Week ${week} not found in WEEK_CONFIG`)
  }
  const filteredMatches = useMemo(
    () =>
      matches
        .filter(
          (m) => m.week === week || m.week === Number.parseInt(String(week), 10)
        )
        .sort((a, b) => (a.datetime > b.datetime ? 1 : -1)),
    [matches, week]
  )

  return (
    <TabsContent value={`week${week}`} className='space-y-6'>
      <div className='mb-4 flex items-center justify-between'>
        <h3 className='font-bold text-xl'>{weekConfig.label}</h3>
        <StatusBadge status={status} />
      </div>
      <TimeZoneProvider>
        {filteredMatches.map((match) => (
          <MatchCard key={match.id} match={match} />
        ))}
      </TimeZoneProvider>
    </TabsContent>
  )
}
type MlbScheduleProps = {
  matches: Match[]
}

export function MlbSchedule({ matches }: MlbScheduleProps) {
  const sortedMatches = useMemo(
    () =>
      [...matches].sort((a, b) => {
        if (typeof a.week === 'string' || typeof b.week === 'string') {
          return String(a.week).localeCompare(String(b.week))
        }
        return a.week - b.week
      }),
    [matches]
  )

  const currentWeek = useMemo(() => {
    const now = new Date()
    return (
      sortedMatches.find((match) => new Date(match.datetime) > now)?.week || 1
    )
  }, [sortedMatches])

  return (
    <section id='schedule' className='container py-8 md:py-12'>
      <div className='mx-auto flex max-w-[58rem] flex-col items-center space-y-4 text-center'>
        <h2 className='font-bold text-3xl leading-tight tracking-tighter md:text-4xl'>
          Tournament Schedule
        </h2>
        <p className='max-w-[85%] text-muted-foreground leading-normal sm:text-lg sm:leading-7'>
          All matches from April to May 2025
        </p>
      </div>

      <div className='mx-auto mt-8 max-w-5xl'>
        <Tabs defaultValue={`week${currentWeek}`}>
          <TabsList className='mb-4 flex flex-wrap justify-center'>
            {Object.keys(WEEK_CONFIG).map((week) => (
              <TabsTrigger key={week} value={`week${week}`}>
                Week {week}
              </TabsTrigger>
            ))}
          </TabsList>

          {Object.keys(WEEK_CONFIG).map((week) => {
            const weekNumber = Number.parseInt(week, 10)
            const status =
              !Number.isNaN(weekNumber) && weekNumber === currentWeek
                ? 'current'
                : // @ts-ignore
                  weekNumber > currentWeek
                  ? 'upcoming'
                  : 'completed'
            return (
              <WeekTab
                key={week}
                week={week}
                matches={sortedMatches}
                status={status}
              />
            )
          })}
        </Tabs>
      </div>
    </section>
  )
}
