'use client'

import { keepPreviousData } from '@tanstack/react-query'
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table'
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Loader2,
  MinusCircle,
} from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import { useFormatter, useTimeZone } from 'next-intl'
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs'
import { useCallback, useMemo, useState } from 'react'
import { PaginationControls } from '@/app/_components/pagination-controls'
import { SortableHeader } from '@/app/_components/sortable-header'
import { TableShell } from '@/app/_components/table-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { hasPermission } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import type { SelectGames } from '@/server/db/types'
import type { Season } from '@/shared/seasons'
import { api } from '@/trpc/react'

const numberFormatter = new Intl.NumberFormat('en-US', {
  signDisplay: 'exceptZero',
})

const DECK_IMAGES: Record<string, string> = {
  red: '/decks/red.png',
  blue: '/decks/blue.png',
  yellow: '/decks/yellow.png',
  green: '/decks/green.png',
  black: '/decks/black.png',
  magic: '/decks/magic.png',
  nebula: '/decks/nebula.png',
  ghost: '/decks/ghost.png',
  abandoned: '/decks/abandoned.png',
  checkered: '/decks/checkered.png',
  zodiac: '/decks/zodiac.png',
  painted: '/decks/painted.png',
  anaglyph: '/decks/anaglyph.png',
  plasma: '/decks/plasma.png',
  erratic: '/decks/erratic.png',
  challenge: '/decks/challenge.png',
  heidelberg: '/decks/heidelberg.png',
  gradient: '/decks/gradient.png',
  white: '/decks/white.png',
  violet: '/decks/violet.png',
  sibyl: '/decks/sibyl.png',
  orange: '/decks/orange.png',
  oracle: '/decks/oracle.png',
  indigo: '/decks/indigo.png',
  cocktail: '/decks/cocktail.png',
  unknown: '/decks/unknown.png',
}

const STAKE_IMAGES: Record<string, string> = {
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

const columnHelper = createColumnHelper<SelectGames>()

const DeckDisplay = ({ deck }: { deck: string | null }) => {
  const cleanDeck = deck
    ? deck.replace('Deck', '').trim().toLowerCase()
    : 'unknown'
  const imagePath = DECK_IMAGES[cleanDeck]

  if (!imagePath) {
    if (!deck) return <span>-</span>
    return (
      <Badge variant='outline' className='font-normal capitalize'>
        {deck.replace('Deck', '').trim()}
      </Badge>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className='flex w-fit items-center justify-start'>
          <Image
            src={imagePath}
            alt={deck ?? 'Unknown Deck'}
            width={20}
            height={28}
            className='h-auto w-5'
          />
        </div>
      </TooltipTrigger>
      <TooltipContent align='start' side='top' sideOffset={5}>
        <p>{deck ?? 'Unknown Deck'}</p>
      </TooltipContent>
    </Tooltip>
  )
}

const StakeDisplay = ({ stake }: { stake: string | null }) => {
  const cleanStake = stake
    ? stake.replace('Stake', '').trim().toLowerCase()
    : 'unknown'
  const imagePath = STAKE_IMAGES[cleanStake]

  if (!imagePath) {
    if (!stake) return <span>-</span>
    return (
      <Badge variant='outline' className='font-normal capitalize'>
        {stake.replace('Stake', '').trim()}
      </Badge>
    )
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className='flex w-fit items-center justify-start'>
          <Image
            src={imagePath}
            alt={stake ?? 'Unknown Stake'}
            width={24}
            height={32}
            className='h-auto w-6'
          />
        </div>
      </TooltipTrigger>
      <TooltipContent align='start' side='top' sideOffset={5}>
        <p>{stake ?? 'Unknown Stake'}</p>
      </TooltipContent>
    </Tooltip>
  )
}

// This function is now moved inside the GamesTable component
const useColumns = (openTranscriptFn?: (gameNumber: number) => void) => {
  const format = useFormatter()
  const timeZone = useTimeZone()
  const session = useSession()
  const canViewTranscript = hasPermission(
    session.data?.user,
    'transcripts.view'
  )
  return useMemo(
    () => [
      columnHelper.accessor('opponentName', {
        meta: { className: 'pl-4' },
        header: 'Opponent',
        cell: (info) => (
          <Link
            href={`/players/${info.row.original.opponentId}`}
            className='pl-4 font-medium hover:underline'
          >
            {info.getValue()}
          </Link>
        ),
      }),
      columnHelper.accessor('gameType', {
        header: 'Game Type',
        cell: (info) => {
          const gameType = info.getValue()
          return (
            <Badge
              variant='outline'
              className={cn(
                'font-normal capitalize',
                gameType === 'ranked'
                  ? 'border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-300'
                  : gameType.toLowerCase() === 'smallworld'
                    ? 'border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-800 dark:bg-cyan-950 dark:text-cyan-300'
                    : gameType.toLowerCase() === 'vanilla' ||
                        gameType.toLowerCase() === 'legacy'
                      ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
                      : gameType.toLowerCase() === 'sandbox'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : gameType.toLowerCase() === 'casual'
                          ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-300'
                          : 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-700 dark:text-zinc-300'
              )}
            >
              {info.getValue()}
            </Badge>
          )
        },
      }),
      columnHelper.accessor('deck', {
        header: 'Deck',
        cell: (info) => <DeckDisplay deck={info.getValue()} />,
      }),
      columnHelper.accessor('stake', {
        header: 'Stake',
        cell: (info) => <StakeDisplay stake={info.getValue()} />,
      }),
      columnHelper.accessor('opponentMmr', {
        header: 'Opponent MMR',
        meta: { className: 'justify-end' },
        cell: (info) => (
          <span className='flex w-full justify-end font-mono'>
            {Math.trunc(info.getValue())}
          </span>
        ),
      }),
      columnHelper.accessor('playerMmr', {
        header: 'MMR',
        meta: { className: 'justify-end' },
        cell: (info) => (
          <span className='flex w-full justify-end font-mono'>
            {Math.trunc(info.getValue())}
          </span>
        ),
      }),
      columnHelper.accessor('mmrChange', {
        header: 'Result',
        meta: { className: 'justify-end' },
        cell: (info) => {
          const mmrChange = info.getValue()
          return (
            <span
              className={cn(
                'flex items-center justify-end font-medium font-mono',
                mmrChange === 0
                  ? 'text-zink-800 dark:text-zink-200'
                  : mmrChange > 0
                    ? 'text-emerald-500'
                    : 'text-rose-500'
              )}
            >
              {numberFormatter.format(Math.trunc(mmrChange))}
              {mmrChange === 0 ? (
                <MinusCircle className='ml-1 h-4 w-4' />
              ) : mmrChange > 0 ? (
                <ArrowUpCircle className='ml-1 h-4 w-4' />
              ) : (
                <ArrowDownCircle className='ml-1 h-4 w-4' />
              )}
            </span>
          )
        },
      }),
      columnHelper.accessor('gameTime', {
        header: 'Date',
        meta: { className: 'justify-end' },
        cell: (info) => (
          <span
            className={'flex items-center justify-end font-medium font-mono'}
          >
            {format.dateTime(info.getValue(), {
              year: 'numeric',
              month: '2-digit',
              day: '2-digit',
              timeZone,
            })}
          </span>
        ),
      }),
      columnHelper.accessor('gameTime', {
        header: 'Time',
        meta: { className: 'justify-end pr-4' },
        cell: (info) => (
          <span
            className={
              'flex items-center justify-end pr-4 font-medium font-mono'
            }
          >
            {format.dateTime(info.getValue(), {
              hour: '2-digit',
              minute: '2-digit',
              timeZone,
            })}
          </span>
        ),
        id: 'time',
      }),
      columnHelper.accessor('gameId', {
        header: 'Match ID',
        meta: { className: 'justify-end' },
        cell: (info) => (
          <span className='flex w-full justify-end font-medium font-mono'>
            {info.getValue()}
          </span>
        ),
      }),
      ...(canViewTranscript
        ? [
            columnHelper.accessor('gameNum', {
              header: 'Transcript',
              meta: { className: 'pr-0' },
              cell: (info) => (
                <Button
                  size={'sm'}
                  onClick={() =>
                    openTranscriptFn ? openTranscriptFn(info.getValue()) : null
                  }
                  type={'button'}
                  variant={'ghost'}
                >
                  Transcript
                </Button>
              ),
              id: 'transcript',
            }),
          ]
        : []),
    ],
    [canViewTranscript, format.dateTime, openTranscriptFn, timeZone]
  )
}

type SortBy =
  | 'gameId'
  | 'gameTime'
  | 'opponentName'
  | 'gameType'
  | 'deck'
  | 'stake'
  | 'opponentMmr'
  | 'playerMmr'
  | 'mmrChange'

export function GamesTable({
  userId,
  season,
  leaderboardFilter,
  resultFilter,
}: {
  userId: string
  season: Season
  leaderboardFilter: string
  resultFilter: string
}) {
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [transcriptGameNumber, setTranscriptGameNumber] = useState<
    number | null
  >(null)

  // New openTranscript function that sets state instead of opening a new window
  const openTranscript = (gameNumber: number): void => {
    setTranscriptGameNumber(gameNumber)
    setIsDialogOpen(true)
  }

  // Pass the openTranscript function to useColumns
  const columns = useColumns(openTranscript)

  const pageSize = 50
  const [queryParams, setQueryParams] = useQueryStates(
    {
      page: parseAsInteger.withDefault(1),
      sortBy: parseAsString.withDefault('gameTime'),
      sortOrder: parseAsString.withDefault('desc'),
    },
    { history: 'push' }
  )

  const { page } = queryParams
  const sortBy = (
    [
      'gameId',
      'gameTime',
      'opponentName',
      'gameType',
      'deck',
      'stake',
      'opponentMmr',
      'playerMmr',
      'mmrChange',
    ] as const
  ).includes(queryParams.sortBy as SortBy)
    ? (queryParams.sortBy as SortBy)
    : 'gameTime'
  const sortOrder = (queryParams.sortOrder === 'asc' ? 'asc' : 'desc') as
    | 'asc'
    | 'desc'

  const gameType =
    leaderboardFilter === 'all'
      ? undefined
      : (leaderboardFilter as
          | 'ranked'
          | 'smallworld'
          | 'vanilla'
          | 'legacy'
          | 'sandbox'
          | 'casual')

  const result =
    resultFilter === 'wins'
      ? 'win'
      : resultFilter === 'losses'
        ? 'loss'
        : undefined

  const gamesQ = api.history.user_games_page.useQuery(
    {
      user_id: userId,
      season,
      gameType,
      result,
      page,
      pageSize,
      sortBy,
      sortOrder,
    },
    {
      refetchOnWindowFocus: false,
      placeholderData: keepPreviousData,
      staleTime: 30_000,
    }
  )
  const games = gamesQ.data?.data ?? []

  const handleSort = useCallback(
    (column: string) => {
      const nextOrder =
        sortBy === column && sortOrder === 'asc' ? 'desc' : 'asc'
      setQueryParams({ sortBy: column, sortOrder: nextOrder, page: 1 })
    },
    [setQueryParams, sortBy, sortOrder]
  )

  const table = useReactTable({
    data: games,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (originalRow) => originalRow.gameNum.toString(),
  })

  return (
    <TooltipProvider>
      <TableShell className='relative overflow-hidden'>
        <div className='overflow-x-auto'>
          <Table>
            <TableHeader className='sticky top-0 z-10 bg-background'>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className='bg-muted/50'>
                  {headerGroup.headers.map((header) => {
                    const meta = header.column.columnDef.meta as
                      | { className?: string }
                      | undefined
                    const metaClass = meta?.className
                    const isRight = metaClass?.includes('justify-end')
                    const colId = header.column.id
                    const label = flexRender(
                      header.column.columnDef.header,
                      header.getContext()
                    )

                    return (
                      <TableHead key={header.id} className='px-0'>
                        <span
                          className={cn('flex w-full items-center', metaClass)}
                        >
                          {colId === 'transcript' ||
                          typeof label !== 'string' ? (
                            <span
                              className={cn(
                                'px-4 py-2 text-sm',
                                isRight && 'ml-auto'
                              )}
                            >
                              {label}
                            </span>
                          ) : (
                            <SortableHeader
                              className={cn(
                                'px-4 py-2 text-sm',
                                isRight && 'ml-auto justify-end'
                              )}
                              column={colId}
                              label={label}
                              sortBy={sortBy}
                              sortOrder={sortOrder}
                              onSort={handleSort}
                            />
                          )}
                        </span>
                      </TableHead>
                    )
                  })}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={table.getAllColumns().length}>
                    No games
                  </TableCell>
                </TableRow>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <span
          className={cn(
            'pointer-events-none absolute top-3 right-3 inline-flex items-center gap-2 rounded-md border bg-background px-2 py-1 text-muted-foreground text-xs transition-opacity',
            gamesQ.isFetching ? 'opacity-100' : 'opacity-0'
          )}
        >
          <Loader2 className='h-3 w-3 animate-spin' />
          Updating
        </span>

        <PaginationControls
          currentPage={page}
          totalPages={gamesQ.data?.totalPages ?? 1}
          total={gamesQ.data?.total ?? 0}
          pageSize={pageSize}
          itemLabel='games'
          onPageChange={(p) => setQueryParams({ page: p })}
          className='rounded-none border-0 border-t bg-background'
        />
      </TableShell>

      {/* Transcript Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className='max-h-[80vh] w-full overflow-y-auto sm:max-w-[calc(100%-2rem)]'>
          <DialogHeader>
            <div className='flex items-center justify-between'>
              <DialogTitle>
                {transcriptGameNumber
                  ? `Game Transcript #${transcriptGameNumber}`
                  : 'Game Transcript'}
              </DialogTitle>
              {transcriptGameNumber && (
                <Button variant='outline' size='sm' asChild className={'mr-10'}>
                  <Link
                    href={`/transcript/${transcriptGameNumber}`}
                    target='_blank'
                    rel='noopener noreferrer'
                  >
                    Open in New Page
                  </Link>
                </Button>
              )}
            </div>
          </DialogHeader>
          {/* Use iframe to isolate the transcript content and render HTML properly */}
          <div className='mt-4 h-[60vh] w-full'>
            {transcriptGameNumber && (
              <iframe
                src={`/api/transcript/${transcriptGameNumber}`}
                className='h-full w-full rounded border-0'
                title={`Game Transcript #${transcriptGameNumber}`}
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  )
}
