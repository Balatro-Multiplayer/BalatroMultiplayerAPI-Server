import { cn } from '@/lib/utils'

export function Chance({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span className={cn('font-medium text-[#35bd86]', className)} {...props} />
  )
}
