'use client'

import { keepPreviousData } from '@tanstack/react-query'
import {
  ArrowDown,
  ArrowUp,
  Flame,
  ListFilter,
  Search,
  TrendingUp,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs'
import type React from 'react'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDebounceCallback } from 'usehooks-ts'
import { PaginationControls } from '@/app/_components/pagination-controls'
import { SortableHeader } from '@/app/_components/sortable-header'
import { TableShell } from '@/app/_components/table-shell'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/mobile-tooltip'
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
import { Slider } from '@/components/ui/slider'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { getRankData } from '@/shared/ranks'
import {
  getSeasonDisplayName,
  type Season,
  SeasonSchema,
} from '@/shared/seasons'
import { api, type RouterOutputs } from '@/trpc/react'

type LeaderboardSortBy =
  | 'rank'
  | 'mmr'
  | 'wins'
  | 'losses'
  | 'winrate'
  | 'totalgames'
  | 'streak'
  | 'peak_mmr'
  | 'peak_streak'

const getMedal = (rank: number, mmr: number, queueType?: string) => {
  const rankData = getRankData(mmr, queueType)
  if (!rankData) {
    return null
  }

  const { enhancement, tooltip } = rankData

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className='flex shrink-0 items-center justify-center gap-1.5'>
            <Image
              src={enhancement}
              alt={`Rank ${rank}`}
              width={20}
              height={20}
              className='h-5 w-auto text-white'
              unoptimized
            />
          </span>
        </TooltipTrigger>
        <TooltipContent>
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

type LeaderboardSeasonRow = RouterOutputs['seasons']['list'][number]
type LeaderboardSnapshotRow = RouterOutputs['seasons']['list_snapshots'][number]

type LeaderboardPageProps = {
  activeSeason: Season
  initialSeason: Season
  initialSeasons: RouterOutputs['seasons']['list']
  initialSnapshots: RouterOutputs['seasons']['list_snapshots']
}

function getSeasonId(season: Season): number {
  const match = /^season(\d+)$/.exec(season)
  return Number(match?.[1] ?? 0)
}

function getDefaultQueueType(snapshots: LeaderboardSnapshotRow[]): string {
  return snapshots[0]?.queueType ?? 'ranked'
}

function getQueueLabel(queueType: string): string {
  if (queueType === 'ranked') return 'Standard Ranked'
  if (queueType === 'smallworld') return 'Smallworld'
  if (queueType === 'vanilla') return 'Vanilla'
  if (queueType === 'legacy') return 'Legacy Ranked'

  return queueType
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function sortSeasons(seasons: LeaderboardSeasonRow[]) {
  return [...seasons].sort((a, b) => b.id - a.id)
}

function clampGamesRange(
  value: [number, number],
  max: number
): [number, number] {
  const upperBound = Math.max(max, 0)
  const min = Math.min(Math.max(value[0] ?? 0, 0), upperBound)
  const nextMax = Math.min(Math.max(value[1] ?? upperBound, min), upperBound)
  return [min, nextMax]
}

export function LeaderboardPage({
  activeSeason,
  initialSeason,
  initialSeasons,
  initialSnapshots,
}: LeaderboardPageProps) {
  const [queryParams, setQueryParams] = useQueryStates(
    {
      type: parseAsString.withDefault(getDefaultQueueType(initialSnapshots)),
      season: parseAsString.withDefault(initialSeason),
      page: parseAsInteger.withDefault(1),
      search: parseAsString,
      minGames: parseAsInteger,
      maxGames: parseAsInteger,
      sortBy: parseAsString,
      sortOrder: parseAsString,
    },
    {
      history: 'push',
    }
  )

  const {
    type: rawType,
    season: rawSeason,
    page,
    search: searchQuery,
    minGames,
    maxGames,
    sortBy,
    sortOrder,
  } = queryParams

  const seasonsQuery = api.seasons.list.useQuery(undefined, {
    initialData: initialSeasons,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  })
  const seasons = useMemo(
    () => sortSeasons(seasonsQuery.data ?? initialSeasons),
    [initialSeasons, seasonsQuery.data]
  )
  const availableSeasons = useMemo(
    () => new Set(seasons.map((entry) => `season${entry.id}`)),
    [seasons]
  )

  const latestSeason = ((seasons[0] && `season${seasons[0].id}`) ||
    activeSeason) as Season
  const season = useMemo(() => {
    if (
      SeasonSchema.safeParse(rawSeason).success &&
      availableSeasons.has(rawSeason)
    ) {
      return rawSeason as Season
    }

    return availableSeasons.has(initialSeason) ? initialSeason : latestSeason
  }, [availableSeasons, initialSeason, latestSeason, rawSeason])
  const seasonId = getSeasonId(season)

  const snapshotsQuery = api.seasons.list_snapshots.useQuery(
    { seasonId },
    {
      enabled: seasonId > 0,
      initialData: season === initialSeason ? initialSnapshots : undefined,
      placeholderData: keepPreviousData,
      staleTime: 30_000,
    }
  )
  const snapshots = useMemo(() => {
    if (snapshotsQuery.data) return snapshotsQuery.data
    if (season === initialSeason) return initialSnapshots
    return []
  }, [initialSeason, initialSnapshots, season, snapshotsQuery.data])

  const leaderboardType = useMemo(() => {
    if (snapshots.some((snapshot) => snapshot.queueType === rawType)) {
      return rawType
    }

    return getDefaultQueueType(snapshots)
  }, [rawType, snapshots])

  const selectedSnapshot = useMemo(
    () =>
      snapshots.find((snapshot) => snapshot.queueType === leaderboardType) ??
      snapshots[0],
    [leaderboardType, snapshots]
  )

  // Derive sort column and direction from query params with defaults
  const sortColumn = sortBy || 'mmr'
  const sortDirection = (sortOrder as 'asc' | 'desc') || 'desc'

  // Track previous season to only reset sort when season actually changes
  const prevSeasonRef = useRef(season)

  useEffect(() => {
    const seasonChanged = prevSeasonRef.current !== season
    prevSeasonRef.current = season

    // Only reset sort if season actually changed AND user hasn't explicitly set a sort
    if (seasonChanged && !sortBy) {
      setQueryParams({ sortBy: 'mmr', sortOrder: 'desc' })
    }
  }, [season, sortBy, setQueryParams])

  useEffect(() => {
    if (rawSeason === season && rawType === leaderboardType) {
      return
    }

    setQueryParams({
      season,
      type: leaderboardType,
      page: 1,
    })
  }, [leaderboardType, rawSeason, rawType, season, setQueryParams])

  const currentLeaderboardQuery = api.leaderboard.get_leaderboard.useQuery(
    {
      channel_id: selectedSnapshot?.queueId ?? '',
      season,
      page,
      pageSize: 50,
      search: searchQuery || undefined,
      minGames: minGames ?? undefined,
      maxGames: maxGames ?? undefined,
      sortBy: sortColumn as LeaderboardSortBy,
      sortOrder: sortDirection,
    },
    {
      enabled: Boolean(selectedSnapshot?.queueId),
      placeholderData: keepPreviousData,
      staleTime: 30_000,
    }
  )

  const currentLeaderboardResult = currentLeaderboardQuery.data
  const currentLeaderboard = currentLeaderboardResult?.data ?? []
  const sliderMax = currentLeaderboardResult
    ? currentLeaderboardResult.gamesRange.max
    : Math.max(minGames ?? 0, maxGames ?? 0, 0)
  const normalizedGamesRange = useMemo(
    () => clampGamesRange([minGames ?? 0, maxGames ?? sliderMax], sliderMax),
    [maxGames, minGames, sliderMax]
  )

  const isNonDefaultSeason = season !== latestSeason
  const isGamesFiltered =
    (minGames ?? 0) > 0 || (maxGames != null && maxGames !== sliderMax)
  const hasActiveFilters = isNonDefaultSeason || isGamesFiltered
  const activeFilterCount =
    (isNonDefaultSeason ? 1 : 0) + (isGamesFiltered ? 1 : 0)

  // Handle tab change
  const handleTabChange = (value: string) => {
    setQueryParams({ type: value, page: 1 })
  }

  // Handle season change
  const handleSeasonChange = (value: Season) => {
    setQueryParams({ season: value, page: 1 })
  }

  const updateSearch = useDebounceCallback((nextSearch: string) => {
    setQueryParams({ search: nextSearch || null, page: 1 })
  }, 500)

  const [sliderValue, setSliderValue] =
    useState<[number, number]>(normalizedGamesRange)

  useEffect(() => {
    setSliderValue((current) => {
      if (
        current[0] === normalizedGamesRange[0] &&
        current[1] === normalizedGamesRange[1]
      ) {
        return current
      }

      return normalizedGamesRange
    })
  }, [normalizedGamesRange])

  useEffect(() => {
    const [nextMin, nextMax] = normalizedGamesRange
    const normalizedMinParam = nextMin > 0 ? nextMin : null
    const normalizedMaxParam = nextMax !== sliderMax ? nextMax : null

    if (
      (minGames ?? null) === normalizedMinParam &&
      (maxGames ?? null) === normalizedMaxParam
    ) {
      return
    }

    setQueryParams({
      minGames: normalizedMinParam,
      maxGames: normalizedMaxParam,
      page: 1,
    })
  }, [maxGames, minGames, normalizedGamesRange, setQueryParams, sliderMax])

  const handleGamesAmountSliderChange = (value: number[]) => {
    setSliderValue(
      clampGamesRange([value[0] ?? 0, value[1] ?? sliderMax], sliderMax)
    )
  }
  const handleGamesAmountSliderCommit = (value: number[]) => {
    const [nextMin, nextMax] = clampGamesRange(
      [value[0] ?? 0, value[1] ?? sliderMax],
      sliderMax
    )
    setQueryParams({
      minGames: nextMin > 0 ? nextMin : null,
      maxGames: nextMax !== sliderMax ? nextMax : null,
      page: 1,
    })
  }

  // Handle column sort
  const handleSort = useCallback(
    (column: string) => {
      const allowed: LeaderboardSortBy[] = [
        'rank',
        'mmr',
        'wins',
        'losses',
        'winrate',
        'totalgames',
        'streak',
        'peak_mmr',
        'peak_streak',
      ]
      if (!allowed.includes(column as LeaderboardSortBy)) return

      const nextOrder =
        sortColumn === column && sortDirection === 'asc' ? 'desc' : 'asc'
      setQueryParams({ sortBy: column, sortOrder: nextOrder, page: 1 })
    },
    [setQueryParams, sortColumn, sortDirection]
  )

  // Handle page change
  const handlePageChange = useCallback(
    (newPage: number) => {
      setQueryParams({ page: newPage })
    },
    [setQueryParams]
  )

  return (
    <div className='flex flex-1 flex-col overflow-hidden'>
      <div className='mx-auto flex w-[calc(100%-1rem)] max-w-fd-container flex-1 flex-col'>
        <div className='flex flex-1 flex-col overflow-hidden border-none'>
          {currentLeaderboardResult?.isStale && (
            <Alert className='my-4 border-amber-500 bg-amber-50 text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300'>
              <AlertTitle>Stale Data</AlertTitle>
              <AlertDescription>
                The leaderboard data is currently stale due to issues with the
                botlatro service. We're showing you the latest available data.
                Please check back later.
              </AlertDescription>
            </Alert>
          )}
          <Tabs
            defaultValue={leaderboardType}
            value={leaderboardType}
            onValueChange={handleTabChange}
            className='flex flex-1 flex-col py-4 md:py-6'
          >
            <div className='mb-4 flex w-full flex-col gap-3 md:mb-6'>
              <TabsList className='w-full border border-gray-200 bg-gray-50 md:hidden dark:border-zinc-800 dark:bg-zinc-800/50'>
                {snapshots.map((snapshot) => (
                  <TabsTrigger
                    key={snapshot.queueType}
                    value={snapshot.queueType}
                    className='flex-1 whitespace-nowrap text-xs'
                  >
                    {getQueueLabel(snapshot.queueType)}
                  </TabsTrigger>
                ))}
              </TabsList>

              <div className='flex items-center gap-2'>
                <TabsList className='hidden border border-gray-200 bg-gray-50 md:inline-flex dark:border-zinc-800 dark:bg-zinc-800/50'>
                  {snapshots.map((snapshot) => (
                    <TabsTrigger
                      key={snapshot.queueType}
                      value={snapshot.queueType}
                      className='whitespace-nowrap text-sm'
                    >
                      {getQueueLabel(snapshot.queueType)}
                    </TabsTrigger>
                  ))}
                </TabsList>
                <div className='relative min-w-0 flex-1'>
                  <Search className='absolute top-2.5 left-2.5 h-4 w-4 text-muted-foreground' />
                  <Input
                    key={searchQuery ?? ''}
                    placeholder='Search players...'
                    className='border-gray-200 bg-white pl-9 dark:border-zinc-700 dark:bg-zinc-900'
                    defaultValue={searchQuery ?? ''}
                    onChange={(e) => updateSearch(e.target.value)}
                  />
                </div>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant='outline' className='shrink-0 gap-1.5'>
                      <ListFilter className='h-4 w-4' />
                      <span className='hidden sm:inline'>Filters</span>
                      {hasActiveFilters && (
                        <span className='flex h-4 min-w-4 items-center justify-center rounded-full bg-violet-500 px-1 font-medium text-[10px] text-white'>
                          {activeFilterCount}
                        </span>
                      )}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent align='end' className='w-72 space-y-4'>
                    <div className='space-y-1.5'>
                      <Label className='font-medium text-muted-foreground text-xs'>
                        Season
                      </Label>
                      <Select
                        value={season}
                        onValueChange={(value) =>
                          handleSeasonChange(value as Season)
                        }
                      >
                        <SelectTrigger className='w-full'>
                          <SelectValue placeholder='Select season' />
                        </SelectTrigger>
                        <SelectContent>
                          {seasons.map((seasonOption) => {
                            const value = `season${seasonOption.id}` as Season
                            return (
                              <SelectItem key={value} value={value}>
                                {getSeasonDisplayName(value)}
                              </SelectItem>
                            )
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className='space-y-1.5'>
                      <Label className='font-medium text-muted-foreground text-xs'>
                        Games played
                      </Label>
                      <Slider
                        value={sliderValue}
                        onValueCommit={handleGamesAmountSliderCommit}
                        max={sliderMax}
                        onValueChange={handleGamesAmountSliderChange}
                        step={1}
                      />
                      <div className='flex justify-between text-muted-foreground text-xs tabular-nums'>
                        <span>{sliderValue[0]}</span>
                        <span>{sliderValue[1]}</span>
                      </div>
                    </div>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className='m-0 flex flex-1 flex-col'>
              {!selectedSnapshot ? (
                <TableShell className='flex flex-1 flex-col overflow-hidden'>
                  <div className='flex min-h-[240px] items-center justify-center px-6 text-center text-fd-muted-foreground'>
                    No queues configured for this season yet.
                  </div>
                </TableShell>
              ) : currentLeaderboardQuery.isLoading &&
                !currentLeaderboardResult ? (
                <TableShell className='flex flex-1 flex-col overflow-hidden'>
                  <div className='flex min-h-[240px] items-center justify-center px-6 text-center text-fd-muted-foreground'>
                    Loading leaderboard...
                  </div>
                </TableShell>
              ) : (
                <>
                  {/* Mobile card layout */}
                  <div className='flex flex-col gap-2 md:hidden'>
                    {currentLeaderboard.length > 0 ? (
                      currentLeaderboard.map((entry) => (
                        <LeaderboardCard
                          key={entry.id}
                          entry={entry}
                          queueType={leaderboardType}
                        />
                      ))
                    ) : (
                      <div className='rounded-lg border bg-background py-12 text-center text-muted-foreground'>
                        No players found
                      </div>
                    )}
                  </div>

                  {/* Desktop table layout */}
                  <TableShell className='hidden flex-1 flex-col overflow-hidden md:flex'>
                    <div className='overflow-x-auto'>
                      <LeaderboardTable
                        leaderboard={currentLeaderboard}
                        queueType={leaderboardType}
                        sortColumn={sortColumn as LeaderboardSortBy}
                        sortDirection={sortDirection}
                        onSort={handleSort}
                        getMedal={getMedal}
                      />
                    </div>
                  </TableShell>

                  {(currentLeaderboardResult?.totalPages ?? 1) > 1 && (
                    <PaginationControls
                      currentPage={page}
                      totalPages={currentLeaderboardResult?.totalPages ?? 1}
                      total={currentLeaderboardResult?.total ?? 0}
                      pageSize={50}
                      itemLabel='players'
                      onPageChange={handlePageChange}
                      className='mt-2 rounded-lg border md:mt-0 md:rounded-none md:rounded-b-lg md:border-0 md:border-t'
                    />
                  )}
                </>
              )}
            </div>
          </Tabs>
        </div>
      </div>
    </div>
  )
}

function LeaderboardCard({
  entry,
  queueType,
}: {
  entry: LeaderboardRow
  queueType: string
}) {
  const winrate = entry.winrate * 100

  return (
    <Link
      prefetch={false}
      href={`/players/${entry.id}`}
      className='group rounded-lg border bg-background p-3 transition-colors active:bg-muted/50'
    >
      <div className='flex items-center justify-between gap-3'>
        <div className='flex min-w-0 items-center gap-2.5'>
          <div className='flex shrink-0 items-center gap-1.5'>
            <span className='w-6 text-right font-medium text-muted-foreground text-sm tabular-nums'>
              {entry.rank}
            </span>
            {getMedal(entry.rank, entry.mmr, queueType)}
          </div>
          <span className='truncate font-medium group-hover:underline'>
            {entry.name}
          </span>
          {entry.streak >= 3 && (
            <Badge className='shrink-0 bg-orange-500 text-white'>
              <Flame className='h-3 w-3' />
            </Badge>
          )}
        </div>
        <span className='shrink-0 text-right font-semibold text-lg tabular-nums'>
          {Math.round(entry.mmr)}
        </span>
      </div>
      <div className='mt-2 flex items-center gap-3 text-muted-foreground text-xs'>
        <Badge
          variant='outline'
          className={cn(
            'font-normal text-[10px]',
            winrate > 60
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
              : winrate < 40
                ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300'
                : ''
          )}
        >
          {Math.round(winrate)}% WR
        </Badge>
        <span>
          <span className='text-emerald-600 dark:text-emerald-400'>
            {entry.wins}W
          </span>{' '}
          <span className='text-rose-600 dark:text-rose-400'>
            {entry.losses}L
          </span>
        </span>
        <span className='tabular-nums'>{entry.totalgames}G</span>
        {entry.streak !== 0 && (
          <span
            className={cn(
              'flex items-center tabular-nums',
              entry.streak > 0
                ? 'text-emerald-600 dark:text-emerald-400'
                : 'text-rose-600 dark:text-rose-400'
            )}
          >
            {entry.streak > 0 ? (
              <ArrowUp className='mr-0.5 h-3 w-3' />
            ) : (
              <ArrowDown className='mr-0.5 h-3 w-3' />
            )}
            {Math.abs(entry.streak)}
          </span>
        )}
      </div>
    </Link>
  )
}

interface LeaderboardTableProps {
  leaderboard: LeaderboardRow[]
  sortColumn: LeaderboardSortBy
  queueType: string
  sortDirection: 'asc' | 'desc'
  onSort: (column: string) => void
  getMedal: (rank: number, mmr: number, queueType?: string) => React.ReactNode
}

type LeaderboardRow = {
  id: string
  rank: number
  name: string
  mmr: number
  peak_mmr: number
  winrate: number
  wins: number
  losses: number
  totalgames: number
  streak: number
  peak_streak: number
}

function RawLeaderboardTable({
  leaderboard,
  queueType,
  sortColumn,
  sortDirection,
  onSort,
  getMedal,
}: LeaderboardTableProps) {
  return (
    <Table>
      <TableHeader className='sticky top-0 z-10 bg-background'>
        <TableRow className='bg-muted/50'>
          <TableHead className='w-[40px] text-right'>#</TableHead>
          <TableHead className='w-[80px]'>
            <SortableHeader
              className='w-full justify-end'
              column='rank'
              label='Rank'
              sortBy={sortColumn}
              sortOrder={sortDirection}
              onSort={onSort}
            />
          </TableHead>
          <TableHead>
            <SortableHeader
              column='name'
              label='Player'
              sortBy={sortColumn}
              sortOrder={sortDirection}
              onSort={onSort}
            />
          </TableHead>
          <TableHead className='text-right'>
            <SortableHeader
              className='w-full justify-end'
              column='mmr'
              label='MMR'
              sortBy={sortColumn}
              sortOrder={sortDirection}
              onSort={onSort}
            />
          </TableHead>
          <TableHead
            className='hidden text-right xl:table-cell'
            align={'right'}
          >
            <SortableHeader
              className='w-full justify-end'
              column='peak_mmr'
              label='Peak MMR'
              sortBy={sortColumn}
              sortOrder={sortDirection}
              onSort={onSort}
            />
          </TableHead>
          <TableHead className='text-right'>
            <SortableHeader
              className='w-full justify-end'
              column='winrate'
              label='Win Rate'
              sortBy={sortColumn}
              sortOrder={sortDirection}
              onSort={onSort}
            />
          </TableHead>
          <TableHead className='text-right'>
            <SortableHeader
              className='w-full justify-end'
              column='wins'
              label='Wins'
              sortBy={sortColumn}
              sortOrder={sortDirection}
              onSort={onSort}
            />
          </TableHead>
          <TableHead className='hidden text-right lg:table-cell'>
            <SortableHeader
              className='w-full justify-end'
              column='losses'
              label='Losses'
              sortBy={sortColumn}
              sortOrder={sortDirection}
              onSort={onSort}
            />
          </TableHead>
          <TableHead className='text-right'>
            <SortableHeader
              className='w-full justify-end'
              column='totalgames'
              label='Games'
              sortBy={sortColumn}
              sortOrder={sortDirection}
              onSort={onSort}
            />
          </TableHead>
          <TableHead className='text-right'>
            <SortableHeader
              className='w-full justify-end'
              column='streak'
              label='Streak'
              sortBy={sortColumn}
              sortOrder={sortDirection}
              onSort={onSort}
            />
          </TableHead>
          <TableHead className='hidden text-right xl:table-cell'>
            <SortableHeader
              className='w-full justify-end'
              column='peak_streak'
              label='Peak Streak'
              sortBy={sortColumn}
              sortOrder={sortDirection}
              onSort={onSort}
            />
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {leaderboard.length > 0 ? (
          leaderboard.map((entry, index) => {
            const winrate = entry.winrate * 100
            return (
              <TableRow key={entry.id}>
                <TableCell className='w-10 text-right font-medium'>
                  {index + 1}
                </TableCell>
                <TableCell className='w-28 font-medium'>
                  <div className='flex items-center justify-end gap-1.5 pr-4.5 font-mono'>
                    <span className={cn(entry.rank < 10 && 'ml-[1ch]')}>
                      {entry.rank}
                    </span>
                    {getMedal(entry.rank, entry.mmr, queueType)}
                  </div>
                </TableCell>
                <TableCell>
                  <Link
                    prefetch={false}
                    href={`/players/${entry.id}`}
                    className='group flex items-center gap-2'
                  >
                    <span className='font-medium group-hover:underline'>
                      {entry.name}
                    </span>
                    {entry.streak >= 3 && (
                      <Badge className='bg-orange-500 text-white hover:no-underline'>
                        <Flame className='h-3 w-3' />
                      </Badge>
                    )}
                  </Link>
                </TableCell>
                <TableCell className='pr-7 text-right font-medium font-mono'>
                  {Math.round(entry.mmr)}
                </TableCell>
                <TableCell className='hidden text-right font-mono xl:table-cell'>
                  <div className='flex items-center justify-end gap-1'>
                    {Math.round(entry.peak_mmr)}
                    <TrendingUp className='h-3.5 w-3.5 text-violet-400' />
                  </div>
                </TableCell>
                <TableCell className='text-right'>
                  <Badge
                    variant='outline'
                    className={cn(
                      'font-normal',
                      winrate > 60
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : winrate < 40
                          ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300'
                          : 'border-gray-200 bg-gray-50 text-gray-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                    )}
                  >
                    {Math.round(winrate)}%
                  </Badge>
                </TableCell>
                <TableCell className='text-right text-emerald-600 dark:text-emerald-400'>
                  {entry.wins}
                </TableCell>
                <TableCell className='hidden text-right text-rose-600 lg:table-cell dark:text-rose-400'>
                  {entry.losses}
                </TableCell>
                <TableCell className='text-right font-mono text-slate-600 dark:text-slate-400'>
                  {entry.totalgames}
                </TableCell>
                <TableCell className='text-right font-mono'>
                  {entry.streak > 0 ? (
                    <span className='flex items-center justify-end text-emerald-600 dark:text-emerald-400'>
                      <ArrowUp className='mr-1 h-3.5 w-3.5' />
                      {entry.streak}
                    </span>
                  ) : entry.streak < 0 ? (
                    <span className='flex items-center justify-end font-mono text-rose-600 dark:text-rose-400'>
                      <ArrowDown className='mr-1 h-3.5 w-3.5' />
                      <span className={'w-[2ch]'}>
                        {Math.abs(entry.streak)}
                      </span>
                    </span>
                  ) : (
                    <span>0</span>
                  )}
                </TableCell>
                <TableCell className='hidden text-right xl:table-cell'>
                  <span className='flex items-center justify-end font-mono'>
                    {entry.peak_streak}
                  </span>
                </TableCell>
              </TableRow>
            )
          })
        ) : (
          <TableRow>
            <TableCell colSpan={99} className='h-24 text-center'>
              <p className='text-gray-500 dark:text-zinc-400'>
                No players found
              </p>
            </TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}

export const LeaderboardTable = memo(RawLeaderboardTable)
LeaderboardTable.displayName = 'LeaderboardTable'
