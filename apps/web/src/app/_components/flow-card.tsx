import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// A small centered card for one-step pages: sign in, accept the notice, the
// Contest and report pages, and the wait and error states of the sign-in flow.
export function FlowPage({
  children,
  className,
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'container flex min-h-[70vh] items-center justify-center py-10',
        className
      )}
    >
      {children}
    </div>
  )
}

export function FlowCard({
  title,
  intro,
  children,
  className,
}: {
  title: ReactNode
  intro?: ReactNode
  children?: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'w-full max-w-lg space-y-4 rounded-lg border border-border bg-card/80 p-5 sm:p-6',
        className
      )}
    >
      <div className='space-y-1.5'>
        <h1 className='font-pixel text-3xl'>{title}</h1>
        {intro && <p className='text-muted-foreground text-sm'>{intro}</p>}
      </div>
      {children}
    </section>
  )
}
