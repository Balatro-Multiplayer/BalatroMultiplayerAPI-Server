'use client'

import { ExternalLink, Trash2 } from 'lucide-react'
import Link from 'next/link'
import {
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  useQueryStates,
} from 'nuqs'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type LogFile = {
  id: number
  logIds: number[]
  fileName: string
  fileUrl: string
  createdAt: string
  lobbyCodes: string[]
  ownerConnectionIds: string[]
  ownerNames: string[]
  uploadedBy: string[]
  mergedCount: number
}

type SortBy = 'createdAt' | 'fileName' | 'userName'

function escapeRegExp(value: string) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function renderHighlightedText(
  text: string,
  search: string | null,
  shouldHighlight: boolean
): ReactNode {
  const searchValue = search?.trim()
  if (!shouldHighlight || !searchValue) {
    return text
  }

  const regex = new RegExp(`(${escapeRegExp(searchValue)})`, 'ig')
  const parts = text.split(regex)

  if (parts.length === 1) {
    return text
  }

  const nodes: ReactNode[] = []
  let cursor = 0

  for (const part of parts) {
    const key = `${text}-${cursor}-${part}`
    const partLength = part.length

    nodes.push(
      part.toLowerCase() === searchValue.toLowerCase() ? (
        <mark key={key} className='rounded bg-amber-200 px-0.5 text-foreground'>
          {part}
        </mark>
      ) : (
        <span key={key}>{part}</span>
      )
    )

    cursor += partLength
  }

  return nodes
}

export function LogsClient() {
  const pageSize = 50
  const [logs, setLogs] = useState<LogFile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [highlightMatches, setHighlightMatches] = useLocalStorage(
    'admin-logs-highlight-matches',
    true
  )

  const [queryParams, setQueryParams] = useQueryStates(
    {
      page: parseAsInteger.withDefault(1),
      search: parseAsString,
      sortBy: parseAsString.withDefault('createdAt'),
      sortOrder: parseAsString.withDefault('desc'),
      dedupe: parseAsBoolean.withDefault(true),
    },
    { history: 'push' }
  )

  const { page, search, dedupe } = queryParams
  const sortBy = (['createdAt', 'fileName', 'userName'] as const).includes(
    queryParams.sortBy as SortBy
  )
    ? (queryParams.sortBy as SortBy)
    : 'createdAt'
  const sortOrder = (queryParams.sortOrder === 'asc' ? 'asc' : 'desc') as
    | 'asc'
    | 'desc'

  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const searchQuery = search ?? ''
  const [searchInput, setSearchInput] = useState(searchQuery)
  const lastSubmittedSearchRef = useRef(searchQuery)

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
    if (searchQuery === lastSubmittedSearchRef.current) {
      return
    }

    lastSubmittedSearchRef.current = searchQuery
    setSearchInput(searchQuery)
  }, [searchQuery])

  const fetchLogs = useCallback(async () => {
    try {
      setIsLoading(true)
      setError(null)

      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))
      params.set('dedupe', String(dedupe))
      if (search) params.set('search', search)
      if (sortBy) params.set('sortBy', sortBy)
      if (sortOrder) params.set('sortOrder', sortOrder)

      const response = await fetch(`/api/logs?${params.toString()}`)
      if (!response.ok) {
        throw new Error('Failed to fetch logs')
      }

      const data = (await response.json()) as {
        data: LogFile[]
        page: number
        pageSize: number
        total: number
        totalPages: number
        search: string | null
      }

      setLogs(data.data)
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
  }, [page, search, sortBy, sortOrder, setQueryParams, dedupe])

  useEffect(() => {
    fetchLogs()
  }, [fetchLogs])

  const handleSort = useCallback(
    (column: string) => {
      const nextOrder =
        sortBy === column && sortOrder === 'asc' ? 'desc' : 'asc'
      setQueryParams({ sortBy: column, sortOrder: nextOrder, page: 1 })
    },
    [setQueryParams, sortBy, sortOrder]
  )

  const handleDelete = async (id: number) => {
    if (!confirm('Are you sure you want to delete this log file?')) return

    setIsDeleting(true)
    try {
      const response = await fetch(`/api/logs?id=${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete log file')
      }

      // Refresh the logs list
      await fetchLogs()
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'An error occurred while deleting'
      )
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className='flex w-full flex-col gap-4'>
      <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
        <Input
          placeholder='Search by file, uploader, player, lobby code, or connection ID'
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          className='w-full sm:max-w-sm'
        />
        <div className='flex items-center gap-2 self-start sm:self-auto'>
          <Switch
            id='dedupe-log-results'
            checked={dedupe}
            onCheckedChange={(checked) =>
              setQueryParams({ dedupe: checked, page: 1 })
            }
          />
          <Label htmlFor='dedupe-log-results'>Deduplicate</Label>
        </div>
        <div className='flex items-center gap-2 self-start sm:self-auto'>
          <Switch
            id='highlight-log-search-matches'
            checked={highlightMatches}
            onCheckedChange={setHighlightMatches}
          />
          <Label htmlFor='highlight-log-search-matches'>
            Highlight Matches
          </Label>
        </div>
      </div>

      <TableShell className='overflow-hidden'>
        <div className='overflow-x-auto'>
          <Table>
            <TableHeader className='sticky top-0 z-10 bg-background'>
              <TableRow className='bg-muted/50'>
                <TableHead>
                  <SortableHeader
                    column='fileName'
                    label='File Name'
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={handleSort}
                  />
                </TableHead>
                <TableHead>Log Owner IGN</TableHead>
                <TableHead>Lobby Code</TableHead>
                <TableHead>serversideConnectionID</TableHead>
                <TableHead>
                  <SortableHeader
                    column='userName'
                    label='Uploaded By'
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={handleSort}
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    column='createdAt'
                    label='Date'
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={handleSort}
                  />
                </TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7}>Loading logs...</TableCell>
                </TableRow>
              ) : error ? (
                <TableRow>
                  <TableCell colSpan={7} className='text-red-500'>
                    {error}
                  </TableCell>
                </TableRow>
              ) : logs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7}>No logs found</TableCell>
                </TableRow>
              ) : (
                logs.map((log) => (
                  <TableRow key={log.id}>
                    <TableCell>
                      <div className='flex flex-col gap-1'>
                        <span>
                          {renderHighlightedText(
                            log.fileName,
                            search,
                            highlightMatches
                          )}
                        </span>
                        {log.mergedCount > 1 && (
                          <span className='text-muted-foreground text-xs'>
                            {log.mergedCount} merged uploads
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {log.ownerNames.length > 0 ? (
                        <div className='flex flex-wrap gap-1.5'>
                          {log.ownerNames.map((ownerName) => (
                            <Badge
                              key={`${log.id}-${ownerName}`}
                              variant='outline'
                            >
                              {renderHighlightedText(
                                ownerName,
                                search,
                                highlightMatches
                              )}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className='text-muted-foreground text-sm'>
                          Unknown
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {log.lobbyCodes.length > 0 ? (
                        <div className='flex flex-wrap gap-1.5'>
                          {log.lobbyCodes.map((lobbyCode) => (
                            <Badge
                              key={`${log.id}-${lobbyCode}`}
                              variant='outline'
                              asChild
                            >
                              <Link
                                href={`/admin/lobby-codes?search=${encodeURIComponent(lobbyCode)}`}
                              >
                                {renderHighlightedText(
                                  lobbyCode,
                                  search,
                                  highlightMatches
                                )}
                              </Link>
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className='text-muted-foreground text-sm'>
                          Unknown
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {log.ownerConnectionIds.length > 0 ? (
                        <div className='flex flex-wrap gap-1.5'>
                          {log.ownerConnectionIds.map((connectionId) => (
                            <Badge
                              key={`${log.id}-${connectionId}`}
                              variant='outline'
                            >
                              {renderHighlightedText(
                                connectionId,
                                search,
                                highlightMatches
                              )}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        <span className='text-muted-foreground text-sm'>
                          Unknown
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className='flex flex-wrap gap-1.5'>
                        {log.uploadedBy.map((uploader) => (
                          <Badge
                            key={`${log.id}-${uploader}`}
                            variant='outline'
                          >
                            {renderHighlightedText(
                              uploader,
                              search,
                              highlightMatches
                            )}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell>
                      {new Date(log.createdAt).toLocaleString()}
                    </TableCell>
                    <TableCell className='flex gap-2'>
                      <Link
                        href={`/log-parser?logId=${log.id}`}
                        className='inline-flex items-center gap-1 self-center font-medium text-primary text-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'
                      >
                        View in Parser
                        <ExternalLink className='size-3.5' />
                      </Link>
                      <Button
                        variant='destructive'
                        size='icon'
                        onClick={() => handleDelete(log.id)}
                        disabled={isDeleting || log.mergedCount > 1}
                        title={
                          log.mergedCount > 1
                            ? 'Disable deduplication to delete individual uploads'
                            : undefined
                        }
                      >
                        <Trash2 className='h-4 w-4' />
                      </Button>
                    </TableCell>
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
            pageSize={pageSize}
            itemLabel='logs'
            onPageChange={(p) => setQueryParams({ page: p })}
            className='rounded-none border-0 border-t bg-background'
          />
        )}
      </TableShell>
    </div>
  )
}
