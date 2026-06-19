import { cn } from '@/lib/utils'

export function Spectral({
  className,
  ...props
}: React.ComponentProps<'span'>) {
  return (
    <span className={cn('font-medium text-[#2e76fd]', className)} {...props} />
  )
}
