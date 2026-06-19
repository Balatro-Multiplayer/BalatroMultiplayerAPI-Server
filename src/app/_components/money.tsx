import { cn } from '@/lib/utils'

export function Money({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span className={cn('font-medium text-[#f5b244]', className)} {...props} />
  )
}
