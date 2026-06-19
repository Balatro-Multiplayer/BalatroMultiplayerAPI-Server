import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * On mobile: renders as a plain div (no card chrome).
 * On sm+: renders with card styling (border, bg, shadow, rounded, padding).
 */
export function ChartCard({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'flex w-full flex-col gap-4 sm:gap-6 sm:rounded-xl sm:border sm:bg-card sm:py-6 sm:text-card-foreground sm:shadow-sm',
        className
      )}
    >
      {children}
    </div>
  )
}

export function ChartCardHeader({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-col gap-4 sm:px-6', className)}>
      {children}
    </div>
  )
}

export function ChartCardContent({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={cn('w-full sm:px-6', className)}>{children}</div>
}
