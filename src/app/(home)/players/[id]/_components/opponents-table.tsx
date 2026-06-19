'use client'

import { ArrowDownCircle, ArrowUpCircle, MinusCircle } from 'lucide-react'
import Link from 'next/link'
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs'
import { memo, useCallback } from 'react'
import { PaginationControls } from '@/app/_components/pagination-controls'
import { SortableHeader } from '@/app/_components/sortable-header'
import { TableShell } from '@/app/_components/table-shell'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn } from '@/lib/utils'
import type { Season } from '@/shared/seasons'
import { api } from '@/trpc/react'

const numberFormatter = new Intl.NumberFormat('en-US', {
  signDisplay: 'exceptZero',
})

type SortBy =
  | 'opponentName'
  | 'totalGames'
  | 'wins'
  | 'losses'
  | 'winRate'
  | 'totalMMRChange'

type OpponentRow = {
  opponentId: string
  opponentName: string
  totalGames: number
  wins: number
  losses: number
  winRate: number | null
  totalMMRChange: number
}

function RawOpponentsTable({
  userId,
  season,
  gameType,
  result,
}: {
  userId: string
  season: Season
  gameType?:
    | 'ranked'
    | 'smallworld'
    | 'vanilla'
    | 'legacy'
    | 'sandbox'
    | 'casual'
  result?: 'win' | 'loss'
}) {
  const pageSize = 50
  const [queryParams, setQueryParams] = useQueryStates(
    {
      page: parseAsInteger.withDefault(1),
      sortBy: parseAsString.withDefault('totalGames'),
      sortOrder: parseAsString.withDefault('desc'),
    },
    { history: 'push' }
  )

  const { page } = queryParams
  const sortBy = (
    [
      'opponentName',
      'totalGames',
      'wins',
      'losses',
      'winRate',
      'totalMMRChange',
    ] as const
  ).includes(queryParams.sortBy as SortBy)
    ? (queryParams.sortBy as SortBy)
    : 'totalGames'
  const sortOrder = (queryParams.sortOrder === 'asc' ? 'asc' : 'desc') as
    | 'asc'
    | 'desc'

  const opponentsQ = api.history.user_opponents_stats_page.useQuery(
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
    { refetchOnWindowFocus: false }
  )

  const rows: OpponentRow[] = opponentsQ.data?.data ?? []

  const handleSort = useCallback(
    (column: string) => {
      const nextOrder =
        sortBy === column && sortOrder === 'asc' ? 'desc' : 'asc'
      setQueryParams({ sortBy: column, sortOrder: nextOrder, page: 1 })
    },
    [setQueryParams, sortBy, sortOrder]
  )

  return (
    <TableShell className='overflow-hidden'>
      <div className='overflow-x-auto'>
        <Table>
          <TableHeader className='sticky top-0 z-10 bg-background'>
            <TableRow className='bg-muted/50'>
              <TableHead>
                <SortableHeader
                  column='opponentName'
                  label='Opponent'
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className='text-right'>
                <SortableHeader
                  className='w-full justify-end'
                  column='totalGames'
                  label='Games Played'
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className='text-right'>
                <SortableHeader
                  className='w-full justify-end'
                  column='wins'
                  label='Wins'
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className='text-right'>
                <SortableHeader
                  className='w-full justify-end'
                  column='losses'
                  label='Losses'
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className='text-right'>
                <SortableHeader
                  className='w-full justify-end'
                  column='winRate'
                  label='Win rate'
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
              </TableHead>
              <TableHead className='text-right'>
                <SortableHeader
                  className='w-full justify-end'
                  column='totalMMRChange'
                  label='Total MMR change'
                  sortBy={sortBy}
                  sortOrder={sortOrder}
                  onSort={handleSort}
                />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {opponentsQ.isLoading ? (
              <TableRow>
                <TableCell colSpan={6}>Loading...</TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6}>No opponents</TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.opponentId}>
                  <TableCell>
                    <Link
                      href={`/players/${row.opponentId}`}
                      className='font-medium hover:underline'
                    >
                      {row.opponentName}
                    </Link>
                  </TableCell>
                  <TableCell className='text-right font-mono'>
                    {row.totalGames}
                  </TableCell>
                  <TableCell className='text-right font-mono text-emerald-600 dark:text-emerald-400'>
                    {row.wins}
                  </TableCell>
                  <TableCell className='text-right font-mono text-rose-600 dark:text-rose-400'>
                    {row.losses}
                  </TableCell>
                  <TableCell className='text-right font-mono'>
                    <span
                      className={cn(
                        row.winRate === null
                          ? 'text-muted-foreground'
                          : row.winRate === 50
                            ? 'text-zink-800 dark:text-zink-200'
                            : row.winRate > 50
                              ? 'text-emerald-500'
                              : 'text-rose-500'
                      )}
                    >
                      {row.winRate !== null
                        ? `${Math.round(row.winRate)}%`
                        : 'N/A'}
                    </span>
                  </TableCell>
                  <TableCell className='text-right font-mono'>
                    <span
                      className={cn(
                        'inline-flex items-center justify-end font-medium font-mono',
                        row.totalMMRChange === 0
                          ? 'text-zink-800 dark:text-zink-200'
                          : row.totalMMRChange > 0
                            ? 'text-emerald-500'
                            : 'text-rose-500'
                      )}
                    >
                      {numberFormatter.format(Math.trunc(row.totalMMRChange))}
                      {row.totalMMRChange === 0 ? (
                        <MinusCircle className='ml-1 h-4 w-4' />
                      ) : row.totalMMRChange > 0 ? (
                        <ArrowUpCircle className='ml-1 h-4 w-4' />
                      ) : (
                        <ArrowDownCircle className='ml-1 h-4 w-4' />
                      )}
                    </span>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {!opponentsQ.isLoading && (
        <PaginationControls
          currentPage={page}
          totalPages={opponentsQ.data?.totalPages ?? 1}
          total={opponentsQ.data?.total ?? 0}
          pageSize={pageSize}
          itemLabel='opponents'
          onPageChange={(p) => setQueryParams({ page: p })}
          className='rounded-none border-0 border-t bg-background'
        />
      )}
    </TableShell>
  )
}

export const OpponentsTable = memo(RawOpponentsTable)
OpponentsTable.displayName = 'OpponentsTable'
