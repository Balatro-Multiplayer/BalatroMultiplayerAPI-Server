'use client'

import { cn } from '@/lib/utils'

export function Xmult({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      className={cn(
        'rounded-md bg-[#ff4c40] px-1 font-medium text-white',
        className
      )}
      {...props}
    />
  )
}
