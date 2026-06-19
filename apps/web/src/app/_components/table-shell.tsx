import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function TableShell({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-lg border bg-background', className)}>
      {children}
    </div>
  )
}
