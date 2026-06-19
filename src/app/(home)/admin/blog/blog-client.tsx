'use client'

import Link from 'next/link'
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs'
import { useCallback } from 'react'
import { useDebounceCallback } from 'usehooks-ts'
import { PaginationControls } from '@/app/_components/pagination-controls'
import { SortableHeader } from '@/app/_components/sortable-header'
import { TableShell } from '@/app/_components/table-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate } from '@/lib/utils'
import { api } from '@/trpc/react'

type SortBy = 'createdAt' | 'title' | 'published'

export function AdminBlogClient() {
  const pageSize = 50
  const [queryParams, setQueryParams] = useQueryStates(
    {
      page: parseAsInteger.withDefault(1),
      search: parseAsString,
      sortBy: parseAsString.withDefault('createdAt'),
      sortOrder: parseAsString.withDefault('desc'),
    },
    { history: 'push' }
  )

  const { page, search } = queryParams
  const sortBy = (['createdAt', 'title', 'published'] as const).includes(
    queryParams.sortBy as SortBy
  )
    ? (queryParams.sortBy as SortBy)
    : 'createdAt'
  const sortOrder = (queryParams.sortOrder === 'asc' ? 'asc' : 'desc') as
    | 'asc'
    | 'desc'
  const updateSearch = useDebounceCallback((nextSearch: string) => {
    setQueryParams({ search: nextSearch || null, page: 1 })
  }, 400)

  const postsQ = api.blog.adminList.useQuery(
    {
      page,
      pageSize,
      search: search || undefined,
      sortBy,
      sortOrder,
    },
    { refetchOnWindowFocus: false }
  )

  const posts = postsQ.data?.data ?? []
  const total = postsQ.data?.total ?? 0
  const totalPages = postsQ.data?.totalPages ?? 1

  const handleSort = useCallback(
    (column: string) => {
      const nextOrder =
        sortBy === column && sortOrder === 'asc' ? 'desc' : 'asc'
      setQueryParams({ sortBy: column, sortOrder: nextOrder, page: 1 })
    },
    [setQueryParams, sortBy, sortOrder]
  )

  return (
    <div className='space-y-4'>
      <Input
        key={search ?? ''}
        placeholder='Search title/slug/author...'
        defaultValue={search ?? ''}
        onChange={(e) => updateSearch(e.target.value)}
        className='w-full sm:max-w-sm'
      />

      <TableShell className='overflow-hidden'>
        <div className='overflow-x-auto'>
          <Table className='w-full'>
            <TableHeader className='sticky top-0 z-10 bg-background'>
              <TableRow className='bg-muted/50'>
                <TableHead>
                  <SortableHeader
                    column='title'
                    label='Title'
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={handleSort}
                  />
                </TableHead>
                <TableHead>Author</TableHead>
                <TableHead>
                  <SortableHeader
                    column='createdAt'
                    label='Date'
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={handleSort}
                  />
                </TableHead>
                <TableHead>
                  <SortableHeader
                    column='published'
                    label='Status'
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={handleSort}
                  />
                </TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {postsQ.isLoading ? (
                <TableRow>
                  <TableCell colSpan={5}>Loading...</TableCell>
                </TableRow>
              ) : posts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className='text-muted-foreground'>
                    No blog posts
                  </TableCell>
                </TableRow>
              ) : (
                posts.map((post) => (
                  <TableRow key={post.id}>
                    <TableCell>
                      <Link
                        href={`/blog/${post.slug}`}
                        className='font-medium hover:underline'
                      >
                        {post.title}
                      </Link>
                    </TableCell>
                    <TableCell>{post.author?.name || 'Anonymous'}</TableCell>
                    <TableCell>{formatDate(post.createdAt)}</TableCell>
                    <TableCell>
                      <span
                        className={`inline-flex rounded-full px-2 py-1 font-medium text-xs ${post.published ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}
                      >
                        {post.published ? 'Published' : 'Draft'}
                      </span>
                    </TableCell>
                    <TableCell>
                      <div className='flex gap-2'>
                        <Button variant='outline' size='sm' asChild>
                          <Link href={`/admin/blog/edit/${post.id}`}>Edit</Link>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {!postsQ.isLoading && (
          <PaginationControls
            currentPage={page}
            totalPages={totalPages}
            total={total}
            pageSize={pageSize}
            itemLabel='posts'
            onPageChange={(p) => setQueryParams({ page: p })}
            className='rounded-none border-0 border-t bg-background'
          />
        )}
      </TableShell>
    </div>
  )
}
