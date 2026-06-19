'use client'

import { cn } from '@/lib/utils'

export function Nemesis({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'rounded-md bg-[#7b559c] px-1 font-medium text-white',
        className
      )}
      {...props}
    />
  )
}
