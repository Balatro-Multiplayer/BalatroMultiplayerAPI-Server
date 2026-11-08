'use client'

import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

// The layout parts of the site's pages, as the staff pages use them: a page
// header, a main card with tabs, side cards and key/value rows. Pixel font for
// headings, Inter for the rest.

export function PageShell({
  children,
  wide = false,
  className,
}: {
  children: ReactNode
  wide?: boolean
  className?: string
}) {
  return (
    <div
      className={cn(
        'container space-y-4 py-8',
        wide ? 'max-w-7xl' : 'max-w-6xl',
        className
      )}
    >
      {children}
    </div>
  )
}

export function PageHeader({
  back,
  title,
  badges,
  actions,
  meta,
}: {
  back?: { href: string; label: string }
  title: ReactNode
  badges?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
}) {
  return (
    <header className='space-y-2'>
      {back && (
        <Link
          href={back.href}
          className='text-bal-blue text-sm hover:underline'
        >
          {back.label}
        </Link>
      )}
      <div className='flex flex-wrap items-center gap-3'>
        <h1 className='min-w-0 break-words font-pixel text-3xl sm:text-4xl'>
          {title}
        </h1>
        {badges}
        {actions && (
          <div className='ml-auto flex flex-wrap gap-2'>{actions}</div>
        )}
      </div>
      {meta && <div className='text-muted-foreground text-sm'>{meta}</div>}
    </header>
  )
}

// Main column and a 340 px side column; the side column goes under the main
// one on a phone.
export function MainAndSide({
  main,
  side,
}: {
  main: ReactNode
  side: ReactNode
}) {
  return (
    <div className='grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]'>
      <div className='min-w-0 space-y-4'>{main}</div>
      <aside className='min-w-0 space-y-4'>{side}</aside>
    </div>
  )
}

export function SideCard({
  title,
  children,
  className,
}: {
  title: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'space-y-2 rounded-lg border border-border bg-card/80 p-4',
        className
      )}
    >
      <h2 className='font-pixel text-lg uppercase tracking-wide'>{title}</h2>
      {children}
    </section>
  )
}

export function KeyValues({
  rows,
}: {
  rows: Array<[label: ReactNode, value: ReactNode]>
}) {
  return (
    <dl className='grid grid-cols-[auto_minmax(0,1fr)] gap-x-6 gap-y-1.5 text-sm'>
      {rows.map(([k, v], i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are static per render
        <div key={i} className='contents'>
          <dt className='text-muted-foreground'>{k}</dt>
          <dd className='min-w-0 break-words'>{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export type TabSpec<T extends string> = {
  key: T
  label: string
  count?: number | null
}

export function TabCard<T extends string>({
  tabs,
  current,
  onChange,
  children,
}: {
  tabs: TabSpec<T>[]
  current: T
  onChange: (tab: T) => void
  children: ReactNode
}) {
  return (
    <section className='min-w-0 rounded-lg border border-border bg-card/80'>
      <div
        className='flex flex-wrap gap-x-5 gap-y-1 border-border border-b px-4 pt-3'
        role='tablist'
      >
        {tabs.map((t) => (
          <button
            key={t.key}
            type='button'
            role='tab'
            aria-selected={t.key === current}
            data-tab={t.key}
            onClick={() => onChange(t.key)}
            className={cn(
              '-mb-px border-b-2 pb-2 font-medium text-sm',
              t.key === current
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
            {t.count != null && (
              <span className='ml-1.5 text-muted-foreground text-xs'>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>
      <div className='p-4' role='tabpanel' data-testid={`tab-${current}`}>
        {children}
      </div>
    </section>
  )
}

// A plain card with an optional pixel heading, for main-column content.
export function ContentCard({
  title,
  actions,
  children,
  className,
}: {
  title?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={cn(
        'space-y-3 rounded-lg border border-border bg-card/80 p-4 sm:p-5',
        className
      )}
    >
      {(title || actions) && (
        <div className='flex flex-wrap items-center gap-2'>
          {title && (
            <h2 className='font-pixel text-lg uppercase tracking-wide'>
              {title}
            </h2>
          )}
          {actions && <div className='ml-auto flex gap-2'>{actions}</div>}
        </div>
      )}
      {children}
    </section>
  )
}

export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className='text-muted-foreground text-sm'>{children}</p>
}
