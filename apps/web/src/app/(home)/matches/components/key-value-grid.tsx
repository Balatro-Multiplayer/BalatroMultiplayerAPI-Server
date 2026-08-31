import type { ReactNode } from 'react'

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

export function KeyValueGrid({
  data,
  renderValue,
}: {
  data: Record<string, unknown>
  // Override for specific keys (e.g. "ruleset"/"deck" tooltips) -- return
  // null/undefined to fall back to the default formatted-text rendering.
  renderValue?: (key: string, value: unknown) => ReactNode
}) {
  return (
    <dl className='grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3'>
      {Object.entries(data).map(([key, value]) => (
        <div key={key}>
          <dt className='text-muted-foreground text-xs uppercase tracking-wide'>
            {key}
          </dt>
          <dd className='break-all font-mono text-sm'>
            {renderValue?.(key, value) ?? formatValue(value)}
          </dd>
        </div>
      ))}
    </dl>
  )
}
