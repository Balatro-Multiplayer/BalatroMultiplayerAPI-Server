'use client'

import { cn } from '@/lib/utils'

export function Chips({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span className={cn('font-medium text-[#0093ff]', className)} {...props} />
  )
}
