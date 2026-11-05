import type { ReactNode } from 'react'

// One open section: a title and short text on top, the body that scrolls,
// and the save bar at the bottom.
export function SectionFrame({
  title,
  description,
  children,
  footer,
  testId,
}: {
  title: string
  description: string
  children: ReactNode
  footer?: ReactNode
  testId?: string
}) {
  return (
    <div className='flex min-h-0 flex-1 flex-col' data-testid={testId}>
      <div className='px-5 pt-4 pb-3'>
        <h2 className='font-bold text-2xl tracking-tight'>{title}</h2>
        <p className='mt-1 text-muted-foreground text-sm'>{description}</p>
      </div>
      <div className='min-h-0 flex-1 overflow-y-auto border-border border-t px-5 py-4'>
        {children}
      </div>
      {footer}
    </div>
  )
}
