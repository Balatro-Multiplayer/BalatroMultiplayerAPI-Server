'use client'

import { ChevronLeft, ChevronRight } from 'lucide-react'
import type React from 'react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export type PaginationControlsProps = {
  currentPage: number
  totalPages: number
  total: number
  pageSize: number
  onPageChange: (page: number) => void
  itemLabel?: string
  noTopBorder?: boolean
  className?: string
}

type PageNum = number | 'ellipsis'

function getPageNumbers(currentPage: number, totalPages: number): PageNum[] {
  const pages: PageNum[] = []
  const showEllipsis = totalPages > 7

  if (!showEllipsis) {
    for (let i = 1; i <= totalPages; i++) pages.push(i)
    return pages
  }

  pages.push(1)

  if (currentPage <= 3) {
    pages.push(2, 3, 4, 'ellipsis', totalPages)
    return pages
  }

  if (currentPage >= totalPages - 2) {
    pages.push(
      'ellipsis',
      totalPages - 3,
      totalPages - 2,
      totalPages - 1,
      totalPages
    )
    return pages
  }

  pages.push(
    'ellipsis',
    currentPage - 1,
    currentPage,
    currentPage + 1,
    'ellipsis',
    totalPages
  )
  return pages
}

export function PaginationControls({
  currentPage,
  totalPages,
  total,
  pageSize,
  onPageChange,
  itemLabel = 'items',
  noTopBorder = false,
  className,
}: PaginationControlsProps) {
  const safeTotalPages = Math.max(totalPages, 1)
  const safeCurrentPage = Math.min(Math.max(currentPage, 1), safeTotalPages)

  const [jumpToPage, setJumpToPage] = useState('')

  const pages = useMemo(
    () => getPageNumbers(safeCurrentPage, safeTotalPages),
    [safeCurrentPage, safeTotalPages]
  )

  const from = total === 0 ? 0 : (safeCurrentPage - 1) * pageSize + 1
  const to = Math.min(safeCurrentPage * pageSize, total)

  const handleJumpToPage = () => {
    const pageNum = Number.parseInt(jumpToPage, 10)
    if (!Number.isNaN(pageNum) && pageNum >= 1 && pageNum <= safeTotalPages) {
      onPageChange(pageNum)
      setJumpToPage('')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') handleJumpToPage()
  }

  return (
    <div
      className={cn(
        'flex items-center justify-between rounded-b-lg border border-gray-200 bg-white px-4 py-3 sm:px-6 dark:border-zinc-800 dark:bg-zinc-900',
        noTopBorder && 'border-t-0',
        className
      )}
    >
      <div className='flex flex-1 flex-col gap-2 sm:hidden'>
        <div className='flex justify-between'>
          <Button
            variant='outline'
            size='sm'
            onClick={() => onPageChange(safeCurrentPage - 1)}
            disabled={safeCurrentPage === 1}
          >
            Previous
          </Button>
          <span className='text-gray-700 text-sm dark:text-zinc-300'>
            Page {safeCurrentPage} of {safeTotalPages}
          </span>
          <Button
            variant='outline'
            size='sm'
            onClick={() => onPageChange(safeCurrentPage + 1)}
            disabled={safeCurrentPage === safeTotalPages}
          >
            Next
          </Button>
        </div>
        <div className='flex items-center justify-center gap-2'>
          <span className='text-gray-700 text-sm dark:text-zinc-300'>
            Go to:
          </span>
          <Input
            type='number'
            min={1}
            max={safeTotalPages}
            value={jumpToPage}
            onChange={(e) => setJumpToPage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder='Page'
            className='h-8 w-20 text-sm'
          />
          <Button
            variant='outline'
            size='sm'
            onClick={handleJumpToPage}
            disabled={
              !jumpToPage ||
              Number.parseInt(jumpToPage, 10) < 1 ||
              Number.parseInt(jumpToPage, 10) > safeTotalPages
            }
          >
            Go
          </Button>
        </div>
      </div>

      <div className='hidden sm:flex sm:flex-1 sm:items-center sm:justify-between'>
        <div>
          <p className='text-gray-700 text-sm dark:text-zinc-300'>
            Showing <span className='font-medium'>{from}</span> to{' '}
            <span className='font-medium'>{to}</span> of{' '}
            <span className='font-medium'>{total}</span> {itemLabel}
          </p>
        </div>
        <div className='flex items-center gap-4'>
          <div className='flex items-center gap-1'>
            <Button
              variant='outline'
              size='sm'
              onClick={() => onPageChange(safeCurrentPage - 1)}
              disabled={safeCurrentPage === 1}
            >
              <ChevronLeft className='h-4 w-4' />
            </Button>
            {(() => {
              let ellipsisN = 0
              return pages.map((page) =>
                page === 'ellipsis' ? (
                  <span
                    key={`ellipsis-${ellipsisN++}`}
                    className='px-3 py-2 text-gray-400'
                  >
                    ...
                  </span>
                ) : (
                  <Button
                    key={page}
                    variant={safeCurrentPage === page ? 'default' : 'outline'}
                    size='sm'
                    onClick={() => onPageChange(page)}
                    className='min-w-[2.5rem]'
                  >
                    {page}
                  </Button>
                )
              )
            })()}
            <Button
              variant='outline'
              size='sm'
              onClick={() => onPageChange(safeCurrentPage + 1)}
              disabled={safeCurrentPage === safeTotalPages}
            >
              <ChevronRight className='h-4 w-4' />
            </Button>
          </div>

          <div className='flex items-center gap-2'>
            <Input
              type='number'
              min={1}
              max={safeTotalPages}
              value={jumpToPage}
              onChange={(e) => setJumpToPage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder='Go to'
              className='h-8 w-20 text-sm'
            />
            <Button
              variant='outline'
              size='sm'
              onClick={handleJumpToPage}
              disabled={
                !jumpToPage ||
                Number.parseInt(jumpToPage, 10) < 1 ||
                Number.parseInt(jumpToPage, 10) > safeTotalPages
              }
            >
              Go
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
