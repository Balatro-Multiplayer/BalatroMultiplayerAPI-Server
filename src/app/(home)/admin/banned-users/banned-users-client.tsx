'use client'

import { Plus, Trash2 } from 'lucide-react'
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { useDebounceCallback } from 'usehooks-ts'
import { PaginationControls } from '@/app/_components/pagination-controls'
import { SortableHeader } from '@/app/_components/sortable-header'
import { TableShell } from '@/app/_components/table-shell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { api } from '@/trpc/react'

type BannedUserEntry = {
  id: number
  label: string
  aliases: string[]
  ids: string[]
  createdAt: Date
  updatedAt: Date
}

type SortBy = 'label' | 'updatedAt' | 'createdAt'

function parseListInput(value: string) {
  const seen = new Set<string>()
  const items: string[] = []

  for (const line of value.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }

    const lower = trimmed.toLowerCase()
    if (seen.has(lower)) {
      continue
    }

    seen.add(lower)
    items.push(trimmed)
  }

  return items
}

function formatDate(value: Date) {
  return new Date(value).toLocaleString()
}

function renderValueBadges(values: string[], emptyLabel: string) {
  if (values.length === 0) {
    return <span className='text-muted-foreground text-sm'>{emptyLabel}</span>
  }

  return (
    <div className='flex flex-wrap gap-1.5'>
      {values.map((value) => (
        <Badge key={value} variant='outline'>
          {value}
        </Badge>
      ))}
    </div>
  )
}

export function BannedUsersClient() {
  const utils = api.useUtils()
  const pageSize = 50
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [selectedEntry, setSelectedEntry] = useState<BannedUserEntry | null>(
    null
  )
  const [label, setLabel] = useState('')
  const [aliasesInput, setAliasesInput] = useState('')
  const [idsInput, setIdsInput] = useState('')
  const [queryParams, setQueryParams] = useQueryStates(
    {
      page: parseAsInteger.withDefault(1),
      search: parseAsString,
      sortBy: parseAsString.withDefault('updatedAt'),
      sortOrder: parseAsString.withDefault('desc'),
    },
    { history: 'push' }
  )

  const { page, search } = queryParams
  const sortBy = (['label', 'updatedAt', 'createdAt'] as const).includes(
    queryParams.sortBy as SortBy
  )
    ? (queryParams.sortBy as SortBy)
    : 'updatedAt'
  const sortOrder = queryParams.sortOrder === 'asc' ? 'asc' : 'desc'

  const updateSearch = useDebounceCallback((nextSearch: string) => {
    setQueryParams({ search: nextSearch || null, page: 1 })
  }, 400)

  const listQ = api.bannedUsers.list.useQuery(
    {
      page,
      pageSize,
      search: search || undefined,
      sortBy,
      sortOrder,
    },
    { refetchOnWindowFocus: false }
  )

  const rows = (listQ.data?.data ?? []) as BannedUserEntry[]

  useEffect(() => {
    if (!selectedEntry) {
      return
    }

    const refreshedEntry = rows.find((row) => row.id === selectedEntry.id)
    if (!refreshedEntry) {
      return
    }

    setSelectedEntry(refreshedEntry)
    setLabel(refreshedEntry.label)
    setAliasesInput(refreshedEntry.aliases.join('\n'))
    setIdsInput(refreshedEntry.ids.join('\n'))
  }, [rows, selectedEntry])

  const resetForm = useCallback(() => {
    setIsDialogOpen(false)
    setSelectedEntry(null)
    setLabel('')
    setAliasesInput('')
    setIdsInput('')
  }, [])

  const saveMutation = api.bannedUsers.save.useMutation({
    onSuccess: async () => {
      toast.success('Entry saved')
      await utils.bannedUsers.list.invalidate()
      resetForm()
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to save entry')
    },
  })

  const deleteMutation = api.bannedUsers.delete.useMutation({
    onSuccess: async () => {
      toast.success('Entry deleted')
      await utils.bannedUsers.list.invalidate()
      resetForm()
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to delete entry')
    },
  })

  const handleSort = useCallback(
    (column: string) => {
      const nextOrder =
        sortBy === column && sortOrder === 'asc' ? 'desc' : 'asc'
      setQueryParams({ sortBy: column, sortOrder: nextOrder, page: 1 })
    },
    [setQueryParams, sortBy, sortOrder]
  )

  const aliasCount = useMemo(
    () => parseListInput(aliasesInput).length,
    [aliasesInput]
  )
  const idCount = useMemo(() => parseListInput(idsInput).length, [idsInput])

  const handleSubmit = () => {
    saveMutation.mutate({
      id: selectedEntry?.id,
      label,
      aliases: parseListInput(aliasesInput),
      ids: parseListInput(idsInput),
    })
  }

  const handleDelete = (entry: BannedUserEntry) => {
    if (!confirm(`Delete ${entry.label}?`)) {
      return
    }

    deleteMutation.mutate({ id: entry.id })
  }

  return (
    <div className='flex w-full flex-col gap-4'>
      <div className='flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between'>
        <Input
          key={search ?? ''}
          placeholder='Search label, alias, or id'
          defaultValue={search ?? ''}
          onChange={(event) => updateSearch(event.target.value)}
          className='w-full sm:max-w-sm'
        />
        <div className='flex items-center gap-2'>
          <Button
            size='sm'
            variant='outline'
            onClick={() => utils.bannedUsers.list.invalidate()}
            disabled={listQ.isFetching}
          >
            Refresh
          </Button>
          <Button
            size='sm'
            onClick={() => {
              setIsDialogOpen(true)
              setSelectedEntry(null)
              setLabel('')
              setAliasesInput('')
              setIdsInput('')
            }}
          >
            <Plus className='mr-2 size-4' />
            Add Entry
          </Button>
        </div>
      </div>

      <TableShell className='overflow-hidden'>
        <div className='overflow-x-auto'>
          <Table>
            <TableHeader className='sticky top-0 z-10 bg-background'>
              <TableRow className='bg-muted/50'>
                <TableHead>
                  <SortableHeader
                    column='label'
                    label='Label'
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={handleSort}
                  />
                </TableHead>
                <TableHead>Aliases</TableHead>
                <TableHead>Ids</TableHead>
                <TableHead>
                  <SortableHeader
                    column='updatedAt'
                    label='Updated'
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={handleSort}
                  />
                </TableHead>
                <TableHead className='w-[180px]'>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {listQ.isLoading ? (
                <TableRow>
                  <TableCell colSpan={5}>Loading entries…</TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>No entries found</TableCell>
                </TableRow>
              ) : (
                rows.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell>
                      <div className='flex flex-col gap-1'>
                        <span className='font-medium'>{entry.label}</span>
                        <span className='text-muted-foreground text-xs'>
                          #{entry.id}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      {renderValueBadges(entry.aliases, 'No aliases')}
                    </TableCell>
                    <TableCell>
                      {renderValueBadges(entry.ids, 'No ids')}
                    </TableCell>
                    <TableCell>{formatDate(entry.updatedAt)}</TableCell>
                    <TableCell>
                      <div className='flex gap-2'>
                        <Button
                          size='sm'
                          variant='outline'
                          onClick={() => {
                            setIsDialogOpen(true)
                            setSelectedEntry(entry)
                            setLabel(entry.label)
                            setAliasesInput(entry.aliases.join('\n'))
                            setIdsInput(entry.ids.join('\n'))
                          }}
                        >
                          Edit
                        </Button>
                        <Button
                          size='icon'
                          variant='destructive'
                          onClick={() => handleDelete(entry)}
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className='size-4' />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {!listQ.isLoading ? (
          <PaginationControls
            currentPage={page}
            totalPages={listQ.data?.totalPages ?? 1}
            total={listQ.data?.total ?? 0}
            pageSize={pageSize}
            itemLabel='entries'
            onPageChange={(nextPage) => setQueryParams({ page: nextPage })}
            className='rounded-none border-0 border-t bg-background'
          />
        ) : null}
      </TableShell>

      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          setIsDialogOpen(open)
          if (!open && !saveMutation.isPending) {
            resetForm()
          }
        }}
      >
        <DialogContent className='sm:max-w-2xl'>
          <DialogHeader>
            <DialogTitle>
              {selectedEntry ? 'Edit Banned User' : 'Add Banned User'}
            </DialogTitle>
            <DialogDescription>
              Use one line per alias or id. Matching is case-insensitive.
            </DialogDescription>
          </DialogHeader>

          <div className='grid gap-4'>
            <div className='grid gap-2'>
              <Label htmlFor='banned-user-label'>Label</Label>
              <Input
                id='banned-user-label'
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder='Display name for this person'
              />
            </div>

            <div className='grid gap-2'>
              <div className='flex items-center justify-between gap-2'>
                <Label htmlFor='banned-user-aliases'>Aliases</Label>
                <span className='text-muted-foreground text-xs'>
                  {aliasCount} saved
                </span>
              </div>
              <Textarea
                id='banned-user-aliases'
                value={aliasesInput}
                onChange={(event) => setAliasesInput(event.target.value)}
                placeholder={'One alias per line'}
                rows={8}
              />
            </div>

            <div className='grid gap-2'>
              <div className='flex items-center justify-between gap-2'>
                <Label htmlFor='banned-user-ids'>Ids</Label>
                <span className='text-muted-foreground text-xs'>
                  {idCount} saved
                </span>
              </div>
              <Textarea
                id='banned-user-ids'
                value={idsInput}
                onChange={(event) => setIdsInput(event.target.value)}
                placeholder={'One id per line'}
                rows={8}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant='outline'
              onClick={() => resetForm()}
              disabled={saveMutation.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
