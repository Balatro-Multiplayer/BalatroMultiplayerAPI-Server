'use client'

import { ExternalLink, SlidersHorizontal } from 'lucide-react'
import Link from 'next/link'
import { useFormatter, useTimeZone } from 'next-intl'
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs'
import type { ReactNode } from 'react'
import {
  startTransition,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { useLocalStorage } from 'usehooks-ts'
import { PaginationControls } from '@/app/_components/pagination-controls'
import { SortableHeader } from '@/app/_components/sortable-header'
import { TableShell } from '@/app/_components/table-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { SelectGame } from '@/server/db/types'

type GameRecord = Omit<SelectGame, 'startDate' | 'endDate' | 'createdAt'> & {
  startDate: string
  endDate: string | null
  createdAt: string
}

type GamesResponse = {
  data: GameRecord[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  availableDecks: string[]
  availableRulesets: string[]
}

type SortBy =
  | 'host'
  | 'guest'
  | 'deck'
  | 'stake'
  | 'durationSeconds'
  | 'startDate'
  | 'moneySpent'
  | 'rerolls'

const PAGE_SIZE = 50
const STAKE_NAMES: Record<number, string> = {
  1: 'White Stake',
  2: 'Red Stake',
  3: 'Green Stake',
  4: 'Black Stake',
  5: 'Blue Stake',
  6: 'Purple Stake',
  7: 'Orange Stake',
  8: 'Gold Stake',
}
const ALL_COLUMN_IDS = [
  'host',
  'guest',
  'logOwner',
  'opponent',
  'winner',
  'isHost',
  'deck',
  'seed',
  'stake',
  'ruleset',
  'duration',
  'startDate',
  'endDate',
  'hostConnectionId',
  'guestConnectionId',
  'hostEncryptId',
  'guestEncryptId',
  'moneyGained',
  'moneySpent',
  'opponentMoneySpent',
  'rerolls',
  'rerollCostTotal',
  'opponentRerolls',
  'opponentRerollCostTotal',
  'ownerJokers',
  'opponentJokers',
  'ownerVouchers',
  'opponentVouchers',
  'options',
  'actions',
] as const

type ColumnId = (typeof ALL_COLUMN_IDS)[number]
type ColumnConfig = {
  id: ColumnId
  label: string
  sortBy?: SortBy
  render: (game: GameRecord) => ReactNode
}

function isSortBy(value: string): value is SortBy {
  return (
    value === 'host' ||
    value === 'guest' ||
    value === 'deck' ||
    value === 'stake' ||
    value === 'durationSeconds' ||
    value === 'startDate' ||
    value === 'moneySpent' ||
    value === 'rerolls'
  )
}

function formatDuration(seconds: number | null) {
  if (seconds === null || seconds < 0) {
    return '-'
  }

  if (seconds === 0) {
    return '0s'
  }

  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainingSeconds = Math.floor(seconds % 60)
  const parts = []

  if (hours > 0) {
    parts.push(`${hours}h`)
  }

  if (minutes > 0) {
    parts.push(`${minutes}m`)
  }

  if (remainingSeconds > 0 || parts.length === 0) {
    parts.push(`${remainingSeconds}s`)
  }

  return parts.join(' ')
}

function formatValue(value: unknown) {
  if (value === null || value === undefined || value === '') {
    return 'null'
  }

  if (typeof value === 'boolean') {
    return value ? 'true' : 'false'
  }

  return String(value)
}

function resolvePerspectiveName(
  game: GameRecord,
  perspective: 'logOwner' | 'opponent'
) {
  if (perspective === 'logOwner') {
    if (game.isHost === true) {
      return game.host ?? game.logOwnerName ?? 'Unknown'
    }

    if (game.isHost === false) {
      return game.guest ?? game.logOwnerName ?? 'Unknown'
    }

    return game.logOwnerName ?? game.host ?? game.guest ?? 'Unknown'
  }

  if (game.isHost === true) {
    return game.guest ?? game.opponentName ?? 'Unknown'
  }

  if (game.isHost === false) {
    return game.host ?? game.opponentName ?? 'Unknown'
  }

  return game.opponentName ?? game.guest ?? game.host ?? 'Unknown'
}

function resolveWinner(game: GameRecord) {
  if (game.winner !== 'logOwner' && game.winner !== 'opponent') {
    return '-'
  }

  return resolvePerspectiveName(game, game.winner)
}

function renderBadgeList(values: string[]) {
  if (values.length === 0) {
    return <span className='text-muted-foreground text-sm'>-</span>
  }

  const seen = new Map<string, number>()

  return (
    <div className='flex min-w-40 flex-wrap gap-1'>
      {values.map((value) => {
        const occurrence = (seen.get(value) ?? 0) + 1
        seen.set(value, occurrence)

        return (
          <Badge key={`${value}-${occurrence}`} variant='outline'>
            {value}
          </Badge>
        )
      })}
    </div>
  )
}

function renderOptions(options: Record<string, unknown> | null) {
  const visibleEntries = Object.entries(options ?? {}).filter(
    ([key]) => key !== 'back' && key !== 'stake' && key !== 'ruleset'
  )

  if (visibleEntries.length === 0) {
    return <span className='text-muted-foreground text-sm'>-</span>
  }

  return (
    <div className='flex min-w-48 flex-wrap gap-1'>
      {visibleEntries.map(([key, value]) => (
        <Badge key={key} variant='outline'>
          {key}: {formatValue(value)}
        </Badge>
      ))}
    </div>
  )
}

export function GamesClient() {
  const formatter = useFormatter()
  const timeZone = useTimeZone()
  const [games, setGames] = useState<GameRecord[]>([])
  const [availableDecks, setAvailableDecks] = useState<string[]>([])
  const [availableRulesets, setAvailableRulesets] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const [storedVisibleColumnIds, setStoredVisibleColumnIds] = useLocalStorage<
    ColumnId[]
  >('admin-games-visible-columns', [...ALL_COLUMN_IDS])

  const [queryParams, setQueryParams] = useQueryStates(
    {
      page: parseAsInteger.withDefault(1),
      search: parseAsString,
      sortBy: parseAsString.withDefault('startDate'),
      sortOrder: parseAsString.withDefault('desc'),
      deck: parseAsString,
      stake: parseAsInteger,
      winner: parseAsString,
      ruleset: parseAsString,
    },
    { history: 'push' }
  )

  const { page, deck, stake, winner, ruleset } = queryParams
  const sortBy = isSortBy(queryParams.sortBy) ? queryParams.sortBy : 'startDate'
  const sortOrder = queryParams.sortOrder === 'asc' ? 'asc' : 'desc'
  const search = queryParams.search ?? ''
  const [searchInput, setSearchInput] = useState(search)
  const lastSubmittedSearchRef = useRef(search)

  useEffect(() => {
    if (searchInput === lastSubmittedSearchRef.current) {
      return
    }

    const timeoutId = window.setTimeout(() => {
      lastSubmittedSearchRef.current = searchInput
      startTransition(() => {
        void setQueryParams({ search: searchInput || null, page: 1 })
      })
    }, 400)

    return () => window.clearTimeout(timeoutId)
  }, [searchInput, setQueryParams])

  useEffect(() => {
    if (search === lastSubmittedSearchRef.current) {
      return
    }

    lastSubmittedSearchRef.current = search
    setSearchInput(search)
  }, [search])

  const fetchGames = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', String(PAGE_SIZE))
      params.set('sortBy', sortBy)
      params.set('sortOrder', sortOrder)

      if (search) params.set('search', search)
      if (deck) params.set('deck', deck)
      if (stake !== null) params.set('stake', String(stake))
      if (winner) params.set('winner', winner)
      if (ruleset) params.set('ruleset', ruleset)

      const response = await fetch(`/api/games?${params.toString()}`)
      if (!response.ok) {
        throw new Error('Failed to fetch games')
      }

      const data = (await response.json()) as GamesResponse
      setGames(data.data)
      setAvailableDecks(data.availableDecks)
      setAvailableRulesets(data.availableRulesets)
      setTotal(data.total)
      setTotalPages(data.totalPages)

      if (data.totalPages > 0 && page > data.totalPages) {
        setQueryParams({ page: data.totalPages })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setIsLoading(false)
    }
  }, [
    page,
    search,
    sortBy,
    sortOrder,
    deck,
    stake,
    winner,
    ruleset,
    setQueryParams,
  ])

  useEffect(() => {
    fetchGames()
  }, [fetchGames])

  const handleSort = useCallback(
    (column: string) => {
      const nextOrder =
        sortBy === column && sortOrder === 'asc' ? 'desc' : 'asc'
      setQueryParams({ sortBy: column, sortOrder: nextOrder, page: 1 })
    },
    [setQueryParams, sortBy, sortOrder]
  )

  const formatDateTime = (value: string | null) => {
    if (!value) {
      return '-'
    }

    const date = new Date(value)
    if (Number.isNaN(date.getTime())) {
      return '-'
    }

    return formatter.dateTime(date, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    })
  }

  const renderText = (value: ReactNode) => (
    <span className='whitespace-nowrap'>{value}</span>
  )
  const visibleColumnIds = storedVisibleColumnIds.filter((id): id is ColumnId =>
    ALL_COLUMN_IDS.includes(id)
  )
  const safeVisibleColumnIds =
    visibleColumnIds.length > 0 ? visibleColumnIds : [...ALL_COLUMN_IDS]
  const columns: ColumnConfig[] = [
    {
      id: 'host',
      label: 'Host',
      sortBy: 'host',
      render: (game) => renderText(game.host ?? '-'),
    },
    {
      id: 'guest',
      label: 'Guest',
      sortBy: 'guest',
      render: (game) => renderText(game.guest ?? '-'),
    },
    {
      id: 'logOwner',
      label: 'Log Owner',
      render: (game) => renderText(resolvePerspectiveName(game, 'logOwner')),
    },
    {
      id: 'opponent',
      label: 'Opponent',
      render: (game) => renderText(resolvePerspectiveName(game, 'opponent')),
    },
    {
      id: 'winner',
      label: 'Winner',
      render: (game) => renderText(resolveWinner(game)),
    },
    {
      id: 'isHost',
      label: 'Is Host',
      render: (game) =>
        renderText(game.isHost === null ? '-' : game.isHost ? 'Yes' : 'No'),
    },
    {
      id: 'deck',
      label: 'Deck',
      sortBy: 'deck',
      render: (game) => renderText(game.deck ?? '-'),
    },
    {
      id: 'seed',
      label: 'Seed',
      render: (game) => renderText(game.seed ?? '-'),
    },
    {
      id: 'stake',
      label: 'Stake',
      sortBy: 'stake',
      render: (game) =>
        renderText(
          game.stake === null
            ? '-'
            : (STAKE_NAMES[game.stake] ?? `Stake ${game.stake}`)
        ),
    },
    {
      id: 'ruleset',
      label: 'Ruleset',
      render: (game) => renderText(game.ruleset ?? '-'),
    },
    {
      id: 'duration',
      label: 'Duration',
      sortBy: 'durationSeconds',
      render: (game) => renderText(formatDuration(game.durationSeconds)),
    },
    {
      id: 'startDate',
      label: 'Start Date',
      sortBy: 'startDate',
      render: (game) => renderText(formatDateTime(game.startDate)),
    },
    {
      id: 'endDate',
      label: 'End Date',
      render: (game) => renderText(formatDateTime(game.endDate)),
    },
    {
      id: 'hostConnectionId',
      label: 'Host Connection ID',
      render: (game) => renderText(game.hostConnectionId ?? '-'),
    },
    {
      id: 'guestConnectionId',
      label: 'Guest Connection ID',
      render: (game) => renderText(game.guestConnectionId ?? '-'),
    },
    {
      id: 'hostEncryptId',
      label: 'Host Encrypt ID',
      render: (game) => renderText(game.hostEncryptId ?? '-'),
    },
    {
      id: 'guestEncryptId',
      label: 'Guest Encrypt ID',
      render: (game) => renderText(game.guestEncryptId ?? '-'),
    },
    {
      id: 'moneyGained',
      label: 'Money Gained',
      render: (game) => renderText(game.moneyGained ?? '-'),
    },
    {
      id: 'moneySpent',
      label: 'Money Spent',
      sortBy: 'moneySpent',
      render: (game) => renderText(game.moneySpent ?? '-'),
    },
    {
      id: 'opponentMoneySpent',
      label: 'Opponent Money Spent',
      render: (game) => renderText(game.opponentMoneySpent ?? '-'),
    },
    {
      id: 'rerolls',
      label: 'Rerolls',
      sortBy: 'rerolls',
      render: (game) => renderText(game.rerolls ?? '-'),
    },
    {
      id: 'rerollCostTotal',
      label: 'Reroll Cost Total',
      render: (game) => renderText(game.rerollCostTotal ?? '-'),
    },
    {
      id: 'opponentRerolls',
      label: 'Opponent Rerolls',
      render: (game) => renderText(game.opponentRerolls ?? '-'),
    },
    {
      id: 'opponentRerollCostTotal',
      label: 'Opponent Reroll Cost Total',
      render: (game) => renderText(game.opponentRerollCostTotal ?? '-'),
    },
    {
      id: 'ownerJokers',
      label: 'Owner Jokers',
      render: (game) => renderBadgeList(game.logOwnerFinalJokers),
    },
    {
      id: 'opponentJokers',
      label: 'Opponent Jokers',
      render: (game) => renderBadgeList(game.opponentFinalJokers),
    },
    {
      id: 'ownerVouchers',
      label: 'Owner Vouchers',
      render: (game) => renderBadgeList(game.logOwnerVouchers),
    },
    {
      id: 'opponentVouchers',
      label: 'Opponent Vouchers',
      render: (game) => renderBadgeList(game.opponentVouchers),
    },
    {
      id: 'options',
      label: 'Options',
      render: (game) => renderOptions(game.options),
    },
    {
      id: 'actions',
      label: 'Actions',
      render: (game) => (
        <Link
          href={`/log-parser?logId=${game.logFileId}&game=${game.gameIndex}`}
          className='inline-flex items-center gap-1 font-medium text-primary text-sm underline-offset-4 hover:underline'
        >
          View
          <ExternalLink className='size-3.5' />
        </Link>
      ),
    },
  ]
  const visibleColumns = columns.filter((column) =>
    safeVisibleColumnIds.includes(column.id)
  )
  const visibleColumnCount = Math.max(visibleColumns.length, 1)

  const handleToggleColumn = useCallback(
    (columnId: ColumnId, checked: boolean) => {
      setStoredVisibleColumnIds((current) => {
        const safeCurrent =
          current.filter((id): id is ColumnId => ALL_COLUMN_IDS.includes(id)) ||
          []

        if (checked) {
          return ALL_COLUMN_IDS.filter((id) =>
            new Set([...safeCurrent, columnId]).has(id)
          )
        }

        if (safeCurrent.length <= 1) {
          return safeCurrent
        }

        return safeCurrent.filter((id) => id !== columnId)
      })
    },
    [setStoredVisibleColumnIds]
  )

  return (
    <div className='flex w-full flex-col gap-4'>
      <div className='flex flex-col gap-2 xl:flex-row xl:flex-wrap xl:items-center'>
        <Input
          placeholder='Search player, deck, IDs, seed, joker, voucher'
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          className='w-full xl:max-w-sm'
        />

        <Select
          value={deck ?? 'all'}
          onValueChange={(value) =>
            setQueryParams({ deck: value === 'all' ? null : value, page: 1 })
          }
        >
          <SelectTrigger className='w-full xl:w-48'>
            <SelectValue placeholder='Deck' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All decks</SelectItem>
            {availableDecks.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={stake === null ? 'all' : String(stake)}
          onValueChange={(value) =>
            setQueryParams({
              stake: value === 'all' ? null : Number.parseInt(value, 10),
              page: 1,
            })
          }
        >
          <SelectTrigger className='w-full xl:w-44'>
            <SelectValue placeholder='Stake' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All stakes</SelectItem>
            {Object.entries(STAKE_NAMES).map(([value, label]) => (
              <SelectItem key={value} value={value}>
                {label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={winner ?? 'all'}
          onValueChange={(value) =>
            setQueryParams({ winner: value === 'all' ? null : value, page: 1 })
          }
        >
          <SelectTrigger className='w-full xl:w-44'>
            <SelectValue placeholder='Winner' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All winners</SelectItem>
            <SelectItem value='logOwner'>Log owner</SelectItem>
            <SelectItem value='opponent'>Opponent</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={ruleset ?? 'all'}
          onValueChange={(value) =>
            setQueryParams({
              ruleset: value === 'all' ? null : value,
              page: 1,
            })
          }
        >
          <SelectTrigger className='w-full xl:w-48'>
            <SelectValue placeholder='Ruleset' />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value='all'>All rulesets</SelectItem>
            {availableRulesets.map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant='outline'
              className='w-full justify-start xl:w-auto xl:justify-center'
            >
              <SlidersHorizontal className='size-4' />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='max-h-96 w-56'>
            <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {columns.map((column) => {
              const checked = visibleColumnIds.includes(column.id)
              const isLastVisible = checked && safeVisibleColumnIds.length === 1

              return (
                <DropdownMenuCheckboxItem
                  key={column.id}
                  checked={checked}
                  disabled={isLastVisible}
                  onSelect={(event) => event.preventDefault()}
                  onCheckedChange={(nextChecked) =>
                    handleToggleColumn(column.id, nextChecked === true)
                  }
                >
                  {column.label}
                </DropdownMenuCheckboxItem>
              )
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <TableShell className='overflow-hidden'>
        <div className='overflow-x-auto'>
          <Table>
            <TableHeader className='sticky top-0 z-10 bg-background'>
              <TableRow className='bg-muted/50'>
                {visibleColumns.map((column) => (
                  <TableHead key={column.id}>
                    {column.sortBy ? (
                      <SortableHeader
                        column={column.sortBy}
                        label={column.label}
                        sortBy={sortBy}
                        sortOrder={sortOrder}
                        onSort={handleSort}
                      />
                    ) : (
                      column.label
                    )}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={visibleColumnCount}>
                    Loading games...
                  </TableCell>
                </TableRow>
              ) : error ? (
                <TableRow>
                  <TableCell
                    colSpan={visibleColumnCount}
                    className='text-red-500'
                  >
                    {error}
                  </TableCell>
                </TableRow>
              ) : games.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={visibleColumnCount}>
                    No games found
                  </TableCell>
                </TableRow>
              ) : (
                games.map((game) => (
                  <TableRow key={game.id}>
                    {visibleColumns.map((column) => (
                      <TableCell key={column.id}>
                        {column.render(game)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {!isLoading && !error && (
          <PaginationControls
            currentPage={page}
            totalPages={totalPages}
            total={total}
            pageSize={PAGE_SIZE}
            itemLabel='games'
            onPageChange={(nextPage) => setQueryParams({ page: nextPage })}
            className='rounded-none border-0 border-t bg-background'
          />
        )}
      </TableShell>
    </div>
  )
}
