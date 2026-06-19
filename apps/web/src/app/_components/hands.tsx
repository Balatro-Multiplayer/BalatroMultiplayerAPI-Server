'use client'

import { cn } from '@/lib/utils'

export function Hands({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span className={cn('font-medium text-[#ff8f00]', className)} {...props} />
  )
}
