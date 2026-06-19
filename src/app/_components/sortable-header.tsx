'use client'

import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import type { ComponentPropsWithoutRef } from 'react'
import { cn } from '@/lib/utils'

export type SortDirection = 'asc' | 'desc'

export type SortableHeaderProps = ComponentPropsWithoutRef<'button'> & {
  column: string
  label: string
  sortBy: string
  sortOrder: SortDirection
  onSort: (column: string) => void
}

export function SortableHeader({
  column,
  label,
  sortBy,
  sortOrder,
  onSort,
  className,
  ...rest
}: SortableHeaderProps) {
  const isActive = sortBy === column

  return (
    <button
      type='button'
      className={cn(
        'flex items-center gap-1 transition-colors hover:text-violet-500 dark:hover:text-violet-400',
        className
      )}
      {...rest}
      onClick={() => onSort(column)}
    >
      {label}
      <span className='flex w-4 items-center justify-center'>
        {isActive ? (
          sortOrder === 'asc' ? (
            <ArrowUp className='h-3.5 w-3.5' />
          ) : (
            <ArrowDown className='h-3.5 w-3.5' />
          )
        ) : (
          <ArrowUpDown className='h-3.5 w-3.5 opacity-50' />
        )}
      </span>
    </button>
  )
}
