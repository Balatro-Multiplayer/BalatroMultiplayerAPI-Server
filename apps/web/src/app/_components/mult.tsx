import { cn } from '@/lib/utils'

export function Mult({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span className={cn('font-medium text-[#ff4c40]', className)} {...props} />
  )
}
